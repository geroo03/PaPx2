-- Migration: Create cadetes table and policies

-- 1. Create table
CREATE TABLE IF NOT EXISTS public.cadetes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid uuid REFERENCES auth.users(id) UNIQUE, -- Un registro por cadete
  nombre text NOT NULL,
  fecha_nacimiento date,
  email text,
  vehiculo text,
  color text,
  patente text,
  antecedentes boolean DEFAULT false,
  antecedentes_path text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Enable RLS
ALTER TABLE public.cadetes ENABLE ROW LEVEL SECURITY;

-- 3. Policies
-- Permitir seleccionar el propio perfil
CREATE POLICY "Permitir select para el dueño" ON public.cadetes
  FOR SELECT
  USING (auth.uid() = auth_uid);

-- Permitir insertar/actualizar su propio perfil
CREATE POLICY "Permitir upsert para el dueño" ON public.cadetes
  FOR INSERT
  WITH CHECK (auth.uid() = auth_uid);

CREATE POLICY "Permitir update para el dueño" ON public.cadetes
  FOR UPDATE
  USING (auth.uid() = auth_uid)
  WITH CHECK (auth.uid() = auth_uid);

-- 4. Trigger de updated_at
CREATE OR REPLACE FUNCTION public.set_current_timestamp_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.cadetes;
CREATE TRIGGER trg_set_updated_at
BEFORE UPDATE ON public.cadetes
FOR EACH ROW EXECUTE PROCEDURE set_current_timestamp_updated_at();

-- Nota: Recordá crear el bucket "cadetes-antecedentes" de forma manual en el panel de Storage y hacerlo privado,
-- y configurar las policies de inserción para ese bucket (o mediante SQL, aunque desde UI suele ser más fácil).