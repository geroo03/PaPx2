-- ============================================================
-- URGENTE — v2: el fix anterior (migration-fix-recursion-perfiles-
-- comercios.sql) no alcanzó. Sigue reproduciéndose el mismo error:
--   {"code":"42P17","message":"infinite recursion detected in policy
--   for relation \"comercios\""}
-- Fecha: 2026-07-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- El v1 solo envolvió la consulta a "comercios" que hace
-- perfiles_cadete_identidad_partes. Pero comercios_admin_all también
-- hace "(SELECT rol FROM perfiles ...)" para saber si sos admin, y esa
-- misma consulta dispara TODO el RLS de perfiles — incluyendo
-- perfiles_admin_all, que a su vez vuelve a hacer
-- "(SELECT rol FROM perfiles ...)" sobre sí misma. Ese segundo ciclo
-- (comercios → perfiles → perfiles_admin_all → perfiles de nuevo) es
-- independiente del que arregló el v1 y sigue rompiendo todo.
--
-- Esta vez se crea UNA función SECURITY DEFINER para leer el rol actual
-- (bypassea RLS por completo, no vuelve a evaluar ninguna política) y
-- se usa esa función en TODAS las políticas de "comercios" y "perfiles"
-- que hoy hacen esa subconsulta inline, para no dejar ningún camino
-- suelto que pueda seguir recurseando.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.rol_actual() TO authenticated;

-- ── perfiles ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS perfiles_admin_all ON public.perfiles;
CREATE POLICY perfiles_admin_all
  ON public.perfiles FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── comercios ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS comercios_embajador_ver ON public.comercios;
CREATE POLICY comercios_embajador_ver
  ON public.comercios FOR SELECT
  USING (
    public.rol_actual() = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

DROP POLICY IF EXISTS comercios_embajador_update ON public.comercios;
CREATE POLICY comercios_embajador_update
  ON public.comercios FOR UPDATE
  USING (
    public.rol_actual() = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  )
  WITH CHECK (
    public.rol_actual() = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

DROP POLICY IF EXISTS comercios_admin_all ON public.comercios;
CREATE POLICY comercios_admin_all
  ON public.comercios FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');
