-- ============================================================
-- URGENTE: rompe una recursión infinita de RLS introducida por
-- migration-fix-seguridad-y-comisiones.sql (2026-07-16).
-- Fecha: 2026-07-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Síntoma en producción: cualquier operación sobre "comercios" (por
-- ejemplo, crear un comercio nuevo) falla con:
--   {"code":"42P17","message":"infinite recursion detected in policy
--   for relation \"comercios\""}
--
-- Causa: esa migración cambió perfiles_cadete_identidad_partes para
-- que, en vez de comparar p.comercio_id = auth.uid() (una comparación
-- que siempre daba false y por lo tanto nunca ejecutaba una consulta
-- real), ahora hace un EXISTS (SELECT ... FROM public.comercios ...).
-- Eso crea un ciclo nuevo que antes no existía:
--   comercios_admin_all / comercios_embajador_ver (políticas de
--   "comercios") consultan perfiles.rol para saber si sos admin/embajador
--     → evaluar el RLS de perfiles incluye perfiles_cadete_identidad_partes
--       → que ahora consulta comercios
--         → volvemos a evaluar el RLS de comercios → bucle infinito.
--
-- Fix: la consulta a comercios dentro de perfiles_cadete_identidad_partes
-- se mueve a una función SECURITY DEFINER. Al ejecutarse como el dueño
-- de la función (con privilegios que evitan re-aplicar RLS), la consulta
-- interna a comercios ya no dispara de nuevo el RLS de comercios, así que
-- el ciclo se corta acá sin tocar ninguna otra política de las ~15 que
-- usan el mismo patrón de "(SELECT rol FROM perfiles ...)" en otras
-- tablas (esas nunca formaron un ciclo real y no hace falta tocarlas).
-- ============================================================

CREATE OR REPLACE FUNCTION public.es_dueno_de_comercio(p_comercio_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = p_comercio_id AND c.usuario_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.es_dueno_de_comercio(uuid) TO authenticated;

DROP POLICY IF EXISTS perfiles_cadete_identidad_partes ON public.perfiles;
CREATE POLICY perfiles_cadete_identidad_partes
  ON public.perfiles FOR SELECT
  USING (
    rol = 'cadete'
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.cadete_id = perfiles.usuario_id
        AND (
          p.cliente_id = auth.uid()
          OR public.es_dueno_de_comercio(p.comercio_id)
        )
    )
  );
