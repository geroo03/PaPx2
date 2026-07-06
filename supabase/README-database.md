# Database — Puerta a Puerta

Schema real exportado de Supabase. Fuente de verdad para el estado actual de las tablas.

**Convenciones:**
- `perfiles.usuario_id` = `auth.users.id` (FK real). `perfiles.id` es un UUID random, **no** el auth UID.
- `cadetes.auth_uid` = `auth.users.id`
- `comercios.usuario_id` = `auth.users.id`
- Roles válidos: `cliente` | `comercio` | `cadete` | `admin` | `embajador`
- Todos los timestamps en `timestamptz` (UTC). `created_at` DEFAULT `now()`.

---

## Índice de tablas

| Tabla | Dominio | Descripción |
|-------|---------|-------------|
| [perfiles](#perfiles) | Usuarios | Perfil de cada usuario registrado |
| [comercios](#comercios) | Comercios | Tiendas registradas en la plataforma |
| [cadetes](#cadetes) | Cadetes | Repartidores |
| [categorias_producto](#categorias_producto) | Catálogo | Categorías de productos por comercio |
| [productos](#productos) | Catálogo | Productos ofrecidos por los comercios |
| [grupos_opcionales](#grupos_opcionales) | Catálogo | Grupos de opciones/extras por producto |
| [opciones_items](#opciones_items) | Catálogo | Ítems dentro de un grupo opcional |
| [pedidos](#pedidos) | Pedidos | Órdenes de compra |
| [mensajes_pedido](#mensajes_pedido) | Pedidos | Chat interno de cada pedido |
| [ofertas_cadetes](#ofertas_cadetes) | Pedidos | Ofertas de trabajo enviadas a cadetes cercanos |
| [ubicacion_cadetes](#ubicacion_cadetes) | Pedidos | GPS en tiempo real de los cadetes |
| [ratings](#ratings) | Valoraciones | Calificación del comercio por pedido |
| [resenas](#resenas) | Valoraciones | Reseñas de cadetes por clientes |
| [reportes](#reportes) | Soporte | Reportes de incidentes |
| [chat_reportes](#chat_reportes) | Soporte | Mensajes dentro de un reporte |
| [advertencias_comercio](#advertencias_comercio) | Soporte | Advertencias administrativas a comercios |
| [promociones](#promociones) | Marketing | Descuentos activos por comercio |
| [patrocinios](#patrocinios) | Embajador | Relación embajador → comercio |
| [billetera_embajadores](#billetera_embajadores) | Embajador | Comisiones acumuladas por pedido (log) |
| [billetera_embajador](#billetera_embajador) | Embajador | Saldo actual del embajador |
| [historial_comisiones](#historial_comisiones) | Embajador | Historial detallado de comisiones |
| [solicitudes_retiro](#solicitudes_retiro) | Embajador | Solicitudes de retiro de saldo |
| [referidos_cadete](#referidos_cadete) | Referidos | Programa de referidos entre cadetes |
| [liquidaciones](#liquidaciones) | Finanzas | Liquidaciones de efectivo a cadetes |
| [fcm_tokens](#fcm_tokens) | Notificaciones | Tokens push FCM por usuario |
| [comercios_historial](#comercios_historial) | Auditoría | Log de cambios en comercios |
| [rubros_config](#rubros_config) | Configuración | Rubros/categorías disponibles para comercios |

---

## Usuarios

### `perfiles`

Perfil de cada usuario. Se crea automáticamente vía trigger al registrarse en `auth.users`.

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | UUID random, **no** es el auth UID |
| `usuario_id` | `uuid` | UNIQUE, FK → auth.users | Auth UID real del usuario |
| `rol` | `text` | CHECK IN ('cliente','comercio','cadete','admin','embajador') | DEFAULT 'cliente' |
| `email` | `text` | | |
| `nombre` | `text` | | |
| `apellido` | `text` | | |
| `vehiculo` | `text` | | Solo cadetes |
| `color` | `text` | | Color del vehículo |
| `avatar_url` | `text` | | |
| `created_at` | `timestamptz` | | |

**Triggers:**
- `trg_auth_user_create_profile` — crea el perfil automáticamente al INSERT en auth.users
- `trg_perfiles_prevent_role_escalation` — bloquea cambios de `rol` desde el browser (solo backend/service_role)
- `trg_perfiles_force_cliente_insert` — fuerza `rol='cliente'` en INSERT directo desde el browser

**RLS:**
- `perfiles_owner_all` — el usuario ve y edita su propio perfil (`usuario_id = auth.uid()`)
- `perfiles_admin_all` — admin tiene acceso total
- `perfiles_cadete_identidad_partes` — clientes y comercios pueden ver el perfil del cadete asignado a su pedido

---

## Comercios

### `comercios`

Tiendas registradas. `estado_registro` controla la visibilidad pública.

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `usuario_id` | `uuid` | FK → auth.users | Dueño del comercio |
| `nombre` | `text` | NOT NULL | |
| `categoria` | `text` | NOT NULL | |
| `descripcion` | `text` | | |
| `direccion` | `text` | | |
| `telefono` | `text` | | |
| `email` | `text` | UNIQUE | |
| `imagen_url` | `text` | | |
| `imagen_emoji` | `text` | | Emoji representativo del comercio |
| `foto_portada_url` | `text` | | |
| `lat` | `numeric` | | Coordenada para asignación de cadetes |
| `lng` | `numeric` | | Coordenada para asignación de cadetes |
| `activo` | `bool` | | |
| `abierto_ahora` | `bool` | | |
| `horario_apertura` | `time` | | |
| `horario_cierre` | `time` | | |
| `dias_abierto` | `text[]` | | Ej: ['lunes','martes',...] |
| `estado_registro` | `text` | NOT NULL, CHECK IN ('pendiente','activo','suspendido') | DEFAULT 'pendiente' |
| `tipo_delivery_defecto` | `text` | NOT NULL, CHECK IN ('app','propio') | DEFAULT 'app' |
| `tipo_delivery` | `text` | | Campo legacy |
| `radio_entrega_km` | `numeric` | | |
| `precio_envio_propio` | `numeric` | | |
| `minutos_espera_cadete` | `int4` | | |
| `rating` | `numeric` | | DEFAULT 5.0 |
| `total_pedidos` | `int4` | | |
| `deuda` | `numeric(12,2)` | NOT NULL | Deuda acumulada con PaP (comisiones). DEFAULT 0 |
| `creado_por_embajador_id` | `uuid` | FK → auth.users | Embajador que registró el comercio |
| `mp_account_id` | `text` | | |
| `mp_access_token` | `text` | | |
| `mp_user_id` | `text` | | |
| `mp_conectado` | `bool` | | |
| `titular_bancario` | `text` | | |
| `tipo_cuenta` | `text` | | |
| `cbu_alias` | `text` | | |
| `cuit` | `text` | | |
| `razon_social` | `text` | | |
| `ciudad` | `text` | | |
| `codigo_postal` | `text` | | |
| `barrio` | `text` | | |
| `provincia` | `text` | | |
| `email_facturacion` | `text` | | |
| `banco` | `text` | | |
| `comision_nortpi` | `numeric` | | Campo legacy/sin uso activo |
| `created_at` | `timestamp` | | |

**Triggers:**
- `trg_comercios_auditoria` — registra cada INSERT/UPDATE en `comercios_historial`
- `trg_pedidos_acumular_deuda` — incrementa `deuda` cuando un pedido `tipo_delivery='propio'` pasa a `preparando`

**RLS:**
- `comercios_lectura_activos` — SELECT público para comercios con `estado_registro='activo'`
- `comercios_owner_all` — el dueño puede todo sobre su propio comercio
- `comercios_embajador_ver/update` — el embajador puede ver y actualizar los comercios que creó
- `comercios_admin_all` — admin tiene acceso total

---

## Cadetes

### `cadetes`

Perfil operativo del repartidor. Separado de `perfiles` para tener datos propios del rol.

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `auth_uid` | `uuid` | UNIQUE, FK → auth.users | Auth UID del cadete |
| `nombre` | `text` | NOT NULL | |
| `email` | `text` | UNIQUE | |
| `telefono` | `text` | UNIQUE | |
| `fecha_nacimiento` | `date` | | |
| `vehiculo` | `text` | | |
| `color` | `text` | | Color del vehículo |
| `patente` | `text` | | |
| `antecedentes` | `bool` | | ¿Subió certificado de antecedentes? |
| `antecedentes_path` | `text` | | Path en Storage bucket `cadetes-antecedentes` |
| `foto_dni_url` | `text` | | |
| `seguro_url` | `text` | | |
| `carnet_url` | `text` | | |
| `disponible` | `bool` | | Disponible para recibir pedidos |
| `activo` | `bool` | | Cuenta activa |
| `onboarding_completo` | `bool` | | |
| `lat` | `numeric` | | Última posición conocida |
| `lng` | `numeric` | | Última posición conocida |
| `zona` | `text` | | |
| `rating` | `numeric` | | DEFAULT 5.0 |
| `total_viajes` | `int4` | | |
| `ganancias_semana` | `numeric` | | |
| `cobro_frecuencia` | `text` | | DEFAULT 'semanal' |
| `codigo_referido` | `text` | UNIQUE | Código que comparte para referir otros cadetes |
| `referido_por` | `text` | | Código con el que se registró |
| `deuda_efectivo` | `numeric(12,2)` | NOT NULL | Deuda acumulada por pedidos cobrados en efectivo. DEFAULT 0 |
| `limite_efectivo` | `numeric(12,2)` | NOT NULL | Límite de deuda en efectivo antes de bloquearse. DEFAULT 15000 |
| `cvu` | `text` | | |
| `mp_access_token` | `text` | | |
| `mp_user_id` | `text` | | |
| `mp_conectado` | `bool` | | |
| `created_at` | `timestamp` | | |
| `updated_at` | `timestamptz` | | AUTO-actualizado por trigger |

**Triggers:**
- `trg_set_updated_at` — actualiza `updated_at` en cada UPDATE

**RLS:**
- `cadetes_owner_select/insert/update` — el cadete accede solo a su propio registro
- `cadetes_admin_all` — admin tiene acceso total

---

## Catálogo

### `categorias_producto`

Categorías de productos por comercio (ej: "Pizzas", "Bebidas").

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `uuid` | FK → comercios |
| `nombre` | `text` | NOT NULL |
| `orden` | `int4` | DEFAULT 0 |
| `created_at` | `timestamptz` | |

---

### `productos`

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `uuid` | FK → comercios |
| `categoria_id` | `uuid` | FK → categorias_producto (nullable) |
| `nombre` | `text` | NOT NULL |
| `descripcion` | `text` | |
| `precio` | `numeric` | |
| `precio_base` | `numeric` | DEFAULT 0 |
| `imagen_url` | `text` | |
| `disponible` | `bool` | DEFAULT true |
| `created_at` | `timestamptz` | |

---

### `grupos_opcionales`

Grupos de extras/opciones asociados a un comercio (ej: "Tamaño", "Extras").

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `uuid` | NOT NULL, FK → comercios |
| `nombre` | `text` | NOT NULL |
| `min_opciones` | `int4` | NOT NULL, DEFAULT 0 |
| `max_opciones` | `int4` | NOT NULL, DEFAULT 1 |
| `created_at` | `timestamptz` | NOT NULL |

---

### `opciones_items`

Ítems dentro de un grupo opcional (ej: "Grande +$200", "Sin cebolla").

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `grupo_opcional_id` | `uuid` | FK → grupos_opcionales |
| `nombre` | `text` | NOT NULL |
| `precio_adicional` | `numeric` | DEFAULT 0 |
| `disponible` | `bool` | |
| `created_at` | `timestamptz` | |

---

## Pedidos

### `pedidos`

Orden de compra central del sistema.

**Estados:** `nuevo` → `preparando` → `preparado` → `en_preparacion` → `listo` → `en_camino` → `entregado` / `cancelado` / `rechazado`

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `numero` | `int4` | | Número incremental visible al usuario |
| `cliente_id` | `uuid` | FK → auth.users | |
| `comercio_id` | `uuid` | FK → comercios | |
| `cadete_id` | `uuid` | | FK → auth.users (sin FK explícita) |
| `productos` | `jsonb` | | Snapshot de los productos al momento del pedido |
| `subtotal` | `numeric(12,2)` | NOT NULL | |
| `costo_envio` | `numeric(12,2)` | NOT NULL | DEFAULT 800 |
| `propina_cadete` | `int4` | NOT NULL | DEFAULT 0 |
| `monto_comision_app` | `numeric(12,2)` | NOT NULL | 15% del subtotal. Calculado por trigger |
| `total` | `numeric(12,2)` | NOT NULL | |
| `total_final` | `numeric(12,2)` | NOT NULL | subtotal + costo_envio. Calculado por trigger |
| `estado` | `text` | NOT NULL | Ver estados arriba |
| `estado_pago` | `text` | NOT NULL, CHECK IN ('pendiente','aprobado','rechazado') | DEFAULT 'pendiente' |
| `tipo_delivery` | `text` | NOT NULL, CHECK IN ('app','propio') | DEFAULT 'app' |
| `metodo_pago` | `text` | | 'efectivo' \| 'mercadopago' \| 'transferencia' |
| `mp_payment_id` | `text` | | ID de pago en MercadoPago |
| `direccion_entrega` | `text` | | |
| `notas` | `text` | | |
| `codigo_retiro` | `text` | | PIN 4 dígitos para retirar en el comercio |
| `codigo_entrega` | `text` | | PIN 4 dígitos para confirmar entrega |
| `pin` | `text` | | |
| `distancia_estimada` | `numeric(10,2)` | | Km calculados server-side |
| `pago_cadete` | `int4` | | $ARS calculado server-side (Base $600 + $250/km) |
| `cobrado_efectivo` | `bool` | NOT NULL | DEFAULT false |
| `liquidado` | `bool` | NOT NULL | DEFAULT false |
| `created_at` | `timestamptz` | | |

**Triggers:**
- `trg_pedidos_compute_totals` — calcula `monto_comision_app` y `total_final` en cada INSERT/UPDATE
- `trg_pedidos_acumular_deuda` — acumula deuda al comercio cuando `tipo_delivery='propio'` y `estado='preparando'`
- `trg_pedidos_deuda_efectivo` — marca `cobrado_efectivo=true` y acumula deuda al comercio cuando `metodo_pago='efectivo'` y `estado='entregado'`
- `trg_pedidos_comision_referido` — acredita 2% al cadete referente cuando `estado='entregado'` (máx 50 viajes)
- `trg_pedidos_comision_embajador` — acredita comisión al embajador cuando `estado='entregado'` (5% primeros 6 meses, 2% hasta mes 12)

**RPCs:**
- `confirmar_entrega(p_pedido_id, p_pin)` → boolean
- `tomar_pedido(p_pedido_id, p_cadete_id)` → boolean (anti-colisión, solo si `cadete_id IS NULL`)

---

### `mensajes_pedido`

Chat en tiempo real dentro de cada pedido.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `pedido_id` | `uuid` | NOT NULL, FK → pedidos |
| `remitente_id` | `uuid` | NOT NULL, FK → auth.users |
| `rol_remitente` | `text` | NOT NULL, CHECK IN ('cliente','comercio','cadete','admin') |
| `mensaje` | `text` | NOT NULL, CHECK length BETWEEN 1 AND 1000 |
| `creado_at` | `timestamptz` | NOT NULL |

**RLS:** Solo los participantes del pedido (cliente, comercio, cadete) pueden leer e insertar.

---

### `ofertas_cadetes`

Ofertas de trabajo difundidas a cadetes cercanos. Generadas por `POST /api/pedidos/difundir`.

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `id` | `uuid` | PK | |
| `pedido_id` | `uuid` | NOT NULL, FK → pedidos | |
| `cadete_id` | `uuid` | NOT NULL | FK a `cadetes.auth_uid` (sin FK explícita) |
| `comercio_nombre` | `text` | NOT NULL | |
| `comercio_direccion` | `text` | | |
| `comercio_lat` | `numeric` | | |
| `comercio_lng` | `numeric` | | |
| `cliente_direccion` | `text` | | |
| `distancia_km` | `numeric` | | |
| `ganancia_estimada` | `numeric` | | |
| `distancia_estimada` | `numeric` | | |
| `pago_cadete` | `numeric` | | |
| `estado` | `text` | NOT NULL, CHECK IN ('pendiente','aceptada','rechazada') | DEFAULT 'pendiente' |
| `created_at` | `timestamptz` | | |

**Realtime habilitado** en el Dashboard de Supabase.

---

### `ubicacion_cadetes`

GPS en tiempo real. PK es `cadete_id` (una fila por cadete, upsert).

| Columna | Tipo | Constraints | Notas |
|---------|------|-------------|-------|
| `cadete_id` | `uuid` | PK, FK → auth.users | |
| `latitud` | `numeric` | | Columna original |
| `longitud` | `numeric` | | Columna original |
| `lat` | `numeric` | | Alias de latitud (sincronizado por trigger) |
| `lng` | `numeric` | | Alias de longitud (sincronizado por trigger) |
| `pedido_id` | `uuid` | FK → pedidos | Pedido activo del cadete |
| `ultima_actualizacion` | `timestamptz` | | |

**Trigger:** `trg_sync_lat_lng` — sincroniza `lat`/`lng` desde `latitud`/`longitud` en cada write.

**RLS:** Lectura pública. Escritura solo del propio cadete.

---

## Valoraciones

### `ratings`

Calificación del comercio por pedido (una por pedido).

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `pedido_id` | `uuid` | UNIQUE, FK → pedidos |
| `comercio_id` | `uuid` | FK → comercios |
| `usuario_id` | `uuid` | FK → auth.users (cliente) |
| `puntaje_comercio` | `int2` | CHECK BETWEEN 1 AND 5 |
| `puntaje_cadete` | `int2` | CHECK BETWEEN 1 AND 5 |
| `comentario` | `text` | |
| `tags_feedback` | `text[]` | |
| `created_at` | `timestamptz` | NOT NULL |

> **Nota:** El backend inserta también `{ rating: N }`. La columna `rating` debe existir (ver [fix-criticos-importantes.sql](fix-criticos-importantes.sql)).

---

### `resenas`

Reseñas de cadetes escritas por clientes.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `pedido_id` | `uuid` | FK → pedidos |
| `usuario_id` | `uuid` | FK → auth.users |
| `comercio_id` | `uuid` | FK → comercios |
| `cadete_id` | `uuid` | |
| `cliente_id` | `uuid` | |
| `rating_comercio` | `int4` | |
| `rating_cadete` | `int4` | |
| `comentario` | `text` | |
| `created_at` | `timestamp` | |

---

## Soporte

### `reportes`

Reportes de incidentes enviados por usuarios o comercios.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `pedido_id` | `uuid` | FK → pedidos |
| `usuario_id` | `uuid` | FK → auth.users |
| `comercio_id` | `text` | Debería ser `uuid` — pendiente migrar |
| `tipo` | `text` | |
| `motivo` | `text` | |
| `descripcion` | `text` | |
| `estado` | `text` | DEFAULT 'pendiente' |
| `limite_resolucion` | `timestamptz` | |
| `created_at` | `timestamptz` | |

---

### `chat_reportes`

Mensajes del chat de soporte asociado a un reporte.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `reporte_id` | `uuid` | FK → reportes |
| `pedido_id` | `uuid` | FK → pedidos |
| `comercio_id` | `text` | |
| `de` | `text` | Identificador del remitente |
| `texto` | `text` | |
| `created_at` | `timestamptz` | |

**RLS:** Solo participantes del reporte (usuario_id, admin, comercio).

---

### `advertencias_comercio`

Advertencias administrativas emitidas contra un comercio.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `text` | Debería ser `uuid` — pendiente migrar |
| `pedido_id` | `uuid` | FK → pedidos |
| `motivo` | `text` | |
| `created_at` | `timestamptz` | |

---

## Marketing

### `promociones`

Descuentos y promociones activas por comercio.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `uuid` | NOT NULL, FK → comercios |
| `tipo` | `text` | NOT NULL ('porcentaje' \| 'valor_fijo') |
| `porcentaje` | `int4` | |
| `valor` | `numeric` | |
| `producto_id` | `uuid` | FK → productos (si aplica a un producto específico) |
| `descripcion` | `text` | |
| `activa` | `bool` | DEFAULT true |
| `fecha_inicio` | `date` | |
| `fecha_fin` | `date` | |
| `created_at` | `timestamp` | |

---

## Embajador

### `patrocinios`

Relación entre un embajador y los comercios que consiguió.

> **Estado actual:** La tabla tiene estructura híbrida (columnas de banners + columnas de embajador). El parche en [fix-criticos-importantes.sql](fix-criticos-importantes.sql) la reemplaza con la versión correcta y mueve los banners a la tabla `banners`.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `int8` | PK (bigserial — legacy) |
| `embajador_id` | `uuid` | FK → auth.users |
| `comercio_id` | `uuid` | FK → comercios |
| `fecha_inicio` | `timestamptz` | |
| `activo` | `bool` | |
| `created_at` | `timestamptz` | |
| `sub_titulo` | `text` | Legacy (pertenece a banners) |
| `titulo` | `text` | Legacy (pertenece a banners) |
| `imagen_url` | `text` | Legacy (pertenece a banners) |
| `link_oferta` | `text` | Legacy (pertenece a banners) |
| `orden` | `int4` | Legacy (pertenece a banners) |

---

### `billetera_embajadores`

Log de comisiones generadas por pedido entregado (inmutable, append-only).

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `embajador_id` | `uuid` | NOT NULL, FK → auth.users |
| `comercio_id` | `uuid` | NOT NULL |
| `pedido_id` | `uuid` | NOT NULL |
| `monto_comision` | `numeric(12,2)` | NOT NULL |
| `periodo_mes` | `int4` | NOT NULL (year*12 + month) |
| `created_at` | `timestamptz` | |

---

### `billetera_embajador`

Saldo actual del embajador (una fila por embajador, upsert).

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `embajador_id` | `uuid` | PK, FK → auth.users |
| `saldo_disponible` | `numeric(12,2)` | NOT NULL |
| `saldo_acumulado` | `numeric(12,2)` | NOT NULL |
| `saldo_retirado` | `numeric(12,2)` | NOT NULL |
| `updated_at` | `timestamptz` | NOT NULL |

**RPCs:**
- `acreditar_comision(p_embajador_id, p_monto)` — upsert del saldo
- `solicitar_retiro_embajador(p_embajador_id, p_monto, p_cbu_alias)` → json
- `confirmar_pago_retiro(p_solicitud_id)` → json
- `rechazar_retiro(p_solicitud_id, p_motivo)` → json

---

### `historial_comisiones`

Detalle de cada comisión calculada (tasa, meses de antigüedad del comercio).

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `embajador_id` | `uuid` | NOT NULL, FK → auth.users |
| `comercio_id` | `uuid` | NOT NULL |
| `pedido_id` | `uuid` | NOT NULL, FK → pedidos, UNIQUE con embajador_id |
| `monto_pedido` | `numeric(12,2)` | NOT NULL |
| `tasa_aplicada` | `numeric(5,4)` | NOT NULL (ej: 0.0500 = 5%) |
| `monto_comision` | `numeric(12,2)` | NOT NULL |
| `meses_activo` | `int4` | NOT NULL |
| `created_at` | `timestamptz` | NOT NULL |

**Regla de comisiones:**
- Meses 1–6: 5% del `total_final`
- Meses 7–12: 2% del `total_final`
- Mes 13+: sin comisión

---

### `solicitudes_retiro`

Solicitudes de retiro de saldo del embajador.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `embajador_id` | `uuid` | NOT NULL, FK → auth.users |
| `monto` | `numeric(12,2)` | NOT NULL |
| `estado` | `text` | NOT NULL, CHECK IN ('pendiente','pagado','rechazado') |
| `cbu_alias` | `text` | |
| `notas_admin` | `text` | |
| `created_at` | `timestamptz` | NOT NULL |
| `updated_at` | `timestamptz` | NOT NULL |

---

## Referidos

### `referidos_cadete`

Programa de referidos entre cadetes. Un cadete referente gana 2% del `pago_cadete` por cada viaje del referido (máximo 50 viajes).

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `referente_id` | `uuid` | NOT NULL, FK → auth.users |
| `referido_id` | `uuid` | NOT NULL, UNIQUE, FK → auth.users |
| `codigo_usado` | `text` | NOT NULL |
| `bonificacion` | `numeric(12,2)` | NOT NULL, DEFAULT 500 |
| `estado` | `text` | NOT NULL, CHECK IN ('pendiente','acreditado','completado') |
| `created_at` | `timestamptz` | |

> **Nota:** Las columnas `viajes_contados`, `comision_acumulada`, `viajes_limite` están en el schema SQL pero pueden no existir aún en la DB. Ver [fix-criticos-importantes.sql](fix-criticos-importantes.sql).

---

## Finanzas

### `liquidaciones`

Liquidaciones de efectivo adeudado por los cadetes a la plataforma.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `cadete_id` | `uuid` | NOT NULL, FK → auth.users |
| `monto` | `numeric(12,2)` | NOT NULL |
| `metodo` | `text` | NOT NULL, CHECK IN ('transferencia','efectivo','mercadopago') |
| `estado` | `text` | NOT NULL, CHECK IN ('pendiente','confirmada','rechazada') |
| `comprobante_url` | `text` | |
| `notas` | `text` | |
| `created_at` | `timestamptz` | |
| `confirmado_at` | `timestamptz` | |

---

## Notificaciones

### `fcm_tokens`

Tokens FCM para push notifications. Un usuario puede tener múltiples dispositivos.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | NOT NULL, FK → auth.users |
| `token` | `text` | NOT NULL, UNIQUE |
| `rol` | `text` | |
| `created_at` | `timestamptz` | |

---

## Auditoría

### `comercios_historial`

Log de auditoría de INSERT/UPDATE en `comercios`. Generado automáticamente por trigger.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `uuid` | PK |
| `comercio_id` | `uuid` | NOT NULL |
| `embajador_id` | `uuid` | |
| `usuario_id` | `uuid` | |
| `accion` | `text` | NOT NULL ('INSERT' \| 'UPDATE') |
| `detalles` | `jsonb` | Snapshot `{old, new}` del registro |
| `created_at` | `timestamptz` | |

---

## Configuración

### `rubros_config`

Catálogo de rubros/categorías disponibles para asignar a un comercio.

| Columna | Tipo | Constraints |
|---------|------|-------------|
| `id` | `text` | PK (slug, ej: 'pizzeria') |
| `label` | `text` | NOT NULL (nombre visible) |
| `activo` | `bool` | NOT NULL |
| `orden` | `int4` | |

---

## Storage Buckets

| Bucket | Visibilidad | Uso |
|--------|-------------|-----|
| `productos` | Público | Imágenes de productos de comercios |
| `cadetes-antecedentes` | Privado | Certificados de antecedentes penales de cadetes |

**Políticas bucket `cadetes-antecedentes`:**
- INSERT: solo el propio cadete (`auth.uid() = foldername[1]`)
- SELECT: el propio cadete o admin
- UPDATE: solo el propio cadete

---

## Realtime

Habilitar en el Dashboard de Supabase → Table Editor → Replication:

| Tabla | Motivo |
|-------|--------|
| `ofertas_cadetes` | Cadete recibe oferta en tiempo real |
| `pedidos` | Comercio y cliente ven cambios de estado |
| `ubicacion_cadetes` | Cliente y comercio rastrean al cadete |
| `mensajes_pedido` | Chat en tiempo real |

---

## Pendientes / Issues conocidos

| # | Tabla | Problema | Estado |
|---|-------|----------|--------|
| 1 | `patrocinios` | Estructura híbrida (banners + embajador mezclados) | Resuelto en `fix-criticos-importantes.sql` (pendiente ejecutar) |
| 2 | `ratings` | Falta columna `rating` que usa el backend | Resuelto en `fix-criticos-importantes.sql` |
| 3 | `reportes` | `comercio_id` es `text` en vez de `uuid` | Resuelto en `fix-criticos-importantes.sql` |
| 4 | `advertencias_comercio` | `comercio_id` es `text` en vez de `uuid` | Resuelto en `fix-criticos-importantes.sql` |
| 5 | `referidos_cadete` | Faltan columnas `viajes_contados`, `comision_acumulada`, `viajes_limite` | Resuelto en `fix-criticos-importantes.sql` |
| 6 | `chat_reportes` | Sin RLS (deny-all por defecto) | Resuelto en `fix-criticos-importantes.sql` |
| 7 | `comercios` | `lat`/`lng` de comercios existentes pueden estar NULL | Manual: poblar desde el Dashboard |
