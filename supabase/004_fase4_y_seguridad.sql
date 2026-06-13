-- ============================================================
-- MIGRACIÓN 004: Fase 4 (Códigos, Propina, Distancia) + Seguridad
-- Proyecto: Puerta a Puerta
-- Fecha: 2026-06-10
-- Idempotente: sí — seguro correrlo más de una vez.
-- ============================================================
-- PRECONDICIÓN: La migración migration_puertaapuerta_full.sql
-- ya fue ejecutada (tablas pedidos, perfiles, comercios existen).
--
-- NOTA SOBRE COLUMNA DEL CLIENTE EN PEDIDOS:
--   Los scripts RLS existentes usan `usuario_id` como FK del cliente
--   en la tabla pedidos. Las políticas nuevas siguen esa convención.
--   Si en tu tabla la columna se llama `cliente_id`, reemplazá
--   `p.usuario_id` por `p.cliente_id` en todas las políticas de
--   mensajes_pedido y en la política perfiles_cadete_identidad_partes.
-- ============================================================

SET search_path = public, pg_catalog;

-- ============================================================
-- 1) ALTER TABLE pedidos — Columnas de Fase 4
-- ============================================================

-- 1.1) Códigos de confirmación generados server-side (backend/server.js → crypto.randomInt)
--      TEXT en lugar de INT para mantener tipo canónico de "código opaco"; sin restricción
--      de formato aquí (el backend garantiza 4 dígitos numéricos).
ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS codigo_retiro  TEXT;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS codigo_entrega TEXT;

-- 1.2) Campos de tarifa inmutables copiados desde ofertas_cadetes al aceptar el viaje.
--      NUMERIC(10,2) para km (ej: 12.75); INTEGER para montos enteros en ARS.
ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS distancia_estimada NUMERIC(10,2);

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS pago_cadete INTEGER;

-- 1.3) Propina opcional elegida por el cliente en el checkout.
--      DEFAULT 0 para compatibilidad con pedidos anteriores (no null).
ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS propina_cadete INTEGER NOT NULL DEFAULT 0;

-- Índice útil para reportes de ganancias del cadete
CREATE INDEX IF NOT EXISTS idx_pedidos_cadete_id ON public.pedidos (cadete_id);

-- ============================================================
-- 2) CREATE TABLE mensajes_pedido — Chat en el pedido
-- ============================================================
-- Permite comunicación entre cliente ↔ comercio ↔ cadete
-- dentro del contexto de un pedido específico.
-- Realtime: habilitar en Supabase Dashboard →
--   Database → Replication → supabase_realtime → mensajes_pedido ✓

CREATE TABLE IF NOT EXISTS public.mensajes_pedido (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     UUID         NOT NULL
                               REFERENCES public.pedidos(id) ON DELETE CASCADE,
  remitente_id  UUID         NOT NULL
                               REFERENCES auth.users(id)    ON DELETE CASCADE,
  rol_remitente TEXT         NOT NULL,
  mensaje       TEXT         NOT NULL,
  creado_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Validar que el rol declarado sea uno de los roles conocidos del sistema
ALTER TABLE IF EXISTS public.mensajes_pedido
  DROP CONSTRAINT IF EXISTS mensajes_pedido_rol_remitente_check;
ALTER TABLE IF EXISTS public.mensajes_pedido
  ADD  CONSTRAINT mensajes_pedido_rol_remitente_check
  CHECK (rol_remitente IN ('cliente', 'comercio', 'cadete', 'admin'));

-- Validar longitud del mensaje (no vacío, máx 1000 caracteres)
ALTER TABLE IF EXISTS public.mensajes_pedido
  DROP CONSTRAINT IF EXISTS mensajes_pedido_mensaje_len_check;
ALTER TABLE IF EXISTS public.mensajes_pedido
  ADD  CONSTRAINT mensajes_pedido_mensaje_len_check
  CHECK (char_length(mensaje) BETWEEN 1 AND 1000);

-- Índices para las consultas habituales
CREATE INDEX IF NOT EXISTS idx_mensajes_pedido_id   ON public.mensajes_pedido (pedido_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_remitente   ON public.mensajes_pedido (remitente_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_creado_at   ON public.mensajes_pedido (pedido_id, creado_at DESC);

COMMENT ON TABLE  public.mensajes_pedido                IS 'Chat interno de cada pedido. Solo participantes pueden leer y escribir.';
COMMENT ON COLUMN public.mensajes_pedido.rol_remitente  IS 'Rol real del remitente al momento de enviar; validado por la política RLS INSERT.';

-- ============================================================
-- 3) RLS — mensajes_pedido
-- ============================================================

ALTER TABLE IF EXISTS public.mensajes_pedido ENABLE ROW LEVEL SECURITY;

-- 3.1) SELECT: solo los tres participantes del pedido + admin
DROP POLICY IF EXISTS mensajes_select_partes ON public.mensajes_pedido;
CREATE POLICY mensajes_select_partes
  ON public.mensajes_pedido FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE  p.id = mensajes_pedido.pedido_id
      AND (
        p.usuario_id  = auth.uid()   -- cliente
        OR p.comercio_id = auth.uid() -- comercio
        OR p.cadete_id   = auth.uid() -- cadete asignado
      )
    )
    OR (
      SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()
    ) = 'admin'
  );

