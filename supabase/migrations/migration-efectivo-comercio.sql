-- ============================================================
-- MIGRACIÓN: Efectivo → deuda al comercio (no al cadete)
-- El cadete entrega toda la plata al comercio.
-- El comercio acumula el 15% como deuda hacia PaP.
-- IDEMPOTENTE
-- ============================================================

CREATE OR REPLACE FUNCTION public.pedidos_acumular_deuda_efectivo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.metodo_pago = 'efectivo' AND NEW.comercio_id IS NOT NULL THEN
    NEW.cobrado_efectivo := true;
    UPDATE public.comercios
    SET deuda = COALESCE(deuda, 0) + COALESCE(NEW.monto_comision_app, 0)
    WHERE id = NEW.comercio_id;
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
