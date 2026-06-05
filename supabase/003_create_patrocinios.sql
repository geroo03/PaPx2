-- Create patrocinios table for dynamic carousel
CREATE TABLE IF NOT EXISTS public.patrocinios (
  id BIGSERIAL PRIMARY KEY,
  sub_titulo TEXT,
  titulo TEXT,
  imagen_url TEXT,
  link_oferta TEXT,
  orden INT DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  creado_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Optional: create index on orden for faster ordering
CREATE INDEX IF NOT EXISTS idx_patrocinios_orden ON public.patrocinios (orden);
