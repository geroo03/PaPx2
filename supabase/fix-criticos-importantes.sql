-- ============================================================
-- PUERTA A PUERTA X — PARCHE BUGS CRÍTICOS E IMPORTANTES
-- Fecha: 2026-07-06
-- ============================================================
-- Ejecutar completo en el SQL Editor de Supabase.
-- Es idempotente: se puede re-ejecutar sin daño.
-- ============================================================


-- ── 1. ratings: agregar columna 'rating' que usa el backend ──────────────────
-- El backend inserta { rating: estrellasNum } pero la tabla solo tenía
-- 'puntaje_comercio' y 'puntaje_cadete'. Causa un 500 en cada valoración.
ALTER TABLE public.ratings ADD COLUMN IF NOT EXISTS rating int2 CHECK (rating BETWEEN 1 AND 5);

-- Rellenar 'rating' con el valor de 'puntaje_comercio' en filas existentes
UPDATE public.ratings SET rating = puntaje_comercio
  WHERE rating IS NULL AND puntaje_comercio IS NOT NULL;


-- ── 2. resenas: crear tabla (faltaba completamente) ───────────────────────────
-- El backend insertaba en 'resenas' pero la tabla no existía.
-- Causaba un 500 en cada valoración de cadete.
CREATE TABLE IF NOT EXISTS public.resenas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        REFERENCES public.pedidos(id) ON DELETE CASCADE,
  cadete_id   uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating      int2        NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comentario  text,
  created_at  timestamptz DEFAULT now()
);

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.resenas
      ADD CONSTRAINT resenas_pedido_cadete_key UNIQUE (pedido_id, cadete_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END; $$;

ALTER TABLE public.resenas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS resenas_cliente_insert      ON public.resenas;
DROP POLICY IF EXISTS resenas_participante_select ON public.resenas;

CREATE POLICY resenas_cliente_insert
  ON public.resenas FOR INSERT
  WITH CHECK (auth.uid() = cliente_id);

CREATE POLICY resenas_participante_select
  ON public.resenas FOR SELECT
  USING (auth.uid() = cliente_id OR auth.uid() = cadete_id);

CREATE POLICY resenas_admin_all
  ON public.resenas FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');


-- ── 3. reportes: agregar columnas que usa el cliente ─────────────────────────
-- El cliente inserta { tipo, comercio_id, limite_resolucion } pero el schema
-- solo tenía 'motivo NOT NULL' — todo insert fallaba.
ALTER TABLE public.reportes ALTER COLUMN motivo           DROP NOT NULL;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS tipo              text;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS comercio_id       uuid;
ALTER TABLE public.reportes ADD COLUMN IF NOT EXISTS limite_resolucion timestamptz;


-- ── 4. reportes: políticas RLS (faltaban completamente → deny-all) ───────────
DROP POLICY IF EXISTS reportes_owner_all    ON public.reportes;
DROP POLICY IF EXISTS reportes_comercio_ver ON public.reportes;
DROP POLICY IF EXISTS reportes_admin_all    ON public.reportes;

CREATE POLICY reportes_owner_all
  ON public.reportes FOR ALL
  USING  (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY reportes_comercio_ver
  ON public.reportes FOR SELECT
  USING (
    auth.uid()::text = comercio_id
    OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) IN ('admin', 'comercio')
  );

CREATE POLICY reportes_admin_all
  ON public.reportes FOR ALL
  USING  ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');


-- ── 5. chat_reportes: habilitar RLS + políticas ───────────────────────────────
-- Sin RLS cualquier usuario podía insertar mensajes falsos (XSS vector).
ALTER TABLE public.chat_reportes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_reportes_participantes ON public.chat_reportes;
DROP POLICY IF EXISTS chat_reportes_admin         ON public.chat_reportes;

CREATE POLICY chat_reportes_participantes
  ON public.chat_reportes FOR ALL
  USING (
    reporte_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.reportes r
      WHERE r.id = chat_reportes.reporte_id
        AND (
          r.usuario_id = auth.uid()
          OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) IN ('admin', 'comercio')
        )
    )
  )
  WITH CHECK (
    reporte_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.reportes r
      WHERE r.id = chat_reportes.reporte_id
        AND (
          r.usuario_id = auth.uid()
          OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) IN ('admin', 'comercio')
        )
    )
  );


