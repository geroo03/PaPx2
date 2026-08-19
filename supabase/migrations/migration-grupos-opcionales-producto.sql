-- ============================================================
-- Grupos de opcionales: relación real con producto + RLS consistente
-- Fecha: 2026-08-15
-- Idempotente — se puede re-ejecutar sin daño.
--
-- grupos_opcionales/opciones_items existen desde el schema inicial pero
-- nunca se usaron desde el código (el bloque "Grupos de opcionales" del
-- modal de producto en comercio.html era un placeholder estático). La UI
-- real vive dentro del modal de UN producto (no se comparten grupos entre
-- productos), así que se agrega la columna que faltaba. De paso, se
-- re-escriben las 4 policies creadas en migration-fix-seguridad-y-comisiones.sql
-- (2026-07-16) para usar public.es_dueno_de_comercio() en vez del EXISTS
-- inline original — mismo comportamiento, consistente con la convención
-- de RLS del resto del schema (ver CLAUDE.md §7).
--
-- NOTA (2026-08-15): schema-definitivo-v2.sql documentaba opciones_items con
-- una columna `precio_extra`, pero la tabla real en producción (nunca antes
-- verificada porque el código nunca la tocó) usa `precio_adicional` — y
-- también tiene una columna `disponible` (bool, default true) que el doc no
-- mencionaba. Confirmado por introspección directa
-- (information_schema.columns) antes de escribir esta versión. Esta
-- migración usa los nombres reales; el código de la app (comercio.js) traduce
-- precio_extra (nombre de dominio, usado en el CSV/UI/tests) ↔ precio_adicional
-- (columna real) en los dos puntos donde lee/escribe esta tabla.
-- ============================================================

-- 1) producto_id: nullable a propósito. Un grupo de opciones pertenece a
--    un solo producto (no se comparten entre productos); comercio_id se
--    mantiene tal cual estaba, denormalizado, para que las policies de
--    RLS no necesiten un join extra a productos.
ALTER TABLE public.grupos_opcionales
  ADD COLUMN IF NOT EXISTS producto_id uuid REFERENCES public.productos(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_grupos_opcionales_producto_id
  ON public.grupos_opcionales (producto_id);

-- 2) Integridad de negocio (ADD COLUMN siempre antes de ADD CONSTRAINT).
DO $$ BEGIN
  ALTER TABLE public.grupos_opcionales
    ADD CONSTRAINT grupos_opcionales_min_max_check
    CHECK (min_opciones >= 0 AND max_opciones >= 1 AND min_opciones <= max_opciones);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.opciones_items
    ADD CONSTRAINT opciones_items_precio_adicional_check
    CHECK (precio_adicional >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) RLS — re-escritas con es_dueno_de_comercio() (definida en
--    migration-fix-recursion-perfiles-comercios-v3.sql). Mismo
--    comportamiento que las policies originales (lectura pública porque
--    el cliente necesita verlas al armar el pedido más adelante; escritura
--    solo del dueño del comercio).
DROP POLICY IF EXISTS grupos_opcionales_lectura_publica ON public.grupos_opcionales;
CREATE POLICY grupos_opcionales_lectura_publica
  ON public.grupos_opcionales FOR SELECT
  USING (true);

DROP POLICY IF EXISTS grupos_opcionales_owner_all ON public.grupos_opcionales;
CREATE POLICY grupos_opcionales_owner_all
  ON public.grupos_opcionales FOR ALL
  USING (public.es_dueno_de_comercio(comercio_id))
  WITH CHECK (public.es_dueno_de_comercio(comercio_id));

DROP POLICY IF EXISTS opciones_items_lectura_publica ON public.opciones_items;
CREATE POLICY opciones_items_lectura_publica
  ON public.opciones_items FOR SELECT
  USING (true);

DROP POLICY IF EXISTS opciones_items_owner_all ON public.opciones_items;
CREATE POLICY opciones_items_owner_all
  ON public.opciones_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.grupos_opcionales g
    WHERE g.id = grupo_opcional_id AND public.es_dueno_de_comercio(g.comercio_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.grupos_opcionales g
    WHERE g.id = grupo_opcional_id AND public.es_dueno_de_comercio(g.comercio_id)
  ));

-- Nota: productos_lectura_disponibles y productos_owner_all (ya existentes)
-- no necesitan cambios — no dependen de grupos_opcionales.
