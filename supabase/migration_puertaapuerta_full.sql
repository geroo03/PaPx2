-- Migration: Puerta a Puerta — Full schema, RLS, triggers and functions
-- Fecha: 2026-05-26
-- Objetivo: preparar tablas existentes y crear nuevas tablas/policies/triggers
-- IMPORTANT: este script es idempotente (usa IF NOT EXISTS / DROP CONSTRAINT IF EXISTS)

-- =======================================================================
-- 0) PRECONDICIONES
-- =======================================================================
-- Asegurarse de que la extensión pgcrypto (gen_random_uuid) exista
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SET search_path = public, pg_catalog;

-- =======================================================================
-- 1) ALTERACIONES EN TABLAS EXISTENTES
-- =======================================================================

-- 1.1) comercios: columnas nuevas
ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS creado_por_embajador_id UUID;

ALTER TABLE IF EXISTS public.comercios
  DROP CONSTRAINT IF EXISTS comercios_creado_por_embajador_id_fkey;
ALTER TABLE IF EXISTS public.comercios
  ADD CONSTRAINT IF NOT EXISTS comercios_creado_por_embajador_id_fkey
  FOREIGN KEY (creado_por_embajador_id)
  REFERENCES auth.users (id)
  ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS estado_registro TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE IF EXISTS public.comercios
  DROP CONSTRAINT IF EXISTS comercios_estado_registro_check;
ALTER TABLE IF EXISTS public.comercios
  ADD CONSTRAINT IF NOT EXISTS comercios_estado_registro_check
  CHECK (estado_registro IN ('pendiente','activo','suspendido'));

ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS mp_account_id TEXT;

ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS mp_access_token TEXT;

ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS tipo_delivery_defecto TEXT NOT NULL DEFAULT 'app';
ALTER TABLE IF EXISTS public.comercios
  DROP CONSTRAINT IF EXISTS comercios_tipo_delivery_defecto_check;
ALTER TABLE IF EXISTS public.comercios
  ADD CONSTRAINT IF NOT EXISTS comercios_tipo_delivery_defecto_check
  CHECK (tipo_delivery_defecto IN ('app','propio'));

-- Add deuda column if not exists (used for cash handling / cadete propio)
ALTER TABLE IF EXISTS public.comercios
  ADD COLUMN IF NOT EXISTS deuda NUMERIC(12,2) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_comercios_creado_por_embajador
  ON public.comercios (creado_por_embajador_id);
CREATE INDEX IF NOT EXISTS idx_comercios_estado_registro
  ON public.comercios (estado_registro);

-- 1.2) pedidos: columnas nuevas
ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS tipo_delivery TEXT NOT NULL DEFAULT 'app';
ALTER TABLE IF EXISTS public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_tipo_delivery_check;
ALTER TABLE IF EXISTS public.pedidos
  ADD CONSTRAINT IF NOT EXISTS pedidos_tipo_delivery_check
  CHECK (tipo_delivery IN ('app','propio'));

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS monto_comision_app NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS costo_envio NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS total_final NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS mp_payment_id TEXT;

ALTER TABLE IF EXISTS public.pedidos
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NOT NULL DEFAULT 'pendiente';
ALTER TABLE IF EXISTS public.pedidos
  DROP CONSTRAINT IF EXISTS pedidos_estado_pago_check;
ALTER TABLE IF EXISTS public.pedidos
  ADD CONSTRAINT IF NOT EXISTS pedidos_estado_pago_check
  CHECK (estado_pago IN ('pendiente','aprobado','rechazado'));

CREATE INDEX IF NOT EXISTS idx_pedidos_tipo_delivery ON public.pedidos (tipo_delivery);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado_pago ON public.pedidos (estado_pago);

-- =======================================================================
-- 2) NUEVAS TABLAS
-- =======================================================================

