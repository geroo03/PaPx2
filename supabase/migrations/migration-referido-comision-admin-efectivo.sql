-- ============================================================
-- MIGRACIÓN: Comisión 2% referidos (50 viajes) + Admin control efectivo
-- Fecha: 2026-06-25
-- IDEMPOTENTE
-- ============================================================

SET search_path = public, pg_catalog;


-- ══════════════════════════════════════════════════════════════
-- 1. Ampliar referidos_cadete: tracking de comisiones acumuladas
-- ══════════════════════════════════════════════════════════════
ALTER TABLE public.referidos_cadete ADD COLUMN IF NOT EXISTS viajes_contados   int4 NOT NULL DEFAULT 0;
ALTER TABLE public.referidos_cadete ADD COLUMN IF NOT EXISTS comision_acumulada numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.referidos_cadete ADD COLUMN IF NOT EXISTS viajes_limite     int4 NOT NULL DEFAULT 50;

-- Ampliar el CHECK de estado para incluir 'completado'
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.referidos_cadete DROP CONSTRAINT IF EXISTS referidos_cadete_estado_check;
    ALTER TABLE public.referidos_cadete ADD CONSTRAINT referidos_cadete_estado_check
      CHECK (estado IN ('pendiente','acreditado','completado'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- 2. TRIGGER: comisión 2% al referente por cada viaje del referido
--    Se ejecuta cuando un pedido pasa a 'entregado'.
--    Busca si el cadete que entregó tiene un referente activo.
--    Si sí, y tiene < 50 viajes contados, acredita 2% del pago_cadete.
-- ══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.pedidos_comision_referido()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ref        record;
  v_comision   numeric(12,2);
BEGIN
  IF NEW.cadete_id IS NULL OR COALESCE(NEW.pago_cadete, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  -- Buscar si este cadete fue referido por alguien
  SELECT id, referente_id, viajes_contados, viajes_limite, estado
  INTO v_ref
  FROM public.referidos_cadete
  WHERE referido_id = NEW.cadete_id
    AND estado IN ('pendiente', 'acreditado')
  LIMIT 1;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Si ya completó los viajes del programa, no hacer nada
  IF v_ref.viajes_contados >= v_ref.viajes_limite THEN
    UPDATE public.referidos_cadete
    SET estado = 'completado'
    WHERE id = v_ref.id AND estado != 'completado';
    RETURN NEW;
  END IF;

  -- Calcular 2% del pago del cadete
  v_comision := ROUND(COALESCE(NEW.pago_cadete, 0) * 0.02, 2);

  -- Actualizar contador y acumulado
  UPDATE public.referidos_cadete
  SET viajes_contados = viajes_contados + 1,
      comision_acumulada = COALESCE(comision_acumulada, 0) + v_comision,
      estado = CASE
        WHEN viajes_contados + 1 >= viajes_limite THEN 'completado'
        ELSE 'acreditado'
      END
  WHERE id = v_ref.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_comision_referido ON public.pedidos;
CREATE TRIGGER trg_pedidos_comision_referido
  AFTER UPDATE ON public.pedidos
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'entregado')
  EXECUTE FUNCTION public.pedidos_comision_referido();
