-- ============================================================
-- Agregar coordenadas de entrega a pedidos
-- Fecha: 2026-07-06
-- Idempotente — se puede re-ejecutar sin daño.
-- ============================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS lat_entrega numeric;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS lng_entrega numeric;
