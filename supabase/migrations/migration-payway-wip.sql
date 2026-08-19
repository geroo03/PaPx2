-- ============================================================
-- Payway — columna para reconciliar pagos (WIP, ver docs/PAYWAY-INTEGRACION.md).
-- Fecha: 2026-08-18
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Espejo de `pedidos.mp_payment_id` (ver schema-definitivo-v2.sql) pero para
-- el id de pago que devuelve Payway — lo usa paywayController.js para
-- idempotencia (no duplicar el pedido si crear-pago se llama dos veces para
-- el mismo pago) y para reconciliación manual.
--
-- ⚠️ NO CORRIDA EN SUPABASE TODAVÍA. Esta integración es un esqueleto sin
-- credenciales reales — no correr esta migración hasta que se decida seguir
-- adelante con Payway de verdad (ver docs/PAYWAY-INTEGRACION.md).
--
-- `metodo_pago` no tiene un CHECK constraint (es `text` libre, ver línea 324
-- de schema-definitivo-v2.sql) — el valor 'payway' que usa paywayController.js
-- no necesita ningún cambio de schema aparte de esta columna.
-- ============================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS payway_payment_id text;

DO $$ BEGIN
  CREATE INDEX idx_pedidos_payway_payment_id ON public.pedidos(payway_payment_id)
    WHERE payway_payment_id IS NOT NULL;
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