-- 3.2) INSERT: el remitente debe ser el caller, participante del pedido,
--              y el rol_remitente que declara debe coincidir con su rol real
--              en perfiles (previene impersonación de roles en el chat).
DROP POLICY IF EXISTS mensajes_insert_partes ON public.mensajes_pedido;
CREATE POLICY mensajes_insert_partes
  ON public.mensajes_pedido FOR INSERT
  WITH CHECK (
    -- No podés enviar mensajes en nombre de otro
    remitente_id = auth.uid()

    -- Solo si sos participante del pedido
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE  p.id = pedido_id
      AND (
        p.usuario_id  = auth.uid()
        OR p.comercio_id = auth.uid()
        OR p.cadete_id   = auth.uid()
      )
    )

    -- El rol que declarás debe coincidir con tu rol real
    AND rol_remitente = (
      SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()
    )
  );

-- 3.3) UPDATE y DELETE deshabilitados (mensajes son inmutables)
--      Sin políticas de UPDATE/DELETE → ningún usuario puede modificar ni borrar.

-- ============================================================
-- 4) RLS — perfiles: identidad del cadete para cliente y comercio
-- ============================================================
-- PROBLEMA ANTERIOR: La política `perfiles_usuario_select_update`
-- (FOR ALL USING auth.uid() = usuario_id) bloqueaba la lectura del
-- perfil del cadete desde el browser del cliente o del comercio.
-- El frontend del comercio hacía batch-fetch de perfiles y fallaba
-- silenciosamente (try/catch en comercio.js, Fase 4d).
--
-- SOLUCIÓN: Agregar una política SELECT adicional que permita leer
-- el perfil de un cadete cuando ese cadete está asignado a un pedido
-- donde el lector es cliente o comercio. Scope mínimo:
--   · Solo perfiles con rol = 'cadete'
--   · Solo si el cadete está en un pedido del solicitante
--   · Solo SELECT (no UPDATE ni DELETE)

DROP POLICY IF EXISTS perfiles_cadete_identidad_partes ON public.perfiles;
CREATE POLICY perfiles_cadete_identidad_partes
  ON public.perfiles FOR SELECT
  USING (
    rol = 'cadete'
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE  p.cadete_id = perfiles.usuario_id
      AND (
        p.usuario_id  = auth.uid()   -- cliente del pedido
        OR p.comercio_id = auth.uid() -- comercio del pedido
      )
    )
  );

