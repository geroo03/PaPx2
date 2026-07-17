-- ============================================================
-- Fix: bucket 'productos' permitía subir/sobrescribir archivos a
-- CUALQUIER usuario autenticado, sin validar dueño del comercio.
-- Fecha: 2026-07-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Encontrado en una revisión de ciberseguridad puntual (RLS de Storage no
-- había sido cubierta por la auditoría exhaustiva anterior, que se enfocó
-- en tablas de public.*).
-- ============================================================

-- ── 1. productos: la policy de INSERT solo chequeaba auth.role() ──────────
-- El path real que usa el frontend es "{comercio_id}/archivo.ext" (producto)
-- o "covers/{comercio_id}/portada.ext" (foto de portada del comercio) — ver
-- frontend/assets/js/comercio.js. Sin validar el path contra el dueño real,
-- cualquier cliente o cadete autenticado podía subir U OBSCRIBIR
-- (upsert:true) las fotos de CUALQUIER comercio.
DROP POLICY IF EXISTS "Productos: upload autenticado" ON storage.objects;
DROP POLICY IF EXISTS "Productos: solo dueño sube"     ON storage.objects;
CREATE POLICY "Productos: solo dueño sube"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'productos'
    AND EXISTS (
      SELECT 1 FROM public.comercios c
      WHERE c.usuario_id = auth.uid()
        AND (
          (storage.foldername(name))[1] = c.id::text
          OR ((storage.foldername(name))[1] = 'covers' AND (storage.foldername(name))[2] = c.id::text)
        )
    )
  );

-- upsert:true en supabase-js hace INSERT ... ON CONFLICT, que Storage evalúa
-- contra la policy de UPDATE cuando el objeto ya existe — sin esta policy,
-- el upsert de un archivo ya existente quedaba bloqueado por el dueño real,
-- pero por las dudas (versiones futuras del cliente) se agrega explícita.
DROP POLICY IF EXISTS "Productos: update dueño" ON storage.objects;
CREATE POLICY "Productos: update dueño"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'productos'
    AND EXISTS (
      SELECT 1 FROM public.comercios c
      WHERE c.usuario_id = auth.uid()
        AND (
          (storage.foldername(name))[1] = c.id::text
          OR ((storage.foldername(name))[1] = 'covers' AND (storage.foldername(name))[2] = c.id::text)
        )
    )
  );

-- ── 2. Límite de tamaño + tipo MIME a nivel bucket (defensa en profundidad)
-- Ni siquiera un dueño legítimo puede subir algo que no sea imagen o que
-- pese más de 5MB. Evita abuso de storage (archivos grandes/arbitrarios)
-- aunque una cuenta esté comprometida.
UPDATE storage.buckets
SET file_size_limit    = 5242880,  -- 5 MB
    allowed_mime_types  = ARRAY['image/jpeg','image/png','image/webp','image/gif']
WHERE id = 'productos';

UPDATE storage.buckets
SET file_size_limit    = 8388608,  -- 8 MB (fotos de DNI/carnet suelen pesar más)
    allowed_mime_types  = ARRAY['image/jpeg','image/png','image/webp','application/pdf']
WHERE id = 'cadetes-antecedentes';
