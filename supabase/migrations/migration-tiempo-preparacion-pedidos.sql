-- ============================================================
-- Tiempo de preparación del pedido — base para el matching automático.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Hasta ahora no existía ningún concepto de "cuánto tarda el comercio en
-- preparar el pedido" — difundirPedido avisaba a los cadetes siempre
-- inmediatamente al aceptar, sin relación con la comida real. Estas
-- columnas permiten que el comercio declare un tiempo estimado al aceptar
-- el pedido, y que el scheduler de matching (ver migraciones siguientes)
-- decida cuándo conviene avisarle a los cadetes.
-- ============================================================

ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS tiempo_preparacion_min int4;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS preparando_at         timestamptz;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS listo_estimado_at     timestamptz;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS difusion_intentos     int4 NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS ultima_difusion_at    timestamptz;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS difusion_agotada      bool NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_tiempo_preparacion_check'
  ) THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT pedidos_tiempo_preparacion_check
      CHECK (tiempo_preparacion_min IS NULL OR (tiempo_preparacion_min BETWEEN 3 AND 90));
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Índice parcial: el scheduler consulta repetidamente "pedidos en preparando,
-- sin cadete, que ya casi están listos" — sin este índice sería un full scan.
CREATE INDEX IF NOT EXISTS idx_pedidos_pendientes_difusion
  ON public.pedidos (listo_estimado_at)
  WHERE estado = 'preparando' AND cadete_id IS NULL;