-- ============================================================
-- 5) BLINDAJE: Prevenir auto-escalada de rol en perfiles
-- ============================================================
-- LA BRECHA: La política `perfiles_usuario_select_update` tiene
-- FOR ALL + WITH CHECK (auth.uid() = usuario_id), lo que permite
-- a un usuario UPDATE su propia fila incluyendo la columna `rol`.
-- Un usuario malintencionado podría hacer:
--   UPDATE perfiles SET rol = 'admin' WHERE usuario_id = auth.uid()
-- y autopromoverse sin pasar por el backend.
--
-- LA CORRECCIÓN: Trigger BEFORE UPDATE que verifica si el caller
-- intenta cambiar su propio `rol`. Solo lo permite si:
--   a) Es un admin (verificado en la misma tabla).
--   b) Es una llamada de service_role desde el backend
--      (operaciones de asignación de rol por parte del servidor).

CREATE OR REPLACE FUNCTION public.perfiles_prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jwt_role    TEXT;
  v_caller_rol  TEXT;
BEGIN
  -- El backend usa service_role (bypasea RLS); en ese contexto
  -- el JWT claim 'role' es 'service_role'. Permitir el cambio.
  BEGIN
    v_jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;  -- operación legítima del backend
  END IF;

  -- Para cualquier otra sesión: solo si el caller es admin
  IF OLD.rol IS DISTINCT FROM NEW.rol THEN
    SELECT rol INTO v_caller_rol
      FROM public.perfiles
      WHERE usuario_id = auth.uid();

    IF v_caller_rol IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION
        'No autorizado: el cambio de rol debe realizarse desde el backend. '
        'Contactá al administrador.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perfiles_prevent_role_escalation ON public.perfiles;
CREATE TRIGGER trg_perfiles_prevent_role_escalation
  BEFORE UPDATE ON public.perfiles
  FOR EACH ROW
  EXECUTE FUNCTION public.perfiles_prevent_role_escalation();

-- ============================================================
-- 6) BLINDAJE: Prevenir INSERT a perfiles con rol elevado
-- ============================================================
-- Un usuario podría intentar hacer INSERT directo a perfiles
-- desde el browser con rol = 'admin' | 'comercio' | 'cadete'.
-- El trigger de auth.users ya crea el perfil, pero si por alguna
-- razón el perfil no existiera, un INSERT browser podría asignarse
-- un rol arbitrario.
-- Este trigger fuerza rol = 'cliente' para cualquier INSERT que no
-- venga del service_role (es decir, que no venga del backend).

CREATE OR REPLACE FUNCTION public.perfiles_force_cliente_on_direct_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jwt_role TEXT;
BEGIN
  BEGIN
    v_jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- Backend (service_role) puede insertar cualquier rol
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Browser: forzar rol = 'cliente' independientemente de lo que envíe
  NEW.rol := 'cliente';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perfiles_force_cliente_insert ON public.perfiles;
CREATE TRIGGER trg_perfiles_force_cliente_insert
  BEFORE INSERT ON public.perfiles
  FOR EACH ROW
  EXECUTE FUNCTION public.perfiles_force_cliente_on_direct_insert();

-- ============================================================
-- 7) COMENTARIOS SOBRE COLUMNAS DE FASE 4
-- ============================================================
COMMENT ON COLUMN public.pedidos.codigo_retiro     IS 'Código 4 dígitos generado por el servidor al pasar a en_preparacion. El comercio se lo dice al cadete verbalmente.';
COMMENT ON COLUMN public.pedidos.codigo_entrega    IS 'Código 4 dígitos generado por el servidor. El cliente lo tiene en su pantalla de tracking.';
COMMENT ON COLUMN public.pedidos.distancia_estimada IS 'KM copiados desde ofertas_cadetes al momento de aceptar. Inmutable post-asignación.';
COMMENT ON COLUMN public.pedidos.pago_cadete        IS 'Pesos ARS copiados desde ofertas_cadetes al momento de aceptar. Inmutable post-asignación.';
COMMENT ON COLUMN public.pedidos.propina_cadete     IS 'Propina elegida por el cliente en checkout. 0 si no eligió. Persistida antes de crear la preferencia MP.';

-- ============================================================
-- FIN — 004_fase4_y_seguridad.sql
-- ============================================================
