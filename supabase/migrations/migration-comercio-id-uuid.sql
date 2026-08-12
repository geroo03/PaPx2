-- ============================================================
-- Deuda técnica: advertencias_comercio.comercio_id y
-- chat_reportes.comercio_id de text a uuid
-- Fecha: 2026-08-11
-- Idempotente — se puede re-ejecutar sin daño.
--
-- reportes.comercio_id ya es uuid (se agregó así desde el principio en
-- fix-criticos-importantes.sql) — no es parte de esta migración.
--
-- advertencias_comercio.comercio_id tuvo un intento de conversión en
-- fix-criticos-importantes.sql (bloque "8"), pero es best-effort: si
-- algún valor no tenía forma de uuid, el ALTER se saltaba en silencio,
-- sin garantía de haber corrido. chat_reportes.comercio_id nunca tuvo
-- ningún intento de conversión.
--
-- Las policies RLS actuales ya castean ambos lados a ::text
-- (advertencias_comercio_ver, chat_reportes_participantes), así que
-- siguen funcionando sin cambios apenas la columna pase a uuid — no son
-- bloqueantes para correr esto. advertencias_comercio_ver se simplifica
-- de paso (saca el cast redundante, usa es_dueno_de_comercio() como el
-- resto del schema).
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'advertencias_comercio'
      AND column_name = 'comercio_id' AND data_type = 'text'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.advertencias_comercio
      WHERE comercio_id IS NOT NULL
        AND comercio_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
      BEGIN
        ALTER TABLE public.advertencias_comercio
          ALTER COLUMN comercio_id TYPE uuid USING comercio_id::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo convertir advertencias_comercio.comercio_id a uuid (error inesperado). Revisar datos.';
      END;
    ELSE
      RAISE NOTICE 'advertencias_comercio.comercio_id tiene valores sin forma de uuid — no se convirtió. Revisar datos a mano.';
    END IF;
  END IF;
END; $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'chat_reportes'
      AND column_name = 'comercio_id' AND data_type = 'text'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.chat_reportes
      WHERE comercio_id IS NOT NULL
        AND comercio_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
      BEGIN
        ALTER TABLE public.chat_reportes
          ALTER COLUMN comercio_id TYPE uuid USING comercio_id::uuid;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo convertir chat_reportes.comercio_id a uuid (error inesperado). Revisar datos.';
      END;
    ELSE
      RAISE NOTICE 'chat_reportes.comercio_id tiene valores sin forma de uuid — no se convirtió. Revisar datos a mano.';
    END IF;
  END IF;
END; $$;

-- ── advertencias_comercio_ver: simplificada, sin el cast a ambos lados ──────
-- El cast explícito a ::uuid queda igual de necesario si comercio_id ya es
-- uuid (no-op) que en el caso raro de que la conversión de arriba no haya
-- podido correr (sigue en text) — es_dueno_de_comercio() espera uuid.
-- El acceso de admin ya lo cubre la policy separada advertencias_comercio_admin
-- (mismo criterio de una policy por rol/caso que el resto del schema).
DROP POLICY IF EXISTS advertencias_comercio_ver ON public.advertencias_comercio;
CREATE POLICY advertencias_comercio_ver
  ON public.advertencias_comercio FOR SELECT
  USING (public.es_dueno_de_comercio(comercio_id::uuid));
