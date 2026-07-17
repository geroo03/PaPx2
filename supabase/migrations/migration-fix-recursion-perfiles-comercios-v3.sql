-- ============================================================
-- URGENTE — v3 (definitivo): cierra el ciclo de recursión de RLS de raíz.
-- Fecha: 2026-07-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- v1 y v2 arreglaron comercios y perfiles_admin_all, pero el ciclo real
-- pasa por "pedidos": perfiles_cadete_identidad_partes consulta pedidos,
-- y pedidos_admin_all vuelve a hacer "(SELECT rol FROM perfiles ...)" —
-- esa subconsulta cruda dispara TODO el RLS de perfiles de nuevo
-- (incluyendo perfiles_cadete_identidad_partes), que vuelve a consultar
-- pedidos, que vuelve a disparar pedidos_admin_all... bucle infinito.
-- Por eso cadetes_admin_all (que también hace la subconsulta cruda a
-- perfiles) disparó el mismo error en la tabla "perfiles" en el segundo
-- intento: CUALQUIER política que consulte perfiles con la subconsulta
-- cruda dispara este mismo ciclo por el camino de pedidos.
--
-- También se sospecha que las funciones v1/v2 (LANGUAGE sql) pueden
-- estar siendo "inlineadas" por el planner de Postgres, lo que anula el
-- bypass de RLS de SECURITY DEFINER. Se recrean como LANGUAGE plpgsql,
-- que Postgres nunca inlinea, para garantizar que el bypass funcione.
--
-- Este migration reemplaza TODAS las políticas activas que hoy hacen
-- "(SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid())" de
-- forma cruda, en cualquier tabla, por public.rol_actual(). Con esto no
-- debería quedar ningún camino más que pueda seguir recurseando.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rol_actual()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_rol text;
BEGIN
  SELECT rol INTO v_rol FROM public.perfiles WHERE usuario_id = auth.uid();
  RETURN v_rol;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rol_actual() TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.es_dueno_de_comercio(p_comercio_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = p_comercio_id AND c.usuario_id = auth.uid()
  ) INTO v_ok;
  RETURN v_ok;
END;
$$;

GRANT EXECUTE ON FUNCTION public.es_dueno_de_comercio(uuid) TO authenticated, anon;

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
  USING (public.rol_actual() = 'embajador' AND creado_por_embajador_id = auth.uid());

DROP POLICY IF EXISTS comercios_embajador_update ON public.comercios;
CREATE POLICY comercios_embajador_update
  ON public.comercios FOR UPDATE
  USING (public.rol_actual() = 'embajador' AND creado_por_embajador_id = auth.uid())
  WITH CHECK (public.rol_actual() = 'embajador' AND creado_por_embajador_id = auth.uid());

DROP POLICY IF EXISTS comercios_admin_all ON public.comercios;
CREATE POLICY comercios_admin_all
  ON public.comercios FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── cadetes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS cadetes_admin_all ON public.cadetes;
CREATE POLICY cadetes_admin_all
  ON public.cadetes FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── pedidos (la pieza que cerraba el ciclo real) ───────────────────
DROP POLICY IF EXISTS pedidos_admin_all ON public.pedidos;
CREATE POLICY pedidos_admin_all
  ON public.pedidos FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── mensajes_pedido ─────────────────────────────────────────────────
DROP POLICY IF EXISTS mensajes_select_partes ON public.mensajes_pedido;
CREATE POLICY mensajes_select_partes
  ON public.mensajes_pedido FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      LEFT JOIN public.comercios c ON c.id = p.comercio_id
      WHERE p.id = mensajes_pedido.pedido_id
        AND (p.cliente_id = auth.uid() OR c.usuario_id = auth.uid() OR p.cadete_id = auth.uid())
    )
    OR public.rol_actual() = 'admin'
  );

DROP POLICY IF EXISTS mensajes_insert_partes ON public.mensajes_pedido;
CREATE POLICY mensajes_insert_partes
  ON public.mensajes_pedido FOR INSERT
  WITH CHECK (
    remitente_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      LEFT JOIN public.comercios c ON c.id = p.comercio_id
      WHERE p.id = pedido_id
        AND (p.cliente_id = auth.uid() OR c.usuario_id = auth.uid() OR p.cadete_id = auth.uid())
    )
    AND rol_remitente = public.rol_actual()
  );

-- ── billetera_embajadores ───────────────────────────────────────────
DROP POLICY IF EXISTS billetera_admin_all ON public.billetera_embajadores;
CREATE POLICY billetera_admin_all
  ON public.billetera_embajadores FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── liquidaciones ────────────────────────────────────────────────────
DROP POLICY IF EXISTS liquidaciones_admin_all ON public.liquidaciones;
CREATE POLICY liquidaciones_admin_all
  ON public.liquidaciones FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── referidos_cadete ─────────────────────────────────────────────────
DROP POLICY IF EXISTS referidos_admin_all ON public.referidos_cadete;
CREATE POLICY referidos_admin_all
  ON public.referidos_cadete FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── resenas ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS resenas_admin_all ON public.resenas;
CREATE POLICY resenas_admin_all
  ON public.resenas FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── reportes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS reportes_admin_all ON public.reportes;
CREATE POLICY reportes_admin_all
  ON public.reportes FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── patrocinios ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS patrocinios_admin_all ON public.patrocinios;
CREATE POLICY patrocinios_admin_all
  ON public.patrocinios FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── comercios_historial (agregada hoy en migration-fix-seguridad-y-comisiones.sql)
DROP POLICY IF EXISTS comercios_historial_admin_all ON public.comercios_historial;
CREATE POLICY comercios_historial_admin_all
  ON public.comercios_historial FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── advertencias_comercio (agregada hoy) ─────────────────────────────
DROP POLICY IF EXISTS advertencias_comercio_admin ON public.advertencias_comercio;
CREATE POLICY advertencias_comercio_admin
  ON public.advertencias_comercio FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ── chat_reportes (reescrita hoy, tenía la subconsulta cruda embebida) ─
DROP POLICY IF EXISTS chat_reportes_participantes ON public.chat_reportes;
CREATE POLICY chat_reportes_participantes
  ON public.chat_reportes FOR ALL
  USING (
    reporte_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.reportes r
      WHERE r.id = chat_reportes.reporte_id
        AND (
          r.usuario_id = auth.uid()
          OR public.rol_actual() = 'admin'
          OR EXISTS (
            SELECT 1 FROM public.comercios c
            WHERE c.usuario_id = auth.uid() AND c.id::text = r.comercio_id::text
          )
        )
    )
  )
  WITH CHECK (
    reporte_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.reportes r
      WHERE r.id = chat_reportes.reporte_id
        AND (
          r.usuario_id = auth.uid()
          OR public.rol_actual() = 'admin'
          OR EXISTS (
            SELECT 1 FROM public.comercios c
            WHERE c.usuario_id = auth.uid() AND c.id::text = r.comercio_id::text
          )
        )
    )
  );

-- ── storage.objects (bucket cadetes-antecedentes) ────────────────────
DROP POLICY IF EXISTS "Antecedentes: dueño y admin leen" ON storage.objects;
CREATE POLICY "Antecedentes: dueño y admin leen"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'cadetes-antecedentes'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR public.rol_actual() = 'admin'
    )
  );
