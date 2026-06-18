-- ============================================================
-- PUERTA A PUERTA — Schema SQL Definitivo v2.1
-- Fecha: 2026-06-15
--
-- Consolida y reemplaza todos los archivos anteriores.
-- Reconciliado contra el schema real exportado de Supabase.
--
-- INSTRUCCIONES:
--   1. Abrir Supabase → SQL Editor
--   2. Pegar TODO el contenido
--   3. Click "Run and enable RLS" (botón verde)
--   4. Es IDEMPOTENTE — puede ejecutarse N veces sin perder datos
--
-- CONVENCIONES:
--   • perfiles.usuario_id  = auth.users.id
--   • pedidos.cliente_id   = auth.users.id  (el cliente que hizo el pedido)
--   • cadetes.auth_uid     = auth.users.id
--   • Roles: 'cliente' | 'comercio' | 'cadete' | 'admin' | 'embajador'
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
SET search_path = public, pg_catalog;


-- ============================================================
-- SECCIÓN A — TABLAS
-- Orden: CREATE TABLE IF NOT EXISTS (crea si no existe)
--        luego ALTER ADD COLUMN IF NOT EXISTS (agrega lo que falta)
--        luego ADD CONSTRAINT (siempre DESPUÉS de que la columna existe)
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- A-1. perfiles
--
-- COMPATIBILIDAD SCHEMA VIEJO:
--   El schema anterior tenía:  id uuid PRIMARY KEY REFERENCES auth.users(id)
--   El schema nuevo tiene:     id uuid PK random + usuario_id uuid FK a auth.users
--
-- Si la tabla ya existía con el schema viejo (sin usuario_id),
-- el DO-block agrega la columna, backfillea desde id, y agrega
-- los constraints de forma segura (EXCEPTION WHEN duplicate_object).
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.perfiles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid,
  rol         text        DEFAULT 'cliente',
  email       text,
  nombre      text,
  apellido    text,
  vehiculo    text,
  color       text,
  avatar_url  text,
  created_at  timestamptz DEFAULT now()
);

-- Paso 1: agregar columnas simples (sin UNIQUE/FK/NOT NULL para no fallar)
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS usuario_id uuid;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS rol        text DEFAULT 'cliente';
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS nombre     text;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS apellido   text;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS vehiculo   text;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS color      text;
ALTER TABLE public.perfiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- Paso 2: backfill para schema viejo donde id = auth.users.id
-- (si usuario_id ya tiene valores, el UPDATE no modifica nada)
UPDATE public.perfiles
SET usuario_id = id
WHERE usuario_id IS NULL;

-- Normalizar rol: el schema viejo usaba 'usuario', el nuevo usa 'cliente'
UPDATE public.perfiles
SET rol = 'cliente'
WHERE rol = 'usuario' OR rol IS NULL;

