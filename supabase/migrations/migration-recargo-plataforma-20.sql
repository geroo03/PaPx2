-- ============================================================
-- Sube el recargo de plataforma del 15% al 20%.
-- Fecha: 2026-07-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Decisión de negocio del usuario. Afecta monto_comision_app (lo que se
-- acumula como deuda del comercio cuando el pedido se cobra en efectivo) y,
-- del lado del frontend, el markup que ve el cliente sobre el precio base
-- del comercio (cliente.js/comercio.js, actualizados en el mismo commit).
-- No es retroactivo: los pedidos ya creados no se recalculan, solo los
-- nuevos a partir de que se corra esta migración.
-- ============================================================

CREATE OR REPLACE FUNCTION public.pedidos_compute_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.monto_comision_app := ROUND(COALESCE(NEW.subtotal, 0) * 0.20, 2);
  NEW.total_final := ROUND(COALESCE(NEW.subtotal, 0) + COALESCE(NEW.costo_envio, 0), 2);
  RETURN NEW;
END;
$$;
