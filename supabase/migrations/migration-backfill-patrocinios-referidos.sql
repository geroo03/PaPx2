-- ============================================================
-- Backfill de patrocinios faltantes para comercios referidos por link
-- Fecha: 2026-08-13
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Bug encontrado: los comercios que se registraron solos a través del link
-- de referidos del embajador (?ref=<embajador_id>, registro-comercio.html)
-- quedaban con `comercios.creado_por_embajador_id` seteado, pero NUNCA
-- generaban una fila en `patrocinios` — la sesión del comercio no puede
-- insertar ahí (policy patrocinios_embajador_insert exige rol='embajador').
-- `registrarComisionSiAplica` (embajadorController.js), la fuente de verdad
-- real de las comisiones desde que se sacó el trigger de base duplicado
-- (ver migration-fix-seguridad-y-comisiones.sql, punto 8), busca un
-- patrocinio activo antes de acreditar nada — sin él, no pasaba nada. En
-- resumen: cualquier comercio traído por el link nunca le generó comisión
-- al embajador que lo trajo, silenciosamente, desde que existe el link.
--
-- El código ya se corrigió (nuevo endpoint POST /api/embajadores/vincular-referido,
-- llamado desde registro-comercio.html justo después de crear el comercio) —
-- este script es el backfill único para los comercios que ya se habían
-- registrado antes de ese fix, así empiezan a generar comisión en su
-- PRÓXIMO pedido entregado. No recalcula ni acredita comisiones de pedidos
-- ya entregados en el pasado — esa plata, si se quiere pagar retroactiva,
-- es una decisión aparte (habría que revisar historial_comisiones vs.
-- pedidos entregados de estos comercios para estimar cuánto sería).
--
-- fecha_inicio se toma de comercios.created_at (fecha real de alta), no de
-- hoy — así la tasa de comisión (5% primeros 6 meses, 2% meses 7-12) se
-- calcula igual que si el patrocinio hubiera existido desde el principio.
-- ============================================================

INSERT INTO public.patrocinios (embajador_id, comercio_id, fecha_inicio, activo)
SELECT
  c.creado_por_embajador_id,
  c.id,
  COALESCE(c.created_at, now()),
  true
FROM public.comercios c
WHERE c.creado_por_embajador_id IS NOT NULL
ON CONFLICT (embajador_id, comercio_id) DO NOTHING;
