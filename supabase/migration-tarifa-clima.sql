-- ============================================================
-- Tarifa clima para cadetes
-- Fecha: 2026-07-11
-- Idempotente — se puede re-ejecutar sin daño.
-- ============================================================

ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS tarifa_clima boolean DEFAULT false;
