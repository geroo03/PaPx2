-- ============================================================
-- Fix de seguridad (RLS faltante/mal armada) + comisiones duplicadas
-- Fecha: 2026-07-16
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Encontrado en una auditoría exhaustiva línea por línea de todo el código
-- (backend, frontend, SQL) hecha con varios agentes en paralelo + revisión
-- manual, y verificado contra el schema real antes de escribir este archivo.
-- ============================================================

-- ── 1. comercios_historial: nunca tuvo RLS ─────────────────────────────────
-- Sin esto, cualquier usuario logueado puede leer el historial completo de
-- TODOS los comercios via la API — incluye mp_access_token, cbu_alias, cuit,
-- razon_social, email_facturacion (el trigger de auditoría guarda la fila
-- entera con to_jsonb(NEW)).
ALTER TABLE public.comercios_historial ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comercios_historial_admin_all ON public.comercios_historial;
CREATE POLICY comercios_historial_admin_all
  ON public.comercios_historial FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');


-- ── 2. grupos_opcionales / opciones_items: nunca tuvieron RLS ──────────────
-- Mismo patrón que productos/categorias_producto (lectura pública porque el
-- cliente necesita verlas al armar el pedido; escritura solo del dueño).
ALTER TABLE public.grupos_opcionales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opciones_items    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grupos_opcionales_lectura_publica ON public.grupos_opcionales;
DROP POLICY IF EXISTS grupos_opcionales_owner_all       ON public.grupos_opcionales;

CREATE POLICY grupos_opcionales_lectura_publica
  ON public.grupos_opcionales FOR SELECT
  USING (true);

CREATE POLICY grupos_opcionales_owner_all
  ON public.grupos_opcionales FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

DROP POLICY IF EXISTS opciones_items_lectura_publica ON public.opciones_items;
DROP POLICY IF EXISTS opciones_items_owner_all       ON public.opciones_items;

CREATE POLICY opciones_items_lectura_publica
  ON public.opciones_items FOR SELECT
  USING (true);

CREATE POLICY opciones_items_owner_all
  ON public.opciones_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.grupos_opcionales g
    JOIN public.comercios c ON c.id = g.comercio_id
    WHERE g.id = grupo_opcional_id AND c.usuario_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.grupos_opcionales g
    JOIN public.comercios c ON c.id = g.comercio_id
    WHERE g.id = grupo_opcional_id AND c.usuario_id = auth.uid()
  ));


-- ── 3. advertencias_comercio: nunca tuvo RLS ───────────────────────────────
-- comercio_id puede ser uuid o text según el entorno (ver nota histórica en
-- README-database.md) — se castea a ::text de los dos lados para no
-- depender de eso.
ALTER TABLE public.advertencias_comercio ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS advertencias_comercio_ver   ON public.advertencias_comercio;
DROP POLICY IF EXISTS advertencias_comercio_admin ON public.advertencias_comercio;

CREATE POLICY advertencias_comercio_ver
  ON public.advertencias_comercio FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.usuario_id = auth.uid() AND c.id::text = advertencias_comercio.comercio_id::text
  ));

CREATE POLICY advertencias_comercio_admin
  ON public.advertencias_comercio FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');


-- ── 4. reportes_comercio_ver: cualquier "comercio" veía TODOS los reportes ─
-- La política tenía "OR rol IN ('admin','comercio')" — cualquier usuario con
-- rol comercio pasaba el check para reportes de OTROS comercios. Se reemplaza
-- por un join real al comercio específico del reporte.
DROP POLICY IF EXISTS reportes_comercio_ver ON public.reportes;
CREATE POLICY reportes_comercio_ver
  ON public.reportes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.comercios c
      WHERE c.usuario_id = auth.uid() AND c.id::text = reportes.comercio_id::text
    )
  );


-- ── 5. chat_reportes_participantes: mismo problema que el de arriba ────────
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
          OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
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
          OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
          OR EXISTS (
            SELECT 1 FROM public.comercios c
            WHERE c.usuario_id = auth.uid() AND c.id::text = r.comercio_id::text
          )
        )
    )
  );


-- ── 6. perfiles_cadete_identidad_partes: comparaba comercio_id = auth.uid() ─
-- p.comercio_id referencia comercios.id (uuid random), NO el auth uid del
-- dueño — la comparación directa con auth.uid() nunca daba true. El comercio
-- nunca podía ver el perfil del cadete asignado a su pedido. Se corrige con
-- el mismo join que ya se usa en mensajes_pedido/pedidos.
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
          OR EXISTS (
            SELECT 1 FROM public.comercios c
            WHERE c.id = p.comercio_id AND c.usuario_id = auth.uid()
          )
        )
    )
  );


-- ── 7. Doble cobro de comisión: pedidos propio + efectivo ──────────────────
-- trg_pedidos_acumular_deuda (propio, en "preparando") y trg_pedidos_deuda_efectivo
-- (efectivo, en "entregado") no se excluían entre sí — un pedido con entrega
-- propia pagado en efectivo sumaba el 15% de comisión DOS VECES a comercios.deuda.
-- El trigger de efectivo ahora se salta los pedidos 'propio' (ya cobrados por
-- el otro trigger).
CREATE OR REPLACE FUNCTION public.pedidos_acumular_deuda_efectivo()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.metodo_pago = 'efectivo' AND NEW.comercio_id IS NOT NULL
     AND NEW.tipo_delivery IS DISTINCT FROM 'propio' THEN
    NEW.cobrado_efectivo := true;
    UPDATE public.comercios
    SET deuda = COALESCE(deuda, 0) + COALESCE(NEW.monto_comision_app, 0)
    WHERE id = NEW.comercio_id;
  ELSIF NEW.metodo_pago = 'efectivo' THEN
    -- Sigue marcando cobrado_efectivo para pedidos 'propio' (para reportes),
    -- pero sin sumar deuda de nuevo — ya se cobró al pasar a 'preparando'.
    NEW.cobrado_efectivo := true;
  END IF;
  RETURN NEW;
END;
$$;


-- ── 8. Trigger duplicado/huérfano de comisión de embajador ─────────────────
-- pedidos_comision_embajador (trigger de base) calculaba la comisión con
-- reglas distintas al backend (registrarComisionSiAplica en
-- embajadorController.js: usa patrocinios activos + subtotal + dedup real) y
-- escribía en billetera_embajadores (plural), una tabla que ningún dashboard
-- lee — lógica muerta y contradictoria. El backend es la fuente de verdad
-- real, así que se elimina el trigger de la base para no tener dos sistemas
-- calculando distinto.
DROP TRIGGER IF EXISTS trg_pedidos_comision_embajador ON public.pedidos;
DROP FUNCTION IF EXISTS public.pedidos_comision_embajador();