-- 2.1) billetera_embajadores: guarda comisiones por pedido
CREATE TABLE IF NOT EXISTS public.billetera_embajadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid NOT NULL,
  comercio_id uuid NOT NULL,
  pedido_id uuid NOT NULL,
  monto_comision NUMERIC(12,2) NOT NULL,
  periodo_mes INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE IF EXISTS public.billetera_embajadores
  ADD CONSTRAINT IF NOT EXISTS billetera_embajadores_embajador_fkey
  FOREIGN KEY (embajador_id) REFERENCES auth.users (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_billetera_embajador_id ON public.billetera_embajadores (embajador_id);
CREATE INDEX IF NOT EXISTS idx_billetera_comercio_id ON public.billetera_embajadores (comercio_id);
CREATE INDEX IF NOT EXISTS idx_billetera_pedido_id ON public.billetera_embajadores (pedido_id);

-- =======================================================================
-- 3) RLS POLICIES (ENABLE + CREATE)
-- =======================================================================

-- 3.0 Enable RLS on critical tables
ALTER TABLE IF EXISTS public.comercios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.billetera_embajadores ENABLE ROW LEVEL SECURITY;

-- 3.1 Perfiles table policies (ensure admin can manage)
ALTER TABLE IF EXISTS public.perfiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS perfiles_usuario_select_update ON public.perfiles;
DROP POLICY IF EXISTS perfiles_admin ON public.perfiles;
CREATE POLICY IF NOT EXISTS perfiles_usuario_select_update
  ON public.perfiles FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY IF NOT EXISTS perfiles_admin
  ON public.perfiles FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- 3.2 comercios policies
DROP POLICY IF EXISTS lectura_publica_comercios ON public.comercios;
DROP POLICY IF EXISTS comercio_dueño_select_update ON public.comercios;
DROP POLICY IF EXISTS embajador_ver_sus_comercios ON public.comercios;
DROP POLICY IF EXISTS embajador_modifica_sus_comercios ON public.comercios;
DROP POLICY IF EXISTS admin_todo_comercios ON public.comercios;

CREATE POLICY IF NOT EXISTS lectura_comercios_activos
  ON public.comercios FOR SELECT
  USING (estado_registro = 'activo');

