-- ============================================================
-- Fix: resenas.cadete_id bloqueaba borrar usuarios de auth.users
-- Fecha: 2026-08-07
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Contexto:
--   migration-fix-resenas-cadete-fk.sql (2026-07-14) corrigió a qué tabla
--   apuntaba resenas.cadete_id (antes: cadetes.id, ahora: auth.users(id)),
--   pero nunca definió ON DELETE — quedó en el default de Postgres
--   (NO ACTION / RESTRICT), a diferencia de prácticamente todas las demás
--   FK a auth.users en este schema (perfiles, cadetes, pedidos.cliente_id,
--   etc.), que usan CASCADE o SET NULL.
--
--   Resultado: no se puede borrar ningún usuario (cadete) desde el
--   dashboard de Supabase si tiene aunque sea una reseña — bloquea, entre
--   otras cosas, la limpieza de las cuentas QA que deja
--   backend/scripts/qa-e2e.mjs al correr el flujo completo del pedido
--   (incluye POST /api/pedidos/valorar). El dashboard lo muestra como
--   "Failed to delete user: {}" sin explicar el motivo real.
--
--   Se usa SET NULL, no CASCADE — mismo criterio que ya usa
--   pedidos.cliente_id en este schema: al borrar el cadete se pierde la
--   referencia, pero la reseña (y el rating_comercio que contiene) se
--   conserva en vez de desaparecer.
-- ============================================================

ALTER TABLE public.resenas DROP CONSTRAINT IF EXISTS resenas_cadete_id_fkey;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.resenas
      ADD CONSTRAINT resenas_cadete_id_fkey
      FOREIGN KEY (cadete_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
  END;
END $$;
