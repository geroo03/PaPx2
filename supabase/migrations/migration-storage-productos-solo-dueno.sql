-- ============================================================
-- Storage bucket "productos": restringir escritura al dueño del comercio
-- Fecha: 2026-08-17
-- Idempotente — se puede re-ejecutar sin daño.
--
-- Encontrado en una auditoría de seguridad: la policy de INSERT original
-- (schema-definitivo-v2.sql, sección G) solo exige
-- `auth.role() = 'authenticated'` — CUALQUIER usuario logueado (cliente,
-- cadete, otro comercio, embajador) puede subir un archivo a la carpeta de
-- CUALQUIER OTRO comercio dentro de este bucket público de lectura, sin
-- que exista ningún chequeo de pertenencia (a diferencia de
-- `cadetes-antecedentes`, que sí valida `auth.uid() = primer segmento del
-- path`). Tampoco existían policies de UPDATE/DELETE para este bucket.
--
-- El path que usa comercio.js es `${comercio_id}/${timestamp}.${ext}` — se
-- reusa esa convención acá, igual que ya hace `cadetes-antecedentes` con
-- `storage.foldername(name)`, pero comparando contra la tabla `comercios`
-- vía `public.es_dueno_de_comercio()` en lugar de comparar directo con
-- `auth.uid()` (acá el primer segmento del path es el comercio_id, no el
-- uid del usuario).
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'productos') THEN

    DROP POLICY IF EXISTS "Productos: upload autenticado" ON storage.objects;
    DROP POLICY IF EXISTS "Productos: upload solo dueño del comercio" ON storage.objects;
    EXECUTE $p$
      CREATE POLICY "Productos: upload solo dueño del comercio"
      ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'productos'
        AND public.es_dueno_de_comercio(((storage.foldername(name))[1])::uuid)
      );
    $p$;

    DROP POLICY IF EXISTS "Productos: update solo dueño del comercio" ON storage.objects;
    EXECUTE $p$
      CREATE POLICY "Productos: update solo dueño del comercio"
      ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'productos'
        AND public.es_dueno_de_comercio(((storage.foldername(name))[1])::uuid)
      );
    $p$;

    DROP POLICY IF EXISTS "Productos: delete solo dueño del comercio" ON storage.objects;
    EXECUTE $p$
      CREATE POLICY "Productos: delete solo dueño del comercio"
      ON storage.objects FOR DELETE
      USING (
        bucket_id = 'productos'
        AND public.es_dueno_de_comercio(((storage.foldername(name))[1])::uuid)
      );
    $p$;

    -- La lectura pública ya estaba bien (necesaria para que el cliente vea
    -- las fotos de producto) — no se toca.
  END IF;
END;
$$;