CREATE POLICY IF NOT EXISTS comercio_dueño_select_update
  ON public.comercios FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY IF NOT EXISTS embajador_ver_sus_comercios
  ON public.comercios FOR SELECT
  USING (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

CREATE POLICY IF NOT EXISTS embajador_modifica_sus_comercios
  ON public.comercios FOR UPDATE
  USING (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  )
  WITH CHECK (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

CREATE POLICY IF NOT EXISTS admin_todo_comercios
  ON public.comercios FOR ALL
  USING (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
  );

-- 3.3 pedidos policies
DROP POLICY IF EXISTS clientes_ver_propios_pedidos ON public.pedidos;
DROP POLICY IF EXISTS clientes_crear_pedidos ON public.pedidos;
DROP POLICY IF EXISTS comercios_ver_sus_pedidos ON public.pedidos;
DROP POLICY IF EXISTS comercios_actualizar_estado ON public.pedidos;
DROP POLICY IF EXISTS cadetes_ver_viajes ON public.pedidos;

CREATE POLICY IF NOT EXISTS clientes_ver_propios_pedidos
  ON public.pedidos FOR SELECT
  USING (auth.uid() = usuario_id);

CREATE POLICY IF NOT EXISTS clientes_crear_pedidos
  ON public.pedidos FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY IF NOT EXISTS comercios_ver_sus_pedidos
  ON public.pedidos FOR SELECT
  USING (auth.uid() = comercio_id);

CREATE POLICY IF NOT EXISTS comercios_actualizar_estado
  ON public.pedidos FOR UPDATE
  USING (auth.uid() = comercio_id)
  WITH CHECK (estado IN ('preparando','rechazado','cancelado','preparado','en_camino','entregado'));

-- Cadetes: solo ver pedidos para app (preparando/preparado) o los asignados a ellos
CREATE POLICY IF NOT EXISTS cadetes_ver_viajes
  ON public.pedidos FOR SELECT
  USING (
    (
      estado IN ('preparando','preparado')
      AND tipo_delivery = 'app'
    )
    OR (auth.uid() = cadete_id)
  );

-- 3.4 billetera_embajadores policies
DROP POLICY IF EXISTS embajador_ver_billetera ON public.billetera_embajadores;
CREATE POLICY IF NOT EXISTS embajador_ver_billetera
  ON public.billetera_embajadores FOR SELECT
  USING (embajador_id = auth.uid());

-- Admin can see everything in these tables (perfiles/admin policy already covers admin for perfiles)
CREATE POLICY IF NOT EXISTS admin_todo_pedidos
  ON public.pedidos FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

CREATE POLICY IF NOT EXISTS admin_todo_billetera
  ON public.billetera_embajadores FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- =======================================================================
-- 4) FUNCIONES RPC Y TRIGGERS
-- =======================================================================

-- 4.1) Mantener confirmar_entrega
CREATE OR REPLACE FUNCTION public.confirmar_entrega(p_pedido_id UUID, p_pin TEXT)
RETURNS BOOLEAN AS $$
DECLARE v_pin_real TEXT;
BEGIN
  SELECT pin INTO v_pin_real FROM public.pedidos WHERE id = p_pedido_id AND estado = 'en_camino';
  IF v_pin_real = p_pin THEN
    UPDATE public.pedidos SET estado = 'entregado' WHERE id = p_pedido_id;
    RETURN TRUE;
  ELSE
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.2) Mantener tomar_pedido
CREATE OR REPLACE FUNCTION public.tomar_pedido(p_pedido_id UUID, p_cadete_id UUID)
RETURNS BOOLEAN AS $$
DECLARE affected_rows INTEGER;
BEGIN
  UPDATE public.pedidos
  SET cadete_id = p_cadete_id, estado = 'en_camino'
  WHERE id = p_pedido_id AND estado = 'preparado' AND cadete_id IS NULL AND tipo_delivery = 'app';

  GET DIAGNOSTICS affected_rows = ROW_COUNT;
  RETURN affected_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4.3) Trigger: auto-create perfil on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_create_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_email TEXT;
  v_id UUID;
BEGIN
  -- auth.users has id column; older deployments might use different naming, but Supabase uses id
  v_id := NEW.id;
  v_role := COALESCE(
    NULLIF(NEW.user_metadata::jsonb ->> 'role', ''),
    NULLIF(NEW.raw_user_meta_data::jsonb ->> 'role', ''),
    'cliente'
  );
  v_email := COALESCE(NEW.email, (NEW.user_metadata::jsonb ->> 'email'));

  IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE usuario_id = v_id) THEN
    INSERT INTO public.perfiles (usuario_id, rol, email, created_at)
    VALUES (v_id, v_role, v_email, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_create_profile ON auth.users;
CREATE TRIGGER trg_auth_user_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_create_profile();

-- 4.4) Trigger: calcular y almacenar comisiones embajador cuando pedido es ENTREGADO
-- Calcula meses entre comercio.created_at y now(); si <=6 => 5%; 7..12 => 2%; >12 => 0

CREATE OR REPLACE FUNCTION public.pedidos_on_entregado_insert_billetera()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_comercio_created timestamptz;
  v_months integer;
  v_embajador_id uuid;
  v_monto numeric(12,2);
  v_periodo integer;
