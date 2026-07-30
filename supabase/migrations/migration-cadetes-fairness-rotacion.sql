-- ============================================================
-- Reparto más parejo entre cadetes — columna para saber hace cuánto no
-- se le asigna un viaje a cada cadete, usada por el ranking ponderado de
-- ejecutarDifusion (matchingUtils.js) para no premiar siempre al más
-- cercano de forma sistemática.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Se actualiza cuando el cadete ACEPTA un viaje (no cuando solo recibe la
-- oferta) — ver pedidoController.js, aceptarPedido().
-- ============================================================

ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS ultima_asignacion_at timestamptz;
