-- ============================================================
-- MIGRACIÓN: Sistema de Efectivo + Referidos Cadete + Datos Bancarios Comercio
-- Fecha: 2026-06-25
-- IDEMPOTENTE — puede ejecutarse N veces sin perder datos
-- ============================================================

SET search_path = public, pg_catalog;


-- ══════════════════════════════════════════════════════════════
-- 1. DATOS BANCARIOS DEL COMERCIO
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS titular_bancario  text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS tipo_cuenta       text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS cbu_alias         text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS cuit              text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS razon_social      text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS ciudad            text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS codigo_postal     text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS barrio            text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS email_facturacion text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS banco             text;


-- ══════════════════════════════════════════════════════════════
-- 2. SISTEMA DE EFECTIVO — columnas en pedidos y cadetes
-- ══════════════════════════════════════════════════════════════

-- El cadete acumula deuda_efectivo cuando cobra en efectivo al cliente.
-- Esa plata es del comercio+plataforma, el cadete la tiene "en mano".
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS deuda_efectivo   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS limite_efectivo  numeric(12,2) NOT NULL DEFAULT 15000;

-- Marcar en el pedido si fue cobrado en efectivo y si ya se liquidó
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cobrado_efectivo bool NOT NULL DEFAULT false;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS liquidado        bool NOT NULL DEFAULT false;


-- ══════════════════════════════════════════════════════════════
-- 3. TABLA liquidaciones — ciclo de pago cada 4 días
--    Registra cuándo el cadete devolvió el efectivo a la plataforma
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.liquidaciones (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  cadete_id       uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monto           numeric(12,2) NOT NULL,
  metodo          text          NOT NULL DEFAULT 'transferencia',
  estado          text          NOT NULL DEFAULT 'pendiente',
  comprobante_url text,
  notas           text,
  created_at      timestamptz   DEFAULT now(),
  confirmado_at   timestamptz
);

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.liquidaciones ADD CONSTRAINT liquidaciones_estado_check
      CHECK (estado IN ('pendiente','confirmada','rechazada'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.liquidaciones ADD CONSTRAINT liquidaciones_metodo_check
      CHECK (metodo IN ('transferencia','efectivo','mercadopago'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

ALTER TABLE public.liquidaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liquidaciones_cadete_select ON public.liquidaciones;
CREATE POLICY liquidaciones_cadete_select
  ON public.liquidaciones FOR SELECT
  USING (cadete_id = auth.uid());

DROP POLICY IF EXISTS liquidaciones_cadete_insert ON public.liquidaciones;
CREATE POLICY liquidaciones_cadete_insert
  ON public.liquidaciones FOR INSERT
  WITH CHECK (cadete_id = auth.uid());

DROP POLICY IF EXISTS liquidaciones_admin_all ON public.liquidaciones;
CREATE POLICY liquidaciones_admin_all
  ON public.liquidaciones FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

CREATE INDEX IF NOT EXISTS idx_liquidaciones_cadete ON public.liquidaciones (cadete_id);
CREATE INDEX IF NOT EXISTS idx_liquidaciones_estado ON public.liquidaciones (estado);


-- ══════════════════════════════════════════════════════════════
-- 4. TRIGGER: acumular deuda_efectivo al cadete cuando entrega pedido en efectivo
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pedidos_acumular_deuda_efectivo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.metodo_pago = 'efectivo' AND NEW.cadete_id IS NOT NULL THEN
    NEW.cobrado_efectivo := true;
    UPDATE public.cadetes
    SET deuda_efectivo = COALESCE(deuda_efectivo, 0) + COALESCE(NEW.total, 0)
    WHERE auth_uid = NEW.cadete_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_deuda_efectivo ON public.pedidos;
CREATE TRIGGER trg_pedidos_deuda_efectivo
  BEFORE UPDATE ON public.pedidos
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'entregado')
  EXECUTE FUNCTION public.pedidos_acumular_deuda_efectivo();


-- ══════════════════════════════════════════════════════════════
-- 5. REFERIDOS CADETE — índice único en codigo_referido
-- ══════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.cadetes
      ADD CONSTRAINT cadetes_codigo_referido_key UNIQUE (codigo_referido);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- Tabla para trackear bonificaciones de referidos
CREATE TABLE IF NOT EXISTS public.referidos_cadete (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  referente_id    uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referido_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  codigo_usado    text          NOT NULL,
  bonificacion    numeric(12,2) NOT NULL DEFAULT 500,
  estado          text          NOT NULL DEFAULT 'pendiente',
  created_at      timestamptz   DEFAULT now()
);

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.referidos_cadete
      ADD CONSTRAINT referidos_cadete_referido_key UNIQUE (referido_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.referidos_cadete ADD CONSTRAINT referidos_cadete_estado_check
      CHECK (estado IN ('pendiente','acreditado'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

ALTER TABLE public.referidos_cadete ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referidos_cadete_select ON public.referidos_cadete;
CREATE POLICY referidos_cadete_select
  ON public.referidos_cadete FOR SELECT
  USING (referente_id = auth.uid() OR referido_id = auth.uid());

DROP POLICY IF EXISTS referidos_admin_all ON public.referidos_cadete;
CREATE POLICY referidos_admin_all
  ON public.referidos_cadete FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

CREATE INDEX IF NOT EXISTS idx_referidos_referente ON public.referidos_cadete (referente_id);
CREATE INDEX IF NOT EXISTS idx_referidos_codigo    ON public.referidos_cadete (codigo_usado);
