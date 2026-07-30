-- ============================================================
-- Configuración de matching por ciudad — reemplaza las constantes
-- hardcodeadas de difundirPedido (RADIO_MAX_KM, MAX_OFERTAS, cutoff de GPS,
-- timeout de oferta) por una tabla ajustable sin redeploy.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Los valores sembrados abajo REPLICAN el comportamiento actual (mismo
-- radio/timeout/etc. que hoy) — ajustar por ciudad (ej. Córdoba con un
-- radio mayor) es un UPDATE posterior, no requiere tocar código ni
-- redeployar. La fila con ciudad=NULL es el default global (fallback si
-- el comercio no matchea ninguna ciudad conocida).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.configuracion_zonas (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciudad                          text UNIQUE,
  radio_km                        numeric NOT NULL DEFAULT 10,
  radio_ampliado_km               numeric NOT NULL DEFAULT 15,
  max_ofertas                     int4    NOT NULL DEFAULT 5,
  gps_max_antiguedad_min          int4    NOT NULL DEFAULT 30,
  oferta_timeout_seg              int4    NOT NULL DEFAULT 20,
  redifusion_intervalo_seg        int4    NOT NULL DEFAULT 45,
  redifusion_max_intentos         int4    NOT NULL DEFAULT 5,
  anticipacion_difusion_min       int4    NOT NULL DEFAULT 8,
  tiempo_preparacion_default_min  int4    NOT NULL DEFAULT 15,
  peso_distancia                  numeric NOT NULL DEFAULT 1.0,
  peso_rating                     numeric NOT NULL DEFAULT 1.0,
  peso_rotacion                   numeric NOT NULL DEFAULT 1.0,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

-- Índice para el lookup por nombre normalizado (sin tildes, minúsculas) que
-- hace ejecutarDifusion — se normaliza en la app, no en SQL, así que este
-- índice es solo sobre la columna cruda para el UNIQUE de arriba.

INSERT INTO public.configuracion_zonas (ciudad) VALUES (NULL)
  ON CONFLICT (ciudad) DO NOTHING;
INSERT INTO public.configuracion_zonas (ciudad) VALUES ('Santiago del Estero')
  ON CONFLICT (ciudad) DO NOTHING;
INSERT INTO public.configuracion_zonas (ciudad) VALUES ('La Plata')
  ON CONFLICT (ciudad) DO NOTHING;
INSERT INTO public.configuracion_zonas (ciudad) VALUES ('Cordoba')
  ON CONFLICT (ciudad) DO NOTHING;

-- Solo admin puede leer/escribir esta config — el backend igual usa
-- supabaseAdmin (bypassea RLS), esto es defensa en profundidad por si algún
-- día se expone por un cliente autenticado.
ALTER TABLE public.configuracion_zonas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS configuracion_zonas_admin_all ON public.configuracion_zonas;
CREATE POLICY configuracion_zonas_admin_all
  ON public.configuracion_zonas FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');
