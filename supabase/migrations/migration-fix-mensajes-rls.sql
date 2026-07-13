-- ============================================================
-- FIX: mensajes_pedido RLS comparaba comercio_id contra auth.uid()
-- pedidos.comercio_id referencia comercios.id, NO auth.users.id.
-- Hay que pasar por comercios.usuario_id para validar el dueño.
-- ============================================================

DROP POLICY IF EXISTS mensajes_select_partes ON public.mensajes_pedido;
DROP POLICY IF EXISTS mensajes_insert_partes ON public.mensajes_pedido;

CREATE POLICY mensajes_select_partes
  ON public.mensajes_pedido FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      LEFT JOIN public.comercios c ON c.id = p.comercio_id
      WHERE p.id = mensajes_pedido.pedido_id
        AND (p.cliente_id = auth.uid() OR c.usuario_id = auth.uid() OR p.cadete_id = auth.uid())
    )
    OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
  );

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
    AND rol_remitente = (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid())
  );