BEGIN
  -- Solo actuar cuando pedido cambió su estado a 'entregado'
  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'entregado') THEN
      SELECT created_at, creado_por_embajador_id INTO v_comercio_created, v_embajador_id
      FROM public.comercios WHERE id = NEW.comercio_id LIMIT 1;

      IF v_comercio_created IS NULL OR v_embajador_id IS NULL THEN
        RETURN NEW; -- no comercio o no embajador
      END IF;

      -- months difference (approximate using age)
      v_months := date_part('year', age(now(), v_comercio_created)) * 12 + date_part('month', age(now(), v_comercio_created));

      IF v_months <= 6 THEN
        v_monto := ROUND( (COALESCE(NEW.total_final, NEW.subtotal, 0) * 0.05)::numeric, 2);
      ELSIF v_months >=7 AND v_months <= 12 THEN
        v_monto := ROUND( (COALESCE(NEW.total_final, NEW.subtotal, 0) * 0.02)::numeric, 2);
      ELSE
        v_monto := 0;
      END IF;

      IF v_monto > 0 THEN
        v_periodo := (date_part('year', now())::int * 12 + date_part('month', now())::int);
        INSERT INTO public.billetera_embajadores (embajador_id, comercio_id, pedido_id, monto_comision, periodo_mes)
        VALUES (v_embajador_id, NEW.comercio_id, NEW.id, v_monto, v_periodo);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_on_entregado_billetera ON public.pedidos;
CREATE TRIGGER trg_pedidos_on_entregado_billetera
AFTER UPDATE ON public.pedidos
FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'entregado')
EXECUTE FUNCTION public.pedidos_on_entregado_insert_billetera();

-- 4.5) Trigger: calcular y almacenar monto_comision_app y monto totals when pedido is INSERTED or UPDATED
-- This keeps monto_comision_app consistent (15% of subtotal) and total_final = subtotal + costo_envio
CREATE OR REPLACE FUNCTION public.pedidos_compute_commission_and_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- calculate app commission (15% of subtotal)
  NEW.monto_comision_app := ROUND(COALESCE(NEW.subtotal,0) * 0.15, 2);
  -- total_final := subtotal + costo_envio
  NEW.total_final := ROUND( COALESCE(NEW.subtotal,0) + COALESCE(NEW.costo_envio,0), 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_compute_commission ON public.pedidos;
CREATE TRIGGER trg_pedidos_compute_commission
BEFORE INSERT OR UPDATE ON public.pedidos
FOR EACH ROW
EXECUTE FUNCTION public.pedidos_compute_commission_and_totals();

-- 4.6) Trigger: when pedido is accepted as 'propio' and payment is cash (or estado_pago pend) allocate debt
-- Note: This logic is handled by other triggers / business flows; here we ensure that if a pedido transitions to 'preparando'
-- and tipo_delivery = 'propio' and payment is not approved (cash), we add commission handling to deuda if needed.
CREATE OR REPLACE FUNCTION public.pedidos_on_preparar_manage_debt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'preparando' AND NEW.tipo_delivery = 'propio') THEN
      -- If payment is 'pendiente' or payment method was cash, add app commission to comercio.deuda
      IF NEW.estado_pago <> 'aprobado' THEN
        UPDATE public.comercios
        SET deuda = COALESCE(deuda,0) + COALESCE(ROUND(NEW.monto_comision_app,2),0)
        WHERE id = NEW.comercio_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_on_preparar_manage_debt ON public.pedidos;
CREATE TRIGGER trg_pedidos_on_preparar_manage_debt
AFTER UPDATE ON public.pedidos
FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'preparando' AND NEW.tipo_delivery = 'propio')
EXECUTE FUNCTION public.pedidos_on_preparar_manage_debt();

-- =======================================================================
-- 5) INDEXES ADICIONALES Y MEJORAS
-- =======================================================================
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON public.pedidos (estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_comercio_id ON public.pedidos (comercio_id);

-- =======================================================================
-- 6) DOCUMENTATION / NOTES
-- =======================================================================
COMMENT ON TABLE public.billetera_embajadores IS 'Registra comisiones generadas para embajadores por pedidos de comercios que crearon.';
COMMENT ON COLUMN public.pedidos.tipo_delivery IS 'app => Cadete de la app; propio => Cadete del comercio (no visible para cadetes app)';
COMMENT ON COLUMN public.comercios.tipo_delivery_defecto IS 'Preferencia por defecto del comercio para tipo_delivery';

-- FIN del script de migración
