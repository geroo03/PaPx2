-- ============================================================
-- Bloquear pedidos nuevos a comercios cerrados — a nivel de datos, no solo UI.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Hasta ahora "comercio cerrado" (comercios.abierto_ahora=false) solo
-- deshabilitaba el botón en la UI del cliente (frontend/assets/js/cliente.js,
-- confirmarPedido() nunca lo valida) — un insert directo a la tabla pedidos
-- igual funcionaba. Esta policy RESTRICTIVE se suma (con AND) a la policy ya
-- existente pedidos_cliente_insert (WITH CHECK cliente_id = auth.uid()), sin
-- reemplazarla — Postgres combina policies PERMISSIVE con OR entre ellas,
-- pero SIEMPRE exige que las RESTRICTIVE también se cumplan.
--
-- Usa public.rol_actual() (función SECURITY DEFINER ya existente, ver
-- migration-fix-recursion-perfiles-comercios-v3.sql) en vez de la subquery
-- inline que usa la policy vieja pedidos_admin_all, para no reintroducir el
-- patrón que causó la recursión RLS (42P17) documentada de una migración
-- anterior en esta misma sesión.
-- ============================================================

DROP POLICY IF EXISTS pedidos_bloquear_comercio_cerrado ON public.pedidos;
CREATE POLICY pedidos_bloquear_comercio_cerrado
  ON public.pedidos AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.comercios c
      WHERE c.id = comercio_id AND c.abierto_ahora = true
    )
    OR public.rol_actual() = 'admin'
  );
