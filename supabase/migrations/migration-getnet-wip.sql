-- ============================================================
-- Getnet — columna para reconciliar pagos (WIP, ver docs/GETNET-INTEGRACION.md).
-- Fecha: 2026-08-24
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Espejo de `pedidos.mp_payment_id` / `pedidos.payway_payment_id` (ver
-- schema-definitivo-v2.sql y migration-payway-wip.sql) pero para el id de
-- orden que devuelve Getnet — lo usa getnetController.js para idempotencia
-- (no duplicar el pedido si el webhook llega dos veces para la misma
-- orden) y para reconciliación manual.
--
-- ⚠️ NO CORRIDA EN SUPABASE TODAVÍA. Esta integración es un esqueleto sin
-- credenciales reales — no correr esta migración hasta que se decida seguir
-- adelante con Getnet de verdad (ver docs/GETNET-INTEGRACION.md).
--
-- `metodo_pago` no tiene un CHECK constraint (es `text` libre, ver línea 324
-- de schema-definitivo-v2.sql) — el valor 'getnet' que usa
-- getnetController.js no necesita ningún cambio de schema aparte de esta
-- columna.
-- ============================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS getnet_payment_id text;

DO $$ BEGIN
  CREATE INDEX idx_pedidos_getnet_payment_id ON public.pedidos(getnet_payment_id)
    WHERE getnet_payment_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
