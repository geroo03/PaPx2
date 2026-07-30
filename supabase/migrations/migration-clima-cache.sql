-- ============================================================
-- Caché de clima por grilla geográfica — usada por climaService.js para
-- detectar automáticamente lluvia/mal tiempo cerca de un comercio, sin
-- pegarle a wttr.in en cada difusión de pedido.
-- Fecha: 2026-07-30
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Se cachea por grilla (lat/lng redondeados a 1 decimal, ~11km de lado),
-- NO por comercios.ciudad — así una ciudad grande como Córdoba puede tener
-- lluvia en un barrio y sol en otro, sin depender de que el comercio haya
-- tipeado bien su ciudad (es texto libre, ver README-database.md).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.clima_cache (
  grid_lat       numeric NOT NULL,
  grid_lng       numeric NOT NULL,
  clima_adverso  bool    NOT NULL DEFAULT false,
  weather_code   int4,
  precip_mm      numeric,
  temperatura_c  numeric,
  descripcion    text,
  actualizado_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (grid_lat, grid_lng)
);

-- Sin RLS: solo el backend (supabaseAdmin) lee/escribe esta tabla, no hay
-- ningún acceso directo desde el cliente/comercio/cadete a estos datos.
ALTER TABLE public.clima_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clima_cache_admin_all ON public.clima_cache;
CREATE POLICY clima_cache_admin_all
  ON public.clima_cache FOR ALL
  USING (public.rol_actual() = 'admin')
  WITH CHECK (public.rol_actual() = 'admin');
