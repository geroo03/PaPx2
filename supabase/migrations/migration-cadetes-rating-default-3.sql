-- ============================================================
-- cadetes.rating: default 5.0 → 3.0 (SOLO nuevas filas)
-- Fecha: 2026-09-01
-- Idempotente — ALTER COLUMN ... SET DEFAULT no es una constraint con
-- nombre, se puede re-ejecutar sin error.
--
-- Decisión de negocio del usuario: un cadete sin viajes todavía no debería
-- arrancar con el rating máximo (5.0) — pasa a 3.0. NO retroactivo: los
-- cadetes ya registrados (incluidos los que tienen 5.0 sin calificaciones
-- reales todavía) mantienen el valor que ya tengan en la base. El rating
-- real de cada cadete se sigue recalculando como el promedio de
-- resenas.rating_cadete (pedidoController.js) apenas tiene su primera
-- valoración — este DEFAULT solo importa para el intervalo entre el alta y
-- la primera entrega calificada.
-- ============================================================

ALTER TABLE public.cadetes ALTER COLUMN rating SET DEFAULT 3.0;
