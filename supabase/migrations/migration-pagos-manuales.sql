-- ============================================================
-- Pagos manuales (depósitos que hace el admin a mano)
-- Fecha: 2026-09-07
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Hasta ahora no había forma de ver en un solo lugar cuánta plata hay que
-- depositarle a cada embajador, cadete y comercio, ni de registrar que ya
-- se depositó. El admin tenía que llevar la cuenta por fuera del sistema.
--
-- Cada fila es UN depósito hecho a mano (transferencia bancaria, efectivo,
-- lo que sea) desde la plataforma hacia un embajador, un cadete o un
-- comercio. Es un registro contable: no mueve plata, la deja anotada.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pagos_manuales (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo            text          NOT NULL,
  -- Sin FK a propósito: el destinatario apunta a auth.users cuando el tipo es
  -- 'embajador' o 'cadete' (mismo criterio que billetera_embajador.embajador_id
  -- y cadetes.auth_uid), pero a comercios.id cuando el tipo es 'comercio'.
  -- Postgres no soporta una FK que apunte a dos tablas según el valor de otra
  -- columna, y partir esto en tres tablas para ganar la FK complicaría más de
  -- lo que resuelve. La integridad la garantiza el backend (adminController).
  destinatario_id uuid          NOT NULL,
  monto           numeric(12,2) NOT NULL,
  metodo          text          NOT NULL DEFAULT 'transferencia',
  referencia      text,         -- nro de comprobante, CBU usado, lo que sirva para rastrearlo
  notas           text,
  pagado_por      uuid          NOT NULL,  -- auth.users del admin que lo registró
  created_at      timestamptz   NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.pagos_manuales
    ADD CONSTRAINT pagos_manuales_tipo_check
    CHECK (tipo IN ('embajador', 'cadete', 'comercio'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.pagos_manuales
    ADD CONSTRAINT pagos_manuales_monto_check
    CHECK (monto > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_pagos_manuales_destinatario
  ON public.pagos_manuales (tipo, destinatario_id, created_at DESC);

ALTER TABLE public.pagos_manuales ENABLE ROW LEVEL SECURITY;

-- Solo admin. Nadie más tiene por qué ver los depósitos de los demás, y el
-- backend entra con service_role (bypasea RLS igual).
-- Se usa public.rol_actual() y NO una subquery inline a perfiles: las
-- subqueries inline causaron una recursión infinita real en producción
-- (42P17), ver CLAUDE.md §7.
DROP POLICY IF EXISTS pagos_manuales_admin_all ON public.pagos_manuales;
CREATE POLICY pagos_manuales_admin_all
  ON public.pagos_manuales FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');

-- ============================================================
-- pedidos.liquidado_comercio
--
-- Marca que a ESE pedido ya se le pagó al comercio la parte que le
-- corresponde. Hace falta una columna nueva porque `pedidos.liquidado`
-- (que ya existía en el schema) se adopta para el pago al CADETE — era una
-- columna muerta, ningún código del repo la leía ni la escribía, así que
-- darle este significado no rompe nada.
--
-- Con estas dos banderas, "cuánto le debo" es siempre una suma directa sobre
-- pedidos entregados sin marcar, sin depender de fechas de corte ni de en qué
-- orden se hicieron los depósitos.
-- ============================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS liquidado_comercio boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_pedidos_liquidacion_cadete
  ON public.pedidos (cadete_id, estado, liquidado);

CREATE INDEX IF NOT EXISTS idx_pedidos_liquidacion_comercio
  ON public.pedidos (comercio_id, estado, liquidado_comercio);
