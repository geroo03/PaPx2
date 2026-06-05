-- ==============================================================================
-- 🔒 SCRIPT DE SEGURIDAD SUPABASE - PUERTA A PUERTA (PRODUCCIÓN)
-- Instrucciones: Copiar y pegar TODO este código en el SQL Editor de Supabase
-- y ejecutarlo ("Run").
-- ==============================================================================

-- 1. HABILITAR ROW LEVEL SECURITY (RLS) EN TABLAS CRÍTICAS
ALTER TABLE pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE comercios ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos ENABLE ROW LEVEL SECURITY;

-- ==============================================================================
-- 2. POLÍTICAS RLS: TABLA PEDIDOS (El corazón de la app)
-- ==============================================================================

-- Los clientes solo pueden ver SUS PROPIOS pedidos
CREATE POLICY "clientes_ver_propios_pedidos" 
ON pedidos FOR SELECT 
USING (auth.uid() = usuario_id);

-- Los clientes solo pueden crear pedidos a su nombre
CREATE POLICY "clientes_crear_pedidos" 
ON pedidos FOR INSERT 
WITH CHECK (auth.uid() = usuario_id);

-- Los comercios pueden ver los pedidos asigandos a ellos
CREATE POLICY "comercios_ver_sus_pedidos" 
ON pedidos FOR SELECT 
USING (auth.uid() = comercio_id);

-- Los comercios pueden actualizar pedidos SOLO si están en estado temprano o para rechazar/preparar
CREATE POLICY "comercios_actualizar_estado" 
ON pedidos FOR UPDATE 
USING (auth.uid() = comercio_id) 
WITH CHECK (estado IN ('preparando', 'rechazado', 'cancelado', 'preparado'));

-- Los cadetes pueden ver pedidos "preparando" o "preparado" de la app, o los que tienen asignados
CREATE POLICY "cadetes_ver_viajes" 
ON pedidos FOR SELECT 
USING (
  (estado IN ('preparando', 'preparado') AND tipo_delivery = 'app')
  OR 
  (auth.uid() = cadete_id)
);

-- ==============================================================================
-- 3. POLÍTICAS RLS: TABLA PRODUCTOS Y COMERCIOS
-- ==============================================================================

-- Todo el mundo puede ver comercios activos y productos disponibles
CREATE POLICY "lectura_publica_comercios" 
ON comercios FOR SELECT 
USING (activo = true);

CREATE POLICY "lectura_publica_productos" 
ON productos FOR SELECT 
USING (disponible = true);

-- Solo el dueño del comercio puede editar su comercio o productos
CREATE POLICY "dueño_modifica_comercio" 
ON comercios FOR UPDATE 
USING (auth.uid() = usuario_id);

CREATE POLICY "dueño_modifica_productos" 
ON productos FOR ALL 
USING (auth.uid() IN (SELECT usuario_id FROM comercios WHERE id = comercio_id));


-- ==============================================================================
-- 4. FUNCIONES RPC: SEGURIDAD Y TRANSACCIONES DEL SERVIDOR
-- ==============================================================================

-- 🚀 MITIGACIÓN DE FRAUDE (PIN OCULTO AL CADETE)
-- Actualiza el estado a "entregado" SOLO si el PIN coincide en la BD.
CREATE OR REPLACE FUNCTION confirmar_entrega(p_pedido_id UUID, p_pin TEXT) 
RETURNS BOOLEAN AS $$
DECLARE
    v_pin_real TEXT;
BEGIN
    -- Obtenemos el PIN real desde la base de datos (seguro)
    SELECT pin INTO v_pin_real 
    FROM pedidos 
    WHERE id = p_pedido_id AND estado = 'en_camino';
    
    -- Si el PIN ingresado por el cadete es correcto:
    IF v_pin_real = p_pin THEN
        UPDATE pedidos SET estado = 'entregado' WHERE id = p_pedido_id;
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- 🚀 MITIGACIÓN DE CONCURRENCIA (RACE CONDITION CADETES)
-- Asegura que 2 cadetes no puedan tomar el mismo pedido al mismo milisegundo.
CREATE OR REPLACE FUNCTION tomar_pedido(p_pedido_id UUID, p_cadete_id UUID) 
RETURNS BOOLEAN AS $$
DECLARE
    affected_rows INTEGER;
BEGIN
    -- Intentamos asignar el cadete SOLO SI todavía está en 'preparado' y sin dueño
    UPDATE pedidos 
    SET cadete_id = p_cadete_id, estado = 'en_camino'
    WHERE id = p_pedido_id 
      AND estado = 'preparado' 
      AND cadete_id IS NULL;
    
    -- Verificamos si logramos actualizar la fila
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    
    -- Si affected_rows > 0, este cadete ganó. Si no, alguien lo tomó antes.
    RETURN affected_rows > 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ======================================================================