-- ── 6. patrocinios: separar banners del sistema de embajadores ────────────────
-- El schema tenía dos CREATE TABLE IF NOT EXISTS patrocinios con estructuras
-- distintas (bigserial banners y uuid embajador-comercio). La primera ganó,
-- la segunda fue silenciada → tabla híbrida corrupta. El sistema de comisiones
-- de embajadores nunca funcionó correctamente.

-- 6a. Crear tabla 'banners' para contenido publicitario
CREATE TABLE IF NOT EXISTS public.banners (
  id          bigserial   PRIMARY KEY,
  sub_titulo  text,
  titulo      text,
  imagen_url  text,
  link_oferta text,
  orden       int4        DEFAULT 0,
  activo      bool        DEFAULT true,
  creado_at   timestamptz DEFAULT now()
);

-- 6b. Migrar filas de banners a la nueva tabla (solo si titulo existe en patrocinios)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patrocinios' AND column_name = 'titulo'
  ) THEN
    INSERT INTO public.banners (sub_titulo, titulo, imagen_url, link_oferta, orden, activo, creado_at)
    SELECT sub_titulo, titulo, imagen_url, link_oferta,
           COALESCE(orden, 0),
           COALESCE(activo, true),
           COALESCE(creado_at, now())
    FROM public.patrocinios
    WHERE embajador_id IS NULL AND titulo IS NOT NULL
    ON CONFLICT DO NOTHING;
  END IF;
END; $$;

-- 6c. Reemplazar la tabla híbrida con la correcta (uuid PK, relación embajador-comercio)
DROP TABLE IF EXISTS public.patrocinios CASCADE;

CREATE TABLE public.patrocinios (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comercio_id  uuid        NOT NULL REFERENCES public.comercios(id) ON DELETE CASCADE,
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  BEGIN
    ALTER TABLE public.patrocinios
      ADD CONSTRAINT patrocinios_embajador_comercio_key UNIQUE (embajador_id, comercio_id);
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END; $$;

ALTER TABLE public.patrocinios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patrocinios_embajador_select ON public.patrocinios;
DROP POLICY IF EXISTS patrocinios_admin_all        ON public.patrocinios;

CREATE POLICY patrocinios_embajador_select
  ON public.patrocinios FOR SELECT
  USING (
    embajador_id = auth.uid()
    OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
  );

CREATE POLICY patrocinios_admin_all
  ON public.patrocinios FOR ALL
  USING  ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

CREATE POLICY patrocinios_embajador_insert
  ON public.patrocinios FOR INSERT
  WITH CHECK (
    embajador_id = auth.uid()
    AND (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
  );


-- ── 7. referidos_cadete: unique constraint (previene race condition TOCTOU) ───
DO $$ BEGIN
  BEGIN
    ALTER TABLE public.referidos_cadete
      ADD CONSTRAINT referidos_cadete_referido_key UNIQUE (referido_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
            WHEN duplicate_table   THEN NULL;
  END;
END; $$;


-- ── 8. advertencias_comercio: convertir comercio_id de text a uuid ───────────
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
        RAISE NOTICE 'No se pudo convertir advertencias_comercio.comercio_id a uuid. Revisar datos.';
      END;
    END IF;
  END IF;
END; $$;


-- ── 9. fcm_tokens: asegurar user_id es uuid ──────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'fcm_tokens'
      AND column_name = 'user_id' AND data_type = 'text'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.fcm_tokens
      WHERE user_id IS NOT NULL
        AND user_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) THEN
      BEGIN
        ALTER TABLE public.fcm_tokens
          ALTER COLUMN user_id TYPE uuid USING user_id::uuid;
        ALTER TABLE public.fcm_tokens
          ADD CONSTRAINT fcm_tokens_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'No se pudo convertir fcm_tokens.user_id a uuid.';
      END;
    END IF;
  END IF;
END; $$;


-- ── 10. banners: habilitar RLS ────────────────────────────────────────────────
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS banners_lectura_publica ON public.banners;
CREATE POLICY banners_lectura_publica
  ON public.banners FOR SELECT
  USING (activo = true);
DROP POLICY IF EXISTS banners_admin_all ON public.banners;
CREATE POLICY banners_admin_all
  ON public.banners FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.perfiles AS p
      WHERE p.usuario_id = auth.uid() AND p.rol = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.perfiles AS p
      WHERE p.usuario_id = auth.uid() AND p.rol = 'admin'
    )
  );


-- ── FIN DEL PARCHE ────────────────────────────────────────────────────────────
-- Verificar que las tablas críticas existen:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
--   AND table_name IN ('ratings','resenas','reportes','chat_reportes','patrocinios','banners');
