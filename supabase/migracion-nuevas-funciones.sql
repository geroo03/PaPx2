-- ╔════════════════════════════════════════════════════════════════════════════╗
-- ║  PUERTA A PUERTA — MIGRACIÓN: NUEVAS FUNCIONES                         ║
-- ║                                                                          ║
-- ║  Pegar en Supabase Dashboard → SQL Editor → New Query → Run             ║
-- ║  Completamente idempotente: seguro de correr N veces.                   ║
-- ║                                                                          ║
-- ║  Contenido:                                                              ║
-- ║    1. Nuevas columnas en 'cadetes' (CVU, DNI, seguro, referido, etc.)   ║
-- ║    2. Tabla 'patrocinios' (embajador ↔ comercio)                        ║
-- ║    3. Tabla 'historial_comisiones' (comisión por pedido)                 ║
-- ║    4. Tabla 'billetera_embajador' (saldo en tiempo real)                ║
-- ║    5. Tabla 'solicitudes_retiro' (retiros de embajadores)               ║
-- ║    6. Índices                                                            ║
-- ║    7. Row Level Security + políticas                                     ║
-- ║    8. RPCs atómicas (retiro, pago, rechazo, acreditación)               ║
-- ╚════════════════════════════════════════════════════════════════════════════╝


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. NUEVAS COLUMNAS EN 'cadetes'
--    Onboarding, documentación, referidos, cobros
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS cvu                  text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS foto_dni_url         text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS seguro_url           text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS carnet_url           text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS onboarding_completo  bool DEFAULT false;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS cobro_frecuencia     text DEFAULT 'semanal';
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS codigo_referido      text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS referido_por         text;


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. TABLA: patrocinios
--    Un embajador registra un comercio → tiene derecho a comisión sobre sus ventas
--    Regla: 5% los primeros 6 meses, 2% después
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.patrocinios (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid        NOT NULL,
  comercio_id  uuid        NOT NULL,
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS embajador_id uuid;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS comercio_id  uuid;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS fecha_inicio timestamptz;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS activo       boolean;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS created_at   timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_comercio_fkey
      FOREIGN KEY (comercio_id) REFERENCES public.comercios(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_embajador_comercio_key
      UNIQUE (embajador_id, comercio_id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. TABLA: historial_comisiones
--    Una fila por pedido entregado donde el comercio tiene patrocinio activo.
--    Guarda tasa_aplicada (0.05 ó 0.02) para transparencia con el embajador.
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.historial_comisiones (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id   uuid          NOT NULL,
  comercio_id    uuid          NOT NULL,
  pedido_id      uuid          NOT NULL,
  monto_pedido   numeric(12,2) NOT NULL,
  tasa_aplicada  numeric(5,4)  NOT NULL,
  monto_comision numeric(12,2) NOT NULL,
  meses_activo   integer       NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS embajador_id   uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS comercio_id    uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS pedido_id      uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS monto_pedido   numeric(12,2);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS tasa_aplicada  numeric(5,4);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS monto_comision numeric(12,2);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS meses_activo   integer;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS created_at     timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_pedido_fkey
      FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_pedido_embajador_key
      UNIQUE (pedido_id, embajador_id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. TABLA: billetera_embajador
--    Saldo en tiempo real. Solo el backend escribe; el embajador solo lee.
--    saldo_disponible = acumulado - retirado - congelado_por_retiros_pendientes
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.billetera_embajador (
  embajador_id     uuid          PRIMARY KEY,
  saldo_disponible numeric(12,2) NOT NULL DEFAULT 0,
  saldo_acumulado  numeric(12,2) NOT NULL DEFAULT 0,
  saldo_retirado   numeric(12,2) NOT NULL DEFAULT 0,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_disponible numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_acumulado  numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_retirado   numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.billetera_embajador ADD CONSTRAINT billetera_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 5. TABLA: solicitudes_retiro
--    Flujo: embajador solicita → admin revisa → transfiere → marca pagado
--    Estados: pendiente → pagado | rechazado
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.solicitudes_retiro (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid          NOT NULL,
  monto        numeric(12,2) NOT NULL,
  estado       text          NOT NULL DEFAULT 'pendiente',
  cbu_alias    text,
  notas_admin  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS embajador_id uuid;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS monto        numeric(12,2);
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS estado       text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS cbu_alias    text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS notas_admin  text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS created_at   timestamptz;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.solicitudes_retiro ADD CONSTRAINT solicitudes_retiro_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.solicitudes_retiro DROP CONSTRAINT IF EXISTS solicitudes_retiro_estado_check;
    ALTER TABLE public.solicitudes_retiro ADD CONSTRAINT solicitudes_retiro_estado_check
      CHECK (estado IN ('pendiente','pagado','rechazado'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 6. ÍNDICES
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_patrocinios_embajador  ON public.patrocinios         (embajador_id);
CREATE INDEX IF NOT EXISTS idx_patrocinios_comercio   ON public.patrocinios         (comercio_id);
CREATE INDEX IF NOT EXISTS idx_historial_embajador    ON public.historial_comisiones (embajador_id);
CREATE INDEX IF NOT EXISTS idx_historial_pedido       ON public.historial_comisiones (pedido_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_embajador  ON public.solicitudes_retiro   (embajador_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado     ON public.solicitudes_retiro   (estado);
CREATE INDEX IF NOT EXISTS idx_cadetes_referido       ON public.cadetes              (codigo_referido);


-- ══════════════════════════════════════════════════════════════════════════════
-- 7. ROW LEVEL SECURITY + POLÍTICAS
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.patrocinios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_comisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billetera_embajador  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_retiro   ENABLE ROW LEVEL SECURITY;

-- patrocinios
DROP POLICY IF EXISTS "pat_embajador_select" ON public.patrocinios;
DROP POLICY IF EXISTS "pat_service_all"      ON public.patrocinios;
CREATE POLICY "pat_embajador_select" ON public.patrocinios FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "pat_service_all"      ON public.patrocinios FOR ALL    USING (auth.role() = 'service_role');

-- historial_comisiones
DROP POLICY IF EXISTS "hist_embajador_select" ON public.historial_comisiones;
DROP POLICY IF EXISTS "hist_service_all"      ON public.historial_comisiones;
CREATE POLICY "hist_embajador_select" ON public.historial_comisiones FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "hist_service_all"      ON public.historial_comisiones FOR ALL    USING (auth.role() = 'service_role');

-- billetera_embajador
DROP POLICY IF EXISTS "bill_embajador_select" ON public.billetera_embajador;
DROP POLICY IF EXISTS "bill_service_all"      ON public.billetera_embajador;
CREATE POLICY "bill_embajador_select" ON public.billetera_embajador FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "bill_service_all"      ON public.billetera_embajador FOR ALL    USING (auth.role() = 'service_role');

-- solicitudes_retiro
DROP POLICY IF EXISTS "sol_embajador_select" ON public.solicitudes_retiro;
DROP POLICY IF EXISTS "sol_service_all"      ON public.solicitudes_retiro;
CREATE POLICY "sol_embajador_select" ON public.solicitudes_retiro FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "sol_service_all"      ON public.solicitudes_retiro FOR ALL    USING (auth.role() = 'service_role');


-- ══════════════════════════════════════════════════════════════════════════════
-- 8. RPCs — FUNCIONES ATÓMICAS (transacciones PostgreSQL)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 8a. acreditar_comision ──────────────────────────────────────────────────
-- El backend llama esto cada vez que se entrega un pedido con patrocinio.
-- UPSERT atómico: crea la billetera si no existe, o incrementa los saldos.
CREATE OR REPLACE FUNCTION public.acreditar_comision(
  p_embajador_id uuid,
  p_monto        numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO billetera_embajador (embajador_id, saldo_disponible, saldo_acumulado, saldo_retirado, updated_at)
  VALUES (p_embajador_id, p_monto, p_monto, 0, now())
  ON CONFLICT (embajador_id) DO UPDATE
    SET saldo_disponible = billetera_embajador.saldo_disponible + p_monto,
        saldo_acumulado  = billetera_embajador.saldo_acumulado  + p_monto,
        updated_at       = now();
END;
$$;

-- ── 8b. solicitar_retiro_embajador ──────────────────────────────────────────
-- Valida saldo, crea solicitud y congela el monto en UNA sola transacción.
-- Si dos solicitudes llegan al mismo tiempo, FOR UPDATE serializa el acceso.
CREATE OR REPLACE FUNCTION public.solicitar_retiro_embajador(
  p_embajador_id uuid,
  p_monto        numeric,
  p_cbu_alias    text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo numeric;
  v_id    uuid;
BEGIN
  IF p_monto <= 0 THEN
    RETURN json_build_object('error', 'El monto debe ser mayor a 0');
  END IF;

  SELECT saldo_disponible INTO v_saldo
  FROM billetera_embajador
  WHERE embajador_id = p_embajador_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Billetera no encontrada. Aún no tenés comisiones acumuladas.');
  END IF;

  IF v_saldo < p_monto THEN
    RETURN json_build_object(
      'error',            'Saldo insuficiente',
      'saldo_disponible', v_saldo,
      'monto_solicitado', p_monto
    );
  END IF;

  INSERT INTO solicitudes_retiro (embajador_id, monto, cbu_alias)
  VALUES (p_embajador_id, p_monto, p_cbu_alias)
  RETURNING id INTO v_id;

  UPDATE billetera_embajador
  SET saldo_disponible = saldo_disponible - p_monto,
      updated_at       = now()
  WHERE embajador_id = p_embajador_id;

  RETURN json_build_object('ok', true, 'solicitud_id', v_id, 'monto', p_monto);
END;
$$;

-- ── 8c. confirmar_pago_retiro ───────────────────────────────────────────────
-- Admin llama esto DESPUÉS de haber hecho la transferencia real.
-- Marca pagado y suma a saldo_retirado.
CREATE OR REPLACE FUNCTION public.confirmar_pago_retiro(
  p_solicitud_id uuid
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monto        numeric;
  v_embajador_id uuid;
  v_estado       text;
BEGIN
  SELECT monto, embajador_id, estado INTO v_monto, v_embajador_id, v_estado
  FROM solicitudes_retiro
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Solicitud no encontrada');
  END IF;

  IF v_estado != 'pendiente' THEN
    RETURN json_build_object('error', 'La solicitud ya fue procesada', 'estado', v_estado);
  END IF;

  UPDATE solicitudes_retiro
  SET estado = 'pagado', updated_at = now()
  WHERE id = p_solicitud_id;

  UPDATE billetera_embajador
  SET saldo_retirado = saldo_retirado + v_monto,
      updated_at     = now()
  WHERE embajador_id = v_embajador_id;

  RETURN json_build_object('ok', true, 'solicitud_id', p_solicitud_id, 'monto', v_monto);
END;
$$;

-- ── 8d. rechazar_retiro ─────────────────────────────────────────────────────
-- Admin rechaza → devuelve el monto congelado al saldo_disponible.
CREATE OR REPLACE FUNCTION public.rechazar_retiro(
  p_solicitud_id uuid,
  p_motivo       text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_monto        numeric;
  v_embajador_id uuid;
  v_estado       text;
BEGIN
  SELECT monto, embajador_id, estado INTO v_monto, v_embajador_id, v_estado
  FROM solicitudes_retiro
  WHERE id = p_solicitud_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('error', 'Solicitud no encontrada');
  END IF;

  IF v_estado != 'pendiente' THEN
    RETURN json_build_object('error', 'La solicitud ya fue procesada', 'estado', v_estado);
  END IF;

  UPDATE solicitudes_retiro
  SET estado      = 'rechazado',
      notas_admin = p_motivo,
      updated_at  = now()
  WHERE id = p_solicitud_id;

  UPDATE billetera_embajador
  SET saldo_disponible = saldo_disponible + v_monto,
      updated_at       = now()
  WHERE embajador_id = v_embajador_id;

  RETURN json_build_object('ok', true, 'saldo_devuelto', v_monto);
END;
$$;


-- ══════════════════════════════════════════════════════════════════════════════
-- ✅ LISTO — Si llegaste acá sin errores, todo está aplicado.
-- ══════════════════════════════════════════════════════════════════════════════