-- NUEVO: SOPORTE PARA EMBAJADORES (ROL 'embajador')
-- - Añade el rol 'embajador' al check de perfiles
-- - Añade columnas e índices en `comercios` para trackear quién lo creó
-- - Políticas RLS para embajadores, dueños y clientes
-- - Trigger para crear perfiles al registrarse en auth.users
-- ======================================================================

SET search_path = public, pg_catalog;

-- 1) AÑADIR 'embajador' AL CHECK DE ROLES EN `perfiles`
ALTER TABLE IF EXISTS public.perfiles
    DROP CONSTRAINT IF EXISTS perfiles_rol_check;

ALTER TABLE IF EXISTS public.perfiles
    ADD CONSTRAINT perfiles_rol_check
    CHECK (rol IN ('cliente', 'comercio', 'cadete', 'admin', 'embajador'));

-- 2) AÑADIR COLUMNAS A `comercios`
ALTER TABLE IF EXISTS public.comercios
    ADD COLUMN IF NOT EXISTS creado_por_embajador_id UUID;

ALTER TABLE IF EXISTS public.comercios
    DROP CONSTRAINT IF EXISTS comercios_creado_por_embajador_id_fkey;

ALTER TABLE IF EXISTS public.comercios
    ADD CONSTRAINT comercios_creado_por_embajador_id_fkey
    FOREIGN KEY (creado_por_embajador_id)
    REFERENCES auth.users (id)
    ON DELETE SET NULL
    NOT DEFERRABLE;

ALTER TABLE IF EXISTS public.comercios
    ADD COLUMN IF NOT EXISTS estado_registro TEXT NOT NULL DEFAULT 'pendiente';

ALTER TABLE IF EXISTS public.comercios
    DROP CONSTRAINT IF EXISTS comercios_estado_registro_check;

ALTER TABLE IF EXISTS public.comercios
    ADD CONSTRAINT comercios_estado_registro_check
    CHECK (estado_registro IN ('pendiente', 'activo', 'suspendido'));

CREATE INDEX IF NOT EXISTS idx_comercios_creado_por_embajador
    ON public.comercios (creado_por_embajador_id);

CREATE INDEX IF NOT EXISTS idx_comercios_estado_registro
    ON public.comercios (estado_registro);

-- 3) POLÍTICAS RLS para comercios
ALTER TABLE IF EXISTS public.comercios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lectura_publica_comercios ON public.comercios;
DROP POLICY IF EXISTS dueño_modifica_comercio ON public.comercios;
DROP POLICY IF EXISTS embajador_ver_sus_comercios ON public.comercios;
DROP POLICY IF EXISTS embajador_modifica_sus_comercios ON public.comercios;
DROP POLICY IF EXISTS comercio_dueño_ver ON public.comercios;

CREATE POLICY lectura_comercios_activos
    ON public.comercios
    FOR SELECT
    USING (estado_registro = 'activo');

CREATE POLICY comercio_dueño_select_update
    ON public.comercios
    FOR ALL
    USING (auth.uid() = usuario_id)
    WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY embajador_ver_sus_comercios
    ON public.comercios
    FOR SELECT
    USING (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
        AND creado_por_embajador_id = auth.uid()
    );

CREATE POLICY embajador_modifica_sus_comercios
    ON public.comercios
    FOR UPDATE
    USING (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
        AND creado_por_embajador_id = auth.uid()
    )
    WITH CHECK (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'embajador'
        AND creado_por_embajador_id = auth.uid()
    );

CREATE POLICY admin_todo_comercios
    ON public.comercios
    FOR ALL
    USING (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
    )
    WITH CHECK (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
    );

-- 4) TRIGGER: Al insertarse en auth.users, crear perfil automático
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_create_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role TEXT;
    v_email TEXT;
BEGIN
    v_role := COALESCE(
        NULLIF(NEW.user_metadata::jsonb ->> 'role', ''),
        NULLIF(NEW.raw_user_meta_data::jsonb ->> 'role', ''),
        'cliente'
    );

    v_email := COALESCE(NEW.email, (NEW.user_metadata::jsonb ->> 'email'));

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
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_auth_user_create_profile();

-- 5) RLS para perfiles
ALTER TABLE IF EXISTS public.perfiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS perfiles_usuario_select_update ON public.perfiles;
DROP POLICY IF EXISTS perfiles_admin ON public.perfiles;

CREATE POLICY perfiles_usuario_select_update
    ON public.perfiles
    FOR ALL
    USING (auth.uid() = usuario_id)
    WITH CHECK (auth.uid() = usuario_id);

CREATE POLICY perfiles_admin
    ON public.perfiles
    FOR ALL
    USING (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
    )
    WITH CHECK (
        (SELECT rol FROM public.perfiles WHERE usuario_id = auth.uid()) = 'admin'
    );

