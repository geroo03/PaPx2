-- ============================================================
-- Pausa manual de comercios — para el scheduler de horarios automáticos.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Hasta ahora comercios.abierto_ahora era 100% manual (toggleEstado() en
-- comercio.js). Con el scheduler de horarios (horariosScheduler.js), el
-- horario configurado (horario_apertura/horario_cierre/dias_abierto, que
-- ya existían) pasa a mandar. Estas 2 columnas nuevas permiten que el
-- comercio siga pudiendo forzar un cierre temprano ("me quedé sin stock")
-- sin que eso se vuelva un cierre permanente si se olvidan de reactivarlo:
-- el scheduler limpia la pausa solo en la próxima apertura programada.
-- ============================================================

ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS pausado_manual bool NOT NULL DEFAULT false;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS pausado_desde  date;
