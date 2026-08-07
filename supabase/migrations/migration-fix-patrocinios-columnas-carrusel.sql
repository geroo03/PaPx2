-- ============================================================
-- Fix: patrocinios sin las columnas del carrusel de ofertas
-- Fecha: 2026-08-07
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Contexto:
--   El schema documentado (schema-definitivo-v2.sql) define `patrocinios`
--   dos veces con estructuras distintas: una para el carrusel de ofertas del
--   cliente (titulo/sub_titulo/imagen_url/link_oferta/orden/activo) y otra
--   para el vínculo embajador↔comercio de comisiones (embajador_id/
--   comercio_id/fecha_inicio/activo). La tabla REAL en producción quedó con
--   la segunda estructura — le faltan las columnas de la primera.
--
--   Resultado: tanto `cliente.js` (renderBannerSlides, lee patrocinios.titulo/
--   sub_titulo/imagen_url/link_oferta) como `admin.html` (pestaña "Carrusel",
--   botón "Guardar Slot") esperan esas columnas y fallan con
--   "column does not exist" — encontrado al intentar insertar un patrocinio
--   de prueba (2026-08-07).
-- ============================================================

ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS titulo      text;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS sub_titulo  text;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS imagen_url  text;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS link_oferta text;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS orden       int4 DEFAULT 0;

-- embajador_id quedó NOT NULL de un diseño anterior (patrocinios
-- embajador↔comercio para comisiones) — pero un slide del carrusel de
-- ofertas es genérico, ni admin.html ("Guardar Slot") ni cliente.js lo
-- llenan nunca. Confirmado en vivo: el botón "Guardar Slot" del admin
-- fallaba con este mismo error de NOT NULL antes de este fix.
ALTER TABLE public.patrocinios ALTER COLUMN embajador_id DROP NOT NULL;
ALTER TABLE public.patrocinios ALTER COLUMN comercio_id DROP NOT NULL;