-- 6) (Opcional) sincronizar columnas activo <-> estado_registro (ejecutar manualmente si querés)
-- UPDATE public.comercios SET estado_registro = 'activo' WHERE activo = true AND estado_registro IS DISTINCT FROM 'activo';
-- UPDATE public.comercios SET estado_registro = 'pendiente' WHERE activo = false AND estado_registro IS DISTINCT FROM 'pendiente';

-- Fin del bloque EMBAJADORES

-- ==================================================================
-- HISTORIAL DE COMERCIOS
-- Tabla y trigger para auditar creaciones y cambios en `comercios`.
-- ==================================================================

-- Crear tabla de historial
CREATE TABLE IF NOT EXISTS public.comercios_historial (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comercio_id uuid NOT NULL,
    embajador_id uuid,
    usuario_id uuid,
    accion TEXT NOT NULL,
    detalles JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Índice para consultas por embajador o comercio
CREATE INDEX IF NOT EXISTS idx_historial_comercio_id ON public.comercios_historial (comercio_id);
CREATE INDEX IF NOT EXISTS idx_historial_embajador_id ON public.comercios_historial (embajador_id);

-- Función trigger para insertar registros en historial
CREATE OR REPLACE FUNCTION public.comercios_history_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_detalles JSONB;
BEGIN
    IF (TG_OP = 'INSERT') THEN
        v_detalles := jsonb_build_object('new', to_jsonb(NEW));
        INSERT INTO public.comercios_historial(comercio_id, embajador_id, usuario_id, accion, detalles)
        VALUES (NEW.id, NEW.creado_por_embajador_id, NEW.usuario_id, 'create', v_detalles);
        RETURN NEW;
    ELSIF (TG_OP = 'UPDATE') THEN
        -- compute changed columns
        v_detalles := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
        INSERT INTO public.comercios_historial(comercio_id, embajador_id, usuario_id, accion, detalles)
        VALUES (NEW.id, NEW.creado_por_embajador_id, NEW.usuario_id, 'update', v_detalles);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

-- ==================================================================
-- TIPO DE DELIVERY EN PEDIDOS + DEUDA EN COMERCIOS
-- - Añade la columna tipo_delivery a pedidos con CHECK ('app','propio') DEFAULT 'app'
-- - Añade columna deuda a comercios (NUMERIC) para registrar cargos por usar cadete propio
-- - Trigger que incrementa la deuda del comercio cuando un pedido es aceptado como 'propio' (estado -> 'preparando')
-- ==================================================================

-- 1) Columna tipo_delivery en pedidos
ALTER TABLE IF EXISTS public.pedidos
    ADD COLUMN IF NOT EXISTS tipo_delivery TEXT NOT NULL DEFAULT 'app';

ALTER TABLE IF EXISTS public.pedidos
    DROP CONSTRAINT IF EXISTS pedidos_tipo_delivery_check;

ALTER TABLE IF EXISTS public.pedidos
    ADD CONSTRAINT pedidos_tipo_delivery_check
    CHECK (tipo_delivery IN ('app', 'propio'));

-- 2) Columna deuda en comercios
ALTER TABLE IF EXISTS public.comercios
    ADD COLUMN IF NOT EXISTS deuda NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 3) Trigger/function: cuando un pedido pasa a 'preparando' y es 'propio', sumar 15% del subtotal a la deuda
CREATE OR REPLACE FUNCTION public.pedidos_incrementar_deuda_on_preparar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    -- Solo actuamos cuando hay un cambio de estado hacia 'preparando' y el tipo es 'propio'
    IF (TG_OP = 'UPDATE') THEN
        IF (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'preparando' AND NEW.tipo_delivery = 'propio') THEN
            UPDATE public.comercios
            SET deuda = COALESCE(deuda,0) + ROUND(COALESCE(NEW.subtotal,0) * 0.15, 2)
            WHERE id = NEW.comercio_id;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pedidos_incrementar_deuda ON public.pedidos;

CREATE TRIGGER trg_pedidos_incrementar_deuda
AFTER UPDATE ON public.pedidos
FOR EACH ROW
WHEN (OLD.estado IS DISTINCT FROM NEW.estado AND NEW.estado = 'preparando' AND NEW.tipo_delivery = 'propio')
EXECUTE FUNCTION public.pedidos_incrementar_deuda_on_preparar();


-- Crear trigger AFTER INSERT OR UPDATE en comercios
DROP TRIGGER IF EXISTS trg_comercios_history ON public.comercios;
CREATE TRIGGER trg_comercios_history
AFTER INSERT OR UPDATE ON public.comercios
FOR EACH ROW
EXECUTE FUNCTION public.comercios_history_trigger_fn();