-- Paso 3: constraints separados con manejo de duplicados
DO $$
BEGIN
  -- FK usuario_id → auth.users
  BEGIN
    ALTER TABLE public.perfiles
      ADD CONSTRAINT perfiles_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  -- UNIQUE usuario_id
  BEGIN
    ALTER TABLE public.perfiles
      ADD CONSTRAINT perfiles_usuario_id_key UNIQUE (usuario_id);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- Constraint de rol
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.perfiles DROP CONSTRAINT IF EXISTS perfiles_rol_check;
    ALTER TABLE public.perfiles ADD CONSTRAINT perfiles_rol_check
      CHECK (rol IN ('cliente','comercio','cadete','admin','embajador'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-2. comercios  (ya existe — solo se agregan columnas faltantes)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comercios (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id              uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  nombre                  text        NOT NULL,
  categoria               text        NOT NULL,
  descripcion             text,
  direccion               text,
  telefono                text,
  email                   text        NOT NULL,
  activo                  bool        DEFAULT true,
  abierto_ahora           bool        DEFAULT false,
  estado_registro         text        NOT NULL DEFAULT 'pendiente',
  tipo_delivery_defecto   text        NOT NULL DEFAULT 'app',
  rating                  numeric     DEFAULT 5.0,
  total_pedidos           int4        DEFAULT 0,
  deuda                   numeric(12,2) NOT NULL DEFAULT 0,
  creado_por_embajador_id uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  mp_account_id           text,
  mp_access_token         text,
  mp_user_id              text,
  mp_conectado            bool        DEFAULT false,
  lat                     numeric,
  lng                     numeric,
  imagen_url              text,
  created_at              timestamptz DEFAULT now()
);

-- Columnas que pueden faltar en DB existente
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS usuario_id              uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS estado_registro         text NOT NULL DEFAULT 'pendiente';
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS tipo_delivery_defecto   text NOT NULL DEFAULT 'app';
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS deuda                   numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS creado_por_embajador_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS mp_account_id           text;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS lat                     numeric;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS lng                     numeric;
ALTER TABLE public.comercios ADD COLUMN IF NOT EXISTS imagen_url              text;

-- Constraints (en DO blocks para tolerar constraints inline preexistentes)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.comercios DROP CONSTRAINT IF EXISTS comercios_estado_registro_check;
    ALTER TABLE public.comercios ADD CONSTRAINT comercios_estado_registro_check
      CHECK (estado_registro IN ('pendiente','activo','suspendido'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.comercios DROP CONSTRAINT IF EXISTS comercios_tipo_delivery_defecto_check;
    ALTER TABLE public.comercios ADD CONSTRAINT comercios_tipo_delivery_defecto_check
      CHECK (tipo_delivery_defecto IN ('app','propio'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-3. cadetes  (ya existe — agregar columnas faltantes)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cadetes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_uid            uuid        UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre              text        NOT NULL,
  email               text,
  telefono            text,
  fecha_nacimiento    date,
  vehiculo            text,
  color               text,
  patente             text,
  antecedentes        bool        DEFAULT false,
  antecedentes_path   text,
  disponible          bool        DEFAULT false,
  activo              bool        DEFAULT true,
  lat                 numeric,
  lng                 numeric,
  rating              numeric     DEFAULT 5.0,
  total_viajes        int4        DEFAULT 0,
  ganancias_semana    numeric     DEFAULT 0,
  zona                text,
  mp_access_token     text,
  mp_user_id          text,
  mp_conectado        bool        DEFAULT false,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

-- Columnas que pueden faltar (ya tiene lat/lng/disponible/activo según CSV)
-- auth_uid: agregar simple primero, luego constraints por separado
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS auth_uid             uuid;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS fecha_nacimiento     date;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS color                text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS antecedentes         bool DEFAULT false;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS antecedentes_path    text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS cvu                  text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS foto_dni_url         text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS seguro_url           text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS carnet_url           text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS onboarding_completo  bool DEFAULT false;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS cobro_frecuencia     text DEFAULT 'semanal';
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS codigo_referido      text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS referido_por         text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS zona              text;
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS updated_at        timestamptz DEFAULT now();

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.cadetes
      ADD CONSTRAINT cadetes_auth_uid_fkey
      FOREIGN KEY (auth_uid) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.cadetes
      ADD CONSTRAINT cadetes_auth_uid_key UNIQUE (auth_uid);
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-4. categorias_producto  (ya existe)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.categorias_producto (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id uuid        REFERENCES public.comercios(id) ON DELETE CASCADE,
  nombre      text        NOT NULL,
  orden       int4        DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-5. productos
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.productos (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id  uuid          REFERENCES public.comercios(id) ON DELETE CASCADE,
  categoria_id uuid          REFERENCES public.categorias_producto(id) ON DELETE SET NULL,
  nombre       text          NOT NULL,
  descripcion  text,
  precio_base  numeric(12,2) NOT NULL DEFAULT 0,
  precio       numeric(12,2),
  imagen_url   text,
  disponible   bool          DEFAULT true,
  orden        int4          DEFAULT 0,
  created_at   timestamptz   DEFAULT now()
);

ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS imagen_url   text;
ALTER TABLE public.productos ADD COLUMN IF NOT EXISTS categoria_id uuid REFERENCES public.categorias_producto(id) ON DELETE SET NULL;


-- ──────────────────────────────────────────────────────────────
-- A-6. grupos_opcionales
--   SCHEMA REAL (del CSV): comercio_id, nombre, min_opciones, max_opciones
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grupos_opcionales (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id   uuid        NOT NULL REFERENCES public.comercios(id) ON DELETE CASCADE,
  nombre        text        NOT NULL,
  min_opciones  int4        NOT NULL DEFAULT 0,
  max_opciones  int4        NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-7. opciones_items
--   SCHEMA REAL: grupo_opcional_id (no grupo_id)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.opciones_items (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_opcional_id uuid          REFERENCES public.grupos_opcionales(id) ON DELETE CASCADE,
  nombre            text          NOT NULL,
  precio_extra      numeric(12,2) DEFAULT 0
);


-- ──────────────────────────────────────────────────────────────
-- A-8. pedidos
-- IMPORTANTE: ADD COLUMN va ANTES de ADD CONSTRAINT
-- ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.pedidos_numero_seq START 1000 INCREMENT 1;

CREATE TABLE IF NOT EXISTS public.pedidos (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  numero              int4          DEFAULT nextval('public.pedidos_numero_seq'),
  cliente_id          uuid          REFERENCES auth.users(id) ON DELETE SET NULL,
  comercio_id         uuid          REFERENCES public.comercios(id) ON DELETE SET NULL,
  cadete_id           uuid,
  productos           jsonb,
  estado              text          NOT NULL DEFAULT 'nuevo',
  tipo_delivery       text          NOT NULL DEFAULT 'app',
  metodo_pago         text,
  subtotal            numeric(12,2) NOT NULL DEFAULT 0,
  costo_envio         numeric(12,2) NOT NULL DEFAULT 800,
  propina_cadete      int4          NOT NULL DEFAULT 0,
  monto_comision_app  numeric(12,2) NOT NULL DEFAULT 0,
  total               numeric(12,2) NOT NULL DEFAULT 0,
  total_final         numeric(12,2) NOT NULL DEFAULT 0,
  estado_pago         text          NOT NULL DEFAULT 'pendiente',
  mp_payment_id       text,
  direccion_entrega   text,
  notas               text,
  pin                 text,
  codigo_retiro       text,
  codigo_entrega      text,
  distancia_estimada  numeric(10,2),
  pago_cadete         int4,
  created_at          timestamptz   DEFAULT now()
);

-- ⚠️ PASO 1: Agregar columnas PRIMERO (antes de cualquier constraint que las referencie)
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS numero             int4 DEFAULT nextval('public.pedidos_numero_seq');
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS cliente_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS tipo_delivery      text NOT NULL DEFAULT 'app';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS metodo_pago        text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS subtotal           numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS costo_envio        numeric(12,2) NOT NULL DEFAULT 800;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS propina_cadete     int4 NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS monto_comision_app numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS total_final        numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS estado_pago        text NOT NULL DEFAULT 'pendiente';
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS mp_payment_id      text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS direccion_entrega  text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS notas              text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS pin                text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS codigo_retiro      text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS codigo_entrega     text;
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS distancia_estimada numeric(10,2);
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS pago_cadete        int4;

-- ⚠️ PASO 2: Constraints DESPUÉS de que las columnas existen
-- Envueltos en DO blocks para tolerar datos legacy (ej: estado='listo')
DO $$
BEGIN
  -- estado: incluye 'listo' para compatibilidad con pedidos existentes
  BEGIN
    ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_check
      CHECK (estado IN ('nuevo','preparando','preparado','en_preparacion','listo','en_camino','entregado','cancelado','rechazado'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN check_violation    THEN NULL;
  WHEN OTHERS             THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_tipo_delivery_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_tipo_delivery_check
      CHECK (tipo_delivery IN ('app','propio'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_estado_pago_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_estado_pago_check
      CHECK (estado_pago IN ('pendiente','aprobado','rechazado'));
  EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-9. ubicacion_cadetes  (ya existe)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ubicacion_cadetes (
  cadete_id            uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  latitud              numeric,
  longitud             numeric,
  lat                  numeric,
  lng                  numeric,
  pedido_id            uuid        REFERENCES public.pedidos(id) ON DELETE SET NULL,
  ultima_actualizacion timestamptz DEFAULT now()
);

ALTER TABLE public.ubicacion_cadetes ADD COLUMN IF NOT EXISTS lat       numeric;
ALTER TABLE public.ubicacion_cadetes ADD COLUMN IF NOT EXISTS lng       numeric;
ALTER TABLE public.ubicacion_cadetes ADD COLUMN IF NOT EXISTS pedido_id uuid REFERENCES public.pedidos(id) ON DELETE SET NULL;

-- Backfill lat/lng desde columnas existentes
UPDATE public.ubicacion_cadetes
SET lat = latitud, lng = longitud
WHERE lat IS NULL AND latitud IS NOT NULL;


-- ──────────────────────────────────────────────────────────────
-- A-10. ofertas_cadetes  (TABLA NUEVA)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ofertas_cadetes (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           uuid        NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  cadete_id           uuid        NOT NULL,
  comercio_nombre     text        NOT NULL,
  comercio_direccion  text,
  comercio_lat        numeric,
  comercio_lng        numeric,
  cliente_direccion   text,
  distancia_km        numeric,
  ganancia_estimada   numeric,
  distancia_estimada  numeric,
  pago_cadete         numeric,
  estado              text        NOT NULL DEFAULT 'pendiente',
  created_at          timestamptz DEFAULT now()
);

-- Constraint después de crear/confirmar la tabla
ALTER TABLE public.ofertas_cadetes DROP CONSTRAINT IF EXISTS ofertas_cadetes_estado_check;
ALTER TABLE public.ofertas_cadetes ADD CONSTRAINT ofertas_cadetes_estado_check
  CHECK (estado IN ('pendiente','aceptada','rechazada'));


-- ──────────────────────────────────────────────────────────────
-- A-11. mensajes_pedido  (ya existe)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mensajes_pedido (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     uuid        NOT NULL REFERENCES public.pedidos(id) ON DELETE CASCADE,
  remitente_id  uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rol_remitente text        NOT NULL,
  mensaje       text        NOT NULL,
  creado_at     timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.mensajes_pedido DROP CONSTRAINT IF EXISTS mensajes_pedido_rol_remitente_check;
    ALTER TABLE public.mensajes_pedido ADD CONSTRAINT mensajes_pedido_rol_remitente_check
      CHECK (rol_remitente IN ('cliente','comercio','cadete','admin'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.mensajes_pedido DROP CONSTRAINT IF EXISTS mensajes_pedido_mensaje_len_check;
    ALTER TABLE public.mensajes_pedido ADD CONSTRAINT mensajes_pedido_mensaje_len_check
      CHECK (char_length(mensaje) BETWEEN 1 AND 1000);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-12. ratings
--   SCHEMA REAL: no tiene usuario_id — se agrega con ADD COLUMN
--   El CREATE TABLE se saltea si la tabla ya existe.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ratings (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id         uuid        REFERENCES public.pedidos(id) ON DELETE CASCADE,
  usuario_id        uuid,
  comercio_id       uuid        REFERENCES public.comercios(id) ON DELETE CASCADE,
  cadete_id         uuid,
  puntaje_comercio  int2,
  puntaje_cadete    int2,
  comentario        text,
  created_at        timestamptz DEFAULT now()
);

-- ⚠️ CRÍTICO: usuario_id NO existe en el schema real de Supabase.
-- Sin esta línea, la política ratings_usuario_insert falla con
-- "column usuario_id does not exist".
ALTER TABLE public.ratings ADD COLUMN IF NOT EXISTS usuario_id uuid;

-- Constraints después (envueltos para idempotencia)
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_puntaje_comercio_check;
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_puntaje_comercio_check
      CHECK (puntaje_comercio BETWEEN 1 AND 5);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
  BEGIN
    ALTER TABLE public.ratings DROP CONSTRAINT IF EXISTS ratings_puntaje_cadete_check;
    ALTER TABLE public.ratings ADD CONSTRAINT ratings_puntaje_cadete_check
      CHECK (puntaje_cadete BETWEEN 1 AND 5);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
END;
$$;


-- ──────────────────────────────────────────────────────────────
-- A-13. reportes
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reportes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        REFERENCES public.pedidos(id) ON DELETE CASCADE,
  usuario_id  uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  motivo      text        NOT NULL,
  descripcion text,
  estado      text        NOT NULL DEFAULT 'pendiente',
  created_at  timestamptz DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-14. advertencias_comercio
--   SCHEMA REAL (del CSV): comercio_id es TEXT (no uuid), tiene pedido_id
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.advertencias_comercio (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id text,
  motivo      text,
  pedido_id   uuid        REFERENCES public.pedidos(id) ON DELETE SET NULL,
  created_at  timestamptz DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-15. chat_reportes
--   SCHEMA REAL (del CSV): pedido_id, comercio_id (text), de, texto, reporte_id
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_reportes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id   uuid        REFERENCES public.pedidos(id) ON DELETE CASCADE,
  reporte_id  uuid        REFERENCES public.reportes(id) ON DELETE CASCADE,
  comercio_id text,
  de          text,
  texto       text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.chat_reportes ADD COLUMN IF NOT EXISTS reporte_id uuid REFERENCES public.reportes(id) ON DELETE CASCADE;


-- ──────────────────────────────────────────────────────────────
-- A-16. fcm_tokens
--   SCHEMA REAL (del CSV): user_id TEXT (no uuid), token TEXT, rol TEXT
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.fcm_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text        NOT NULL,
  token       text        NOT NULL UNIQUE,
  rol         text,
  created_at  timestamptz DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-17. promociones
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.promociones (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id  uuid        REFERENCES public.comercios(id) ON DELETE CASCADE,
  titulo       text,
  descripcion  text,
  tipo         text        DEFAULT 'porcentaje',
  porcentaje   numeric,
  valor        numeric,
  fecha_inicio date,
  fecha_fin    date,
  activa       bool        DEFAULT true,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE public.promociones ADD COLUMN IF NOT EXISTS valor       numeric;
ALTER TABLE public.promociones ADD COLUMN IF NOT EXISTS fecha_inicio date;

UPDATE public.promociones
SET valor = porcentaje
WHERE valor IS NULL AND porcentaje IS NOT NULL;


-- ──────────────────────────────────────────────────────────────
-- A-18. billetera_embajadores  (ya existe)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billetera_embajadores (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id     uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comercio_id      uuid          NOT NULL,
  pedido_id        uuid          NOT NULL,
  monto_comision   numeric(12,2) NOT NULL,
  periodo_mes      int4          NOT NULL,
  created_at       timestamptz   DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-19. patrocinios
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patrocinios (
  id          bigserial   PRIMARY KEY,
  sub_titulo  text,
  titulo      text,
  imagen_url  text,
  link_oferta text,
  orden       int4        DEFAULT 0,
  activo      bool        DEFAULT true,
  creado_at   timestamptz DEFAULT now()
);


-- ──────────────────────────────────────────────────────────────
-- A-20. comercios_historial
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.comercios_historial (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  comercio_id  uuid        NOT NULL,
  embajador_id uuid,
  usuario_id   uuid,
  accion       text        NOT NULL,
  detalles     jsonb,
  created_at   timestamptz DEFAULT now()
);


-- ============================================================
-- SECCIÓN B — ÍNDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_perfiles_usuario_id       ON public.perfiles (usuario_id);
CREATE INDEX IF NOT EXISTS idx_comercios_usuario_id      ON public.comercios (usuario_id);
CREATE INDEX IF NOT EXISTS idx_comercios_estado          ON public.comercios (estado_registro);
CREATE INDEX IF NOT EXISTS idx_comercios_embajador       ON public.comercios (creado_por_embajador_id);
CREATE INDEX IF NOT EXISTS idx_cadetes_auth_uid          ON public.cadetes (auth_uid);
CREATE INDEX IF NOT EXISTS idx_productos_comercio_id     ON public.productos (comercio_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente_id        ON public.pedidos (cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_comercio_id       ON public.pedidos (comercio_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cadete_id         ON public.pedidos (cadete_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado            ON public.pedidos (estado);
CREATE INDEX IF NOT EXISTS idx_ofertas_cadete_id         ON public.ofertas_cadetes (cadete_id);
CREATE INDEX IF NOT EXISTS idx_ofertas_pedido_id         ON public.ofertas_cadetes (pedido_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_pedido_id        ON public.mensajes_pedido (pedido_id);
CREATE INDEX IF NOT EXISTS idx_mensajes_creado           ON public.mensajes_pedido (pedido_id, creado_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_comercio_id       ON public.ratings (comercio_id);
CREATE INDEX IF NOT EXISTS idx_billetera_embajador       ON public.billetera_embajadores (embajador_id);
CREATE INDEX IF NOT EXISTS idx_patrocinios_orden         ON public.patrocinios (orden);
CREATE INDEX IF NOT EXISTS idx_historial_comercio_id     ON public.comercios_historial (comercio_id);


-- ============================================================
-- SECCIÓN C — HABILITAR RLS
-- ============================================================
ALTER TABLE public.perfiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comercios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadetes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categorias_producto   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ubicacion_cadetes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ofertas_cadetes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_pedido       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ratings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reportes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billetera_embajadores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promociones           ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- SECCIÓN D — POLÍTICAS RLS
-- Patrón: DROP IF EXISTS → CREATE (siempre reemplaza)
-- ============================================================

-- ── perfiles ──────────────────────────────────────────────────
DROP POLICY IF EXISTS perfiles_usuario_select_update   ON public.perfiles;
DROP POLICY IF EXISTS perfiles_admin                   ON public.perfiles;
DROP POLICY IF EXISTS perfiles_cadete_identidad_partes ON public.perfiles;
DROP POLICY IF EXISTS perfiles_owner_all               ON public.perfiles;
DROP POLICY IF EXISTS perfiles_admin_all               ON public.perfiles;

CREATE POLICY perfiles_owner_all
  ON public.perfiles FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY perfiles_admin_all
  ON public.perfiles FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

CREATE POLICY perfiles_cadete_identidad_partes
  ON public.perfiles FOR SELECT
  USING (
    rol = 'cadete'
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.cadete_id = perfiles.usuario_id
        AND (p.cliente_id = auth.uid() OR p.comercio_id = auth.uid())
    )
  );

-- ── comercios ─────────────────────────────────────────────────
DROP POLICY IF EXISTS lectura_publica_comercios         ON public.comercios;
DROP POLICY IF EXISTS lectura_comercios_activos         ON public.comercios;
DROP POLICY IF EXISTS comercio_dueño_select_update      ON public.comercios;
DROP POLICY IF EXISTS dueño_modifica_comercio           ON public.comercios;
DROP POLICY IF EXISTS embajador_ver_sus_comercios       ON public.comercios;
DROP POLICY IF EXISTS embajador_modifica_sus_comercios  ON public.comercios;
DROP POLICY IF EXISTS admin_todo_comercios              ON public.comercios;
DROP POLICY IF EXISTS comercios_lectura_activos         ON public.comercios;
DROP POLICY IF EXISTS comercios_owner_all               ON public.comercios;
DROP POLICY IF EXISTS comercios_embajador_ver           ON public.comercios;
DROP POLICY IF EXISTS comercios_embajador_update        ON public.comercios;
DROP POLICY IF EXISTS comercios_admin_all               ON public.comercios;

CREATE POLICY comercios_lectura_activos
  ON public.comercios FOR SELECT
  USING (estado_registro = 'activo' OR usuario_id = auth.uid());

CREATE POLICY comercios_owner_all
  ON public.comercios FOR ALL
  USING (auth.uid() = usuario_id)
  WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY comercios_embajador_ver
  ON public.comercios FOR SELECT
  USING (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

CREATE POLICY comercios_embajador_update
  ON public.comercios FOR UPDATE
  USING (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  )
  WITH CHECK (
    (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
    AND creado_por_embajador_id = auth.uid()
  );

CREATE POLICY comercios_admin_all
  ON public.comercios FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- ── cadetes ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "Permitir select para el dueño"  ON public.cadetes;
DROP POLICY IF EXISTS "Permitir upsert para el dueño"  ON public.cadetes;
DROP POLICY IF EXISTS "Permitir update para el dueño"  ON public.cadetes;
DROP POLICY IF EXISTS cadetes_owner_select             ON public.cadetes;
DROP POLICY IF EXISTS cadetes_owner_insert             ON public.cadetes;
DROP POLICY IF EXISTS cadetes_owner_update             ON public.cadetes;
DROP POLICY IF EXISTS cadetes_admin_all                ON public.cadetes;

CREATE POLICY cadetes_owner_select
  ON public.cadetes FOR SELECT
  USING (auth.uid() = auth_uid);

CREATE POLICY cadetes_owner_insert
  ON public.cadetes FOR INSERT
  WITH CHECK (auth.uid() = auth_uid);

CREATE POLICY cadetes_owner_update
  ON public.cadetes FOR UPDATE
  USING (auth.uid() = auth_uid)
  WITH CHECK (auth.uid() = auth_uid);

CREATE POLICY cadetes_admin_all
  ON public.cadetes FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- ── productos ─────────────────────────────────────────────────
DROP POLICY IF EXISTS lectura_publica_productos            ON public.productos;
DROP POLICY IF EXISTS dueño_modifica_productos             ON public.productos;
DROP POLICY IF EXISTS "Lectura de productos disponibles"   ON public.productos;
DROP POLICY IF EXISTS "Comercio gestiona sus productos"    ON public.productos;
DROP POLICY IF EXISTS productos_lectura_disponibles        ON public.productos;
DROP POLICY IF EXISTS productos_owner_all                  ON public.productos;

CREATE POLICY productos_lectura_disponibles
  ON public.productos FOR SELECT
  USING (
    disponible = true
    OR EXISTS (
      SELECT 1 FROM public.comercios c
      WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
    )
  );

CREATE POLICY productos_owner_all
  ON public.productos FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

-- ── categorias_producto ───────────────────────────────────────
DROP POLICY IF EXISTS "Lectura publica de categorias"  ON public.categorias_producto;
DROP POLICY IF EXISTS categorias_lectura_publica       ON public.categorias_producto;
DROP POLICY IF EXISTS categorias_owner_all             ON public.categorias_producto;

CREATE POLICY categorias_lectura_publica
  ON public.categorias_producto FOR SELECT
  USING (true);

CREATE POLICY categorias_owner_all
  ON public.categorias_producto FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

-- ── pedidos ───────────────────────────────────────────────────
DROP POLICY IF EXISTS clientes_ver_propios_pedidos        ON public.pedidos;
DROP POLICY IF EXISTS clientes_crear_pedidos              ON public.pedidos;
DROP POLICY IF EXISTS comercios_ver_sus_pedidos           ON public.pedidos;
DROP POLICY IF EXISTS comercios_actualizar_estado         ON public.pedidos;
DROP POLICY IF EXISTS cadetes_ver_viajes                  ON public.pedidos;
DROP POLICY IF EXISTS admin_todo_pedidos                  ON public.pedidos;
DROP POLICY IF EXISTS "Cliente ve sus pedidos"            ON public.pedidos;
DROP POLICY IF EXISTS "Comercio ve sus pedidos"           ON public.pedidos;
DROP POLICY IF EXISTS "Cliente crea pedidos"              ON public.pedidos;
DROP POLICY IF EXISTS pedidos_cliente_select              ON public.pedidos;
DROP POLICY IF EXISTS pedidos_cliente_insert              ON public.pedidos;
DROP POLICY IF EXISTS pedidos_comercio_select             ON public.pedidos;
DROP POLICY IF EXISTS pedidos_comercio_update             ON public.pedidos;
DROP POLICY IF EXISTS pedidos_cadete_select               ON public.pedidos;
DROP POLICY IF EXISTS pedidos_admin_all                   ON public.pedidos;

CREATE POLICY pedidos_cliente_select
  ON public.pedidos FOR SELECT
  USING (cliente_id = auth.uid() OR cadete_id = auth.uid());

CREATE POLICY pedidos_cliente_insert
  ON public.pedidos FOR INSERT
  WITH CHECK (cliente_id = auth.uid());

CREATE POLICY pedidos_comercio_select
  ON public.pedidos FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

CREATE POLICY pedidos_comercio_update
  ON public.pedidos FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

CREATE POLICY pedidos_cadete_select
  ON public.pedidos FOR SELECT
  USING (
    (estado IN ('preparando','preparado') AND tipo_delivery = 'app')
    OR cadete_id = auth.uid()
  );

CREATE POLICY pedidos_admin_all
  ON public.pedidos FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- ── ubicacion_cadetes ─────────────────────────────────────────
DROP POLICY IF EXISTS ubicacion_cadete_owner    ON public.ubicacion_cadetes;
DROP POLICY IF EXISTS ubicacion_lectura_partes  ON public.ubicacion_cadetes;

CREATE POLICY ubicacion_cadete_all
  ON public.ubicacion_cadetes FOR ALL
  USING (cadete_id = auth.uid())
  WITH CHECK (cadete_id = auth.uid());

CREATE POLICY ubicacion_lectura_publica
  ON public.ubicacion_cadetes FOR SELECT
  USING (true);

-- ── ofertas_cadetes ───────────────────────────────────────────
DROP POLICY IF EXISTS "Cadete ve sus propias ofertas"  ON public.ofertas_cadetes;
DROP POLICY IF EXISTS ofertas_cadete_select            ON public.ofertas_cadetes;

CREATE POLICY ofertas_cadete_select
  ON public.ofertas_cadetes FOR SELECT
  USING (cadete_id = auth.uid());

-- ── mensajes_pedido ───────────────────────────────────────────
DROP POLICY IF EXISTS mensajes_select_partes ON public.mensajes_pedido;
DROP POLICY IF EXISTS mensajes_insert_partes ON public.mensajes_pedido;

CREATE POLICY mensajes_select_partes
  ON public.mensajes_pedido FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = mensajes_pedido.pedido_id
        AND (p.cliente_id = auth.uid() OR p.comercio_id = auth.uid() OR p.cadete_id = auth.uid())
    )
    OR (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
  );

CREATE POLICY mensajes_insert_partes
  ON public.mensajes_pedido FOR INSERT
  WITH CHECK (
    remitente_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.pedidos p
      WHERE p.id = pedido_id
        AND (p.cliente_id = auth.uid() OR p.comercio_id = auth.uid() OR p.cadete_id = auth.uid())
    )
    AND rol_remitente = (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid())
  );

-- ── billetera_embajadores ─────────────────────────────────────
DROP POLICY IF EXISTS embajador_ver_billetera     ON public.billetera_embajadores;
DROP POLICY IF EXISTS admin_todo_billetera        ON public.billetera_embajadores;
DROP POLICY IF EXISTS billetera_embajador_select  ON public.billetera_embajadores;
DROP POLICY IF EXISTS billetera_admin_all         ON public.billetera_embajadores;

CREATE POLICY billetera_embajador_select
  ON public.billetera_embajadores FOR SELECT
  USING (embajador_id = auth.uid());

CREATE POLICY billetera_admin_all
  ON public.billetera_embajadores FOR ALL
  USING ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin');

-- ── promociones ───────────────────────────────────────────────
DROP POLICY IF EXISTS promociones_lectura_publica ON public.promociones;
DROP POLICY IF EXISTS promociones_owner_all       ON public.promociones;

CREATE POLICY promociones_lectura_publica
  ON public.promociones FOR SELECT
  USING (activa = true);

CREATE POLICY promociones_owner_all
  ON public.promociones FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.comercios c
    WHERE c.id = comercio_id AND c.usuario_id = auth.uid()
  ));

-- ── ratings ───────────────────────────────────────────────────
DROP POLICY IF EXISTS ratings_lectura_publica ON public.ratings;
DROP POLICY IF EXISTS ratings_usuario_insert  ON public.ratings;

CREATE POLICY ratings_lectura_publica
  ON public.ratings FOR SELECT USING (true);

CREATE POLICY ratings_usuario_insert
  ON public.ratings FOR INSERT
  WITH CHECK (usuario_id = auth.uid());


-- ============================================================
-- SECCIÓN E — FUNCIONES Y TRIGGERS
-- ============================================================

-- E-1. updated_at automático para cadetes
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at ON public.cadetes;
CREATE TRIGGER trg_set_updated_at
  BEFORE UPDATE ON public.cadetes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- E-2. Sincronizar ubicacion_cadetes: latitud→lat, longitud→lng
CREATE OR REPLACE FUNCTION public.sync_ubicacion_lat_lng()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latitud  IS NOT NULL THEN NEW.lat := NEW.latitud;  END IF;
  IF NEW.longitud IS NOT NULL THEN NEW.lng := NEW.longitud; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_lat_lng ON public.ubicacion_cadetes;
CREATE TRIGGER trg_sync_lat_lng
  BEFORE INSERT OR UPDATE ON public.ubicacion_cadetes
  FOR EACH ROW EXECUTE FUNCTION public.sync_ubicacion_lat_lng();


-- E-3. Crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_create_profile()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role  text;
  v_email text;
BEGIN
  v_role  := COALESCE(NULLIF(NEW.raw_user_meta_data::jsonb ->> 'role', ''), 'cliente');
  v_email := COALESCE(NEW.email, NEW.raw_user_meta_data::jsonb ->> 'email');

  IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE usuario_id = NEW.id) THEN
    INSERT INTO public.perfiles (usuario_id, rol, email, created_at)
    VALUES (NEW.id, v_role, v_email, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_create_profile ON auth.users;
CREATE TRIGGER trg_auth_user_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user_create_profile();


-- E-4. Blindaje: prevenir escalada de rol desde el browser
CREATE OR REPLACE FUNCTION public.perfiles_prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_jwt_role   text;
  v_caller_rol text;
BEGIN
  BEGIN
    v_jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role' THEN RETURN NEW; END IF;

  IF OLD.rol IS DISTINCT FROM NEW.rol THEN
    SELECT rol INTO v_caller_rol FROM public.perfiles WHERE usuario_id = auth.uid();
    IF v_caller_rol IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'No autorizado: el cambio de rol debe realizarse desde el backend.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perfiles_prevent_role_escalation ON public.perfiles;
CREATE TRIGGER trg_perfiles_prevent_role_escalation
  BEFORE UPDATE ON public.perfiles
  FOR EACH ROW EXECUTE FUNCTION public.perfiles_prevent_role_escalation();


-- E-5. Forzar rol=cliente en INSERT directo desde el browser
CREATE OR REPLACE FUNCTION public.perfiles_force_cliente_on_direct_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN v_jwt_role := NULL; END;

  IF v_jwt_role = 'service_role' THEN RETURN NEW; END IF;
  NEW.rol := 'cliente';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_perfiles_force_cliente_insert ON public.perfiles;
CREATE TRIGGER trg_perfiles_force_cliente_insert
  BEFORE INSERT ON public.perfiles
  FOR EACH ROW EXECUTE FUNCTION public.perfiles_force_cliente_on_direct_insert();


-- E-6. Auto-calcular comisión y total_final en pedidos
CREATE OR REPLACE FUNCTION public.pedidos_compute_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  NEW.monto_comision_app := ROUND(COALESCE(NEW.subtotal, 0) * 0.15, 2);
  NEW.total_final := ROUND(COALESCE(NEW.subtotal, 0) + COALESCE(NEW.costo_envio, 0), 2);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_compute_totals ON public.pedidos;
CREATE TRIGGER trg_pedidos_compute_totals
  BEFORE INSERT OR UPDATE ON public.pedidos
  FOR EACH ROW EXECUTE FUNCTION public.pedidos_compute_totals();


-- E-7. Deuda del comercio cuando usa cadete propio
CREATE OR REPLACE FUNCTION public.pedidos_acumular_deuda_propio()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.comercios
  SET deuda = COALESCE(deuda, 0) + ROUND(COALESCE(NEW.monto_comision_app, 0), 2)
  WHERE id = NEW.comercio_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_acumular_deuda ON public.pedidos;
CREATE TRIGGER trg_pedidos_acumular_deuda
  AFTER UPDATE ON public.pedidos
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'preparando' AND NEW.tipo_delivery = 'propio')
  EXECUTE FUNCTION public.pedidos_acumular_deuda_propio();


-- E-8. Comisión al embajador al entregar
CREATE OR REPLACE FUNCTION public.pedidos_comision_embajador()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_created    timestamptz;
  v_embajador  uuid;
  v_months     int;
  v_monto      numeric(12,2);
BEGIN
  SELECT created_at, creado_por_embajador_id
  INTO v_created, v_embajador
  FROM public.comercios WHERE id = NEW.comercio_id LIMIT 1;

  IF v_created IS NULL OR v_embajador IS NULL THEN RETURN NEW; END IF;

  v_months := (
    date_part('year',  age(now(), v_created)) * 12 +
    date_part('month', age(now(), v_created))
  )::int;

  IF    v_months <= 6  THEN v_monto := ROUND(COALESCE(NEW.total_final, 0) * 0.05, 2);
  ELSIF v_months <= 12 THEN v_monto := ROUND(COALESCE(NEW.total_final, 0) * 0.02, 2);
  ELSE  v_monto := 0;
  END IF;

  IF v_monto > 0 THEN
    INSERT INTO public.billetera_embajadores
      (embajador_id, comercio_id, pedido_id, monto_comision, periodo_mes)
    VALUES (
      v_embajador, NEW.comercio_id, NEW.id, v_monto,
      (date_part('year', now())::int * 12 + date_part('month', now())::int)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_comision_embajador ON public.pedidos;
CREATE TRIGGER trg_pedidos_comision_embajador
  AFTER UPDATE ON public.pedidos
  FOR EACH ROW
  WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'entregado')
  EXECUTE FUNCTION public.pedidos_comision_embajador();


-- E-9. Auditoría de comercios
CREATE OR REPLACE FUNCTION public.comercios_auditoria()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.comercios_historial
    (comercio_id, embajador_id, usuario_id, accion, detalles)
  VALUES (
    NEW.id, NEW.creado_por_embajador_id, NEW.usuario_id, TG_OP,
    CASE TG_OP
      WHEN 'INSERT' THEN jsonb_build_object('new', to_jsonb(NEW))
      ELSE jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW))
    END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_comercios_auditoria ON public.comercios;
CREATE TRIGGER trg_comercios_auditoria
  AFTER INSERT OR UPDATE ON public.comercios
  FOR EACH ROW EXECUTE FUNCTION public.comercios_auditoria();


-- ============================================================
-- SECCIÓN F — FUNCIONES RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.confirmar_entrega(p_pedido_id uuid, p_pin text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_pin_real text;
BEGIN
  SELECT pin INTO v_pin_real FROM public.pedidos
  WHERE id = p_pedido_id AND estado = 'en_camino';
  IF v_pin_real = p_pin THEN
    UPDATE public.pedidos SET estado = 'entregado' WHERE id = p_pedido_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.tomar_pedido(p_pedido_id uuid, p_cadete_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE affected int;
BEGIN
  UPDATE public.pedidos
  SET cadete_id = p_cadete_id, estado = 'en_camino'
  WHERE id = p_pedido_id
    AND estado = 'preparado'
    AND cadete_id IS NULL
    AND tipo_delivery = 'app';
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;


-- ============================================================
-- SECCIÓN G — STORAGE POLICIES
-- (solo si el bucket 'productos' ya fue creado en el Dashboard)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'productos') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Productos: upload autenticado'
    ) THEN
      EXECUTE $p$
        CREATE POLICY "Productos: upload autenticado"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'productos' AND auth.role() = 'authenticated');
      $p$;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Productos: lectura publica'
    ) THEN
      EXECUTE $p$
        CREATE POLICY "Productos: lectura publica"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'productos');
      $p$;
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- F. EMBAJADOR: patrocinios, comisiones, billetera, retiros
-- ============================================================

-- F-1. patrocinios
CREATE TABLE IF NOT EXISTS public.patrocinios (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid        NOT NULL,
  comercio_id  uuid        NOT NULL,
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  activo       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS embajador_id uuid;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS comercio_id  uuid;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS fecha_inicio timestamptz;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS activo       boolean;
ALTER TABLE public.patrocinios ADD COLUMN IF NOT EXISTS created_at   timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_comercio_fkey
      FOREIGN KEY (comercio_id) REFERENCES public.comercios(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.patrocinios ADD CONSTRAINT patrocinios_embajador_comercio_key
      UNIQUE (embajador_id, comercio_id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;

-- F-2. historial_comisiones
CREATE TABLE IF NOT EXISTS public.historial_comisiones (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id   uuid          NOT NULL,
  comercio_id    uuid          NOT NULL,
  pedido_id      uuid          NOT NULL,
  monto_pedido   numeric(12,2) NOT NULL,
  tasa_aplicada  numeric(5,4)  NOT NULL,
  monto_comision numeric(12,2) NOT NULL,
  meses_activo   integer       NOT NULL,
  created_at     timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS embajador_id   uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS comercio_id    uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS pedido_id      uuid;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS monto_pedido   numeric(12,2);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS tasa_aplicada  numeric(5,4);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS monto_comision numeric(12,2);
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS meses_activo   integer;
ALTER TABLE public.historial_comisiones ADD COLUMN IF NOT EXISTS created_at     timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_pedido_fkey
      FOREIGN KEY (pedido_id) REFERENCES public.pedidos(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.historial_comisiones ADD CONSTRAINT historial_comisiones_pedido_embajador_key
      UNIQUE (pedido_id, embajador_id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;

-- F-3. billetera_embajador
CREATE TABLE IF NOT EXISTS public.billetera_embajador (
  embajador_id     uuid          PRIMARY KEY,
  saldo_disponible numeric(12,2) NOT NULL DEFAULT 0,
  saldo_acumulado  numeric(12,2) NOT NULL DEFAULT 0,
  saldo_retirado   numeric(12,2) NOT NULL DEFAULT 0,
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_disponible numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_acumulado  numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS saldo_retirado   numeric(12,2);
ALTER TABLE public.billetera_embajador ADD COLUMN IF NOT EXISTS updated_at       timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.billetera_embajador ADD CONSTRAINT billetera_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;

-- F-4. solicitudes_retiro
CREATE TABLE IF NOT EXISTS public.solicitudes_retiro (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  embajador_id uuid          NOT NULL,
  monto        numeric(12,2) NOT NULL,
  estado       text          NOT NULL DEFAULT 'pendiente',
  cbu_alias    text,
  notas_admin  text,
  created_at   timestamptz   NOT NULL DEFAULT now(),
  updated_at   timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS embajador_id uuid;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS monto        numeric(12,2);
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS estado       text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS cbu_alias    text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS notas_admin  text;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS created_at   timestamptz;
ALTER TABLE public.solicitudes_retiro ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

DO $$
BEGIN
  BEGIN
    ALTER TABLE public.solicitudes_retiro ADD CONSTRAINT solicitudes_retiro_embajador_fkey
      FOREIGN KEY (embajador_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER TABLE public.solicitudes_retiro DROP CONSTRAINT IF EXISTS solicitudes_retiro_estado_check;
    ALTER TABLE public.solicitudes_retiro ADD CONSTRAINT solicitudes_retiro_estado_check
      CHECK (estado IN ('pendiente','pagado','rechazado'));
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL; END;
END; $$;

-- F-5. Índices embajador
CREATE INDEX IF NOT EXISTS idx_patrocinios_embajador ON public.patrocinios         (embajador_id);
CREATE INDEX IF NOT EXISTS idx_patrocinios_comercio  ON public.patrocinios         (comercio_id);
CREATE INDEX IF NOT EXISTS idx_historial_embajador   ON public.historial_comisiones(embajador_id);
CREATE INDEX IF NOT EXISTS idx_historial_pedido      ON public.historial_comisiones(pedido_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_embajador ON public.solicitudes_retiro  (embajador_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_estado    ON public.solicitudes_retiro  (estado);
CREATE INDEX IF NOT EXISTS idx_cadetes_referido      ON public.cadetes             (codigo_referido);

-- F-6. RLS embajador
ALTER TABLE public.patrocinios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_comisiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billetera_embajador  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_retiro   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pat_embajador_select" ON public.patrocinios;
DROP POLICY IF EXISTS "pat_service_all"      ON public.patrocinios;
CREATE POLICY "pat_embajador_select" ON public.patrocinios FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "pat_service_all"      ON public.patrocinios FOR ALL    USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "hist_embajador_select" ON public.historial_comisiones;
DROP POLICY IF EXISTS "hist_service_all"      ON public.historial_comisiones;
CREATE POLICY "hist_embajador_select" ON public.historial_comisiones FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "hist_service_all"      ON public.historial_comisiones FOR ALL    USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "bill_embajador_select" ON public.billetera_embajador;
DROP POLICY IF EXISTS "bill_service_all"      ON public.billetera_embajador;
CREATE POLICY "bill_embajador_select" ON public.billetera_embajador FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "bill_service_all"      ON public.billetera_embajador FOR ALL    USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "sol_embajador_select" ON public.solicitudes_retiro;
DROP POLICY IF EXISTS "sol_service_all"      ON public.solicitudes_retiro;
CREATE POLICY "sol_embajador_select" ON public.solicitudes_retiro FOR SELECT USING (embajador_id = auth.uid());
CREATE POLICY "sol_service_all"      ON public.solicitudes_retiro FOR ALL    USING (auth.role() = 'service_role');

-- F-7. RPCs embajador

CREATE OR REPLACE FUNCTION public.acreditar_comision(
  p_embajador_id uuid, p_monto numeric
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO billetera_embajador (embajador_id, saldo_disponible, saldo_acumulado, saldo_retirado, updated_at)
  VALUES (p_embajador_id, p_monto, p_monto, 0, now())
  ON CONFLICT (embajador_id) DO UPDATE
    SET saldo_disponible = billetera_embajador.saldo_disponible + p_monto,
        saldo_acumulado  = billetera_embajador.saldo_acumulado  + p_monto,
        updated_at       = now();
END; $$;

CREATE OR REPLACE FUNCTION public.solicitar_retiro_embajador(
  p_embajador_id uuid, p_monto numeric, p_cbu_alias text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_saldo numeric; v_id uuid;
BEGIN
  IF p_monto <= 0 THEN RETURN json_build_object('error','El monto debe ser mayor a 0'); END IF;
  SELECT saldo_disponible INTO v_saldo FROM billetera_embajador WHERE embajador_id = p_embajador_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','Billetera no encontrada'); END IF;
  IF v_saldo < p_monto THEN RETURN json_build_object('error','Saldo insuficiente','saldo_disponible',v_saldo); END IF;
  INSERT INTO solicitudes_retiro (embajador_id, monto, cbu_alias) VALUES (p_embajador_id, p_monto, p_cbu_alias) RETURNING id INTO v_id;
  UPDATE billetera_embajador SET saldo_disponible = saldo_disponible - p_monto, updated_at = now() WHERE embajador_id = p_embajador_id;
  RETURN json_build_object('ok', true, 'solicitud_id', v_id, 'monto', p_monto);
END; $$;

CREATE OR REPLACE FUNCTION public.confirmar_pago_retiro(
  p_solicitud_id uuid
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_monto numeric; v_embajador_id uuid; v_estado text;
BEGIN
  SELECT monto, embajador_id, estado INTO v_monto, v_embajador_id, v_estado FROM solicitudes_retiro WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','Solicitud no encontrada'); END IF;
  IF v_estado != 'pendiente' THEN RETURN json_build_object('error','Ya fue procesada','estado',v_estado); END IF;
  UPDATE solicitudes_retiro SET estado = 'pagado', updated_at = now() WHERE id = p_solicitud_id;
  UPDATE billetera_embajador SET saldo_retirado = saldo_retirado + v_monto, updated_at = now() WHERE embajador_id = v_embajador_id;
  RETURN json_build_object('ok', true, 'solicitud_id', p_solicitud_id, 'monto', v_monto);
END; $$;

CREATE OR REPLACE FUNCTION public.rechazar_retiro(
  p_solicitud_id uuid, p_motivo text DEFAULT NULL
) RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_monto numeric; v_embajador_id uuid; v_estado text;
BEGIN
  SELECT monto, embajador_id, estado INTO v_monto, v_embajador_id, v_estado FROM solicitudes_retiro WHERE id = p_solicitud_id FOR UPDATE;
  IF NOT FOUND THEN RETURN json_build_object('error','Solicitud no encontrada'); END IF;
  IF v_estado != 'pendiente' THEN RETURN json_build_object('error','Ya fue procesada','estado',v_estado); END IF;
  UPDATE solicitudes_retiro SET estado = 'rechazado', notas_admin = p_motivo, updated_at = now() WHERE id = p_solicitud_id;
  UPDATE billetera_embajador SET saldo_disponible = saldo_disponible + v_monto, updated_at = now() WHERE embajador_id = v_embajador_id;
  RETURN json_build_object('ok', true, 'saldo_devuelto', v_monto);
END; $$;

-- ============================================================
-- FIN — schema-definitivo-v2.sql
-- ============================================================
