-- ============================================================
-- Fix: resenas.cadete_id apuntaba a la tabla equivocada
-- Fecha: 2026-07-14
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Contexto:
--   En todo el resto del schema, "cadete_id" es el auth uid del cadete
--   (pedidos.cadete_id, ofertas_cadetes.cadete_id, ubicacion_cadetes.cadete_id
--   → todos referencian auth.users). Pero resenas.cadete_id tenía una FK
--   apuntando a cadetes.id (la PK interna random de la tabla cadetes, NO el
--   auth uid). Como POST /api/pedidos/valorar siempre pasa el auth uid
--   (pedido.cadete_id), CADA intento de valorar a un cadete fallaba con
--   "violates foreign key constraint resenas_cadete_id_fkey" — encontrado
--   corriendo backend/scripts/qa-e2e.mjs contra producción.
--
--   Sumado a esto, la columna que el backend intentaba escribir ('rating')
--   tampoco existe en resenas (las columnas reales son rating_comercio /
--   rating_cadete) — ese fix ya está en pedidoController.js, este archivo
--   solo corrige la FK.
-- ============================================================

ALTER TABLE public.resenas DROP CONSTRAINT IF EXISTS resenas_cadete_id_fkey;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.resenas
      ADD CONSTRAINT resenas_cadete_id_fkey
      FOREIGN KEY (cadete_id) REFERENCES auth.users(id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL;
  END;
END $$;
