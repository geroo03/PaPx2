-- ============================================================
-- Cierres especiales por fecha (comercio)
-- Fecha: 2026-08-11
-- Idempotente — se puede re-ejecutar sin daño.
--
-- El panel de comercio (Horarios → "Agregar cierre especial") ya tenía el
-- modal armado (fecha + motivo opcional) pero `saveCierre()` solo mostraba
-- un toast de éxito sin escribir nada — no existía ninguna tabla para esto.
-- Detectado en la auditoría de código muerto del 7 de agosto (v3.11.0),
-- documentado como pendiente en PENDIENTES-LANZAMIENTO.md #7.
--
-- Cada fila es un día puntual en el que el comercio no abre, sin importar
-- su horario_apertura/horario_cierre/dias_abierto normal (ej: feriado,
-- vacaciones — para varios días se cargan varias filas, una por fecha).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cierres_especiales (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id  uuid        NOT NULL REFERENCES public.comercios(id) ON DELETE CASCADE,
  fecha        date        NOT NULL,
  motivo       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cierres_especiales_comercio_fecha
  ON public.cierres_especiales (comercio_id, fecha);

ALTER TABLE public.cierres_especiales ENABLE ROW LEVEL SECURITY;

-- El comercio dueño gestiona sus propios cierres (ver/crear/borrar).
DROP POLICY IF EXISTS cierres_especiales_owner_all ON public.cierres_especiales;
CREATE POLICY cierres_especiales_owner_all
  ON public.cierres_especiales FOR ALL
  USING (public.es_dueno_de_comercio(comercio_id))
  WITH CHECK (public.es_dueno_de_comercio(comercio_id));

-- Lectura pública liviana: el cliente ve si un comercio está cerrado hoy
-- por un cierre especial (mismo criterio que `comercios.abierto_ahora`,
-- que ya es público).
DROP POLICY IF EXISTS cierres_especiales_lectura_publica ON public.cierres_especiales;
CREATE POLICY cierres_especiales_lectura_publica
  ON public.cierres_especiales FOR SELECT
  USING (true);

-- Admin: acceso total (mismo patrón que el resto del schema).
DROP POLICY IF EXISTS cierres_especiales_admin_all ON public.cierres_especiales;
CREATE POLICY cierres_especiales_admin_all
  ON public.cierres_especiales FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');
