# Puerta a Puerta

Plataforma de delivery en tiempo real para Santiago del Estero, Argentina.
Conecta 5 roles: **cliente**, **comercio**, **cadete** (repartidor), **embajador** y **admin**.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 20+ / Express 5 / ES Modules (`"type": "module"`) |
| Base de datos | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| Pagos | MercadoPago SDK v3 (preferencias + webhook HMAC-SHA256) |
| Frontend | HTML/CSS/JS vanilla + Supabase CDN client + Leaflet.js (mapa) |
| Deploy | Railway (backend) + Vercel (frontend) + Supabase (DB) |

---

## Estructura del proyecto

```
puertaapuerta-main/
│
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── authController.js       # POST /api/auth/set-role — asigna rol post-registro
│   │   │   ├── pedidoController.js     # Difundir, aceptar, cambiar estado, valorar pedidos
│   │   │   ├── cadeteController.js     # POST /api/cadete/actualizar-ubicacion — GPS cada 10s
│   │   │   ├── mpController.js         # MercadoPago: crear preferencia + webhook con HMAC
│   │   │   └── embajadorController.js  # Dashboard, agregar comercio, retiros, comisiones
│   │   │
│   │   ├── lib/
│   │   │   ├── supabaseClient.js       # Cliente Supabase con service_role (bypass RLS)
│   │   │   ├── roleUtils.js            # resolveRol() — lee rol desde perfiles.usuario_id
│   │   │   └── comisionUtils.js        # calcularComision(fechaInicio, monto) → {tasa, monto}
│   │   │
│   │   ├── middlewares/
│   │   │   └── authMiddleware.js       # requireAuth — valida Bearer JWT contra Supabase Auth
│   │   │
│   │   ├── routes/
│   │   │   ├── authRoutes.js           # /api/auth/*
│   │   │   ├── pedidoRoutes.js         # /api/pedidos/*
│   │   │   ├── cadeteRoutes.js         # /api/cadete/*
│   │   │   ├── mpRoutes.js             # /api/mp/*
│   │   │   └── embajadorRoutes.js      # /api/embajadores/*
│   │   │
│   │   └── server.js                   # Punto de entrada — monta rutas, CORS, health check
│   │
│   ├── .env.example                    # Template de variables de entorno (sin secretos)
│   ├── .gitignore
│   ├── package.json                    # main: "src/server.js", start: "node src/server.js"
│   └── package-lock.json
│
├── frontend/
│   ├── cliente/
│   │   ├── index.html                  # App principal del cliente (carrito, pedidos, tracking)
│   │   ├── login-usuario.html          # Registro de cliente nuevo
│   │   ├── oauth-callback.html         # Callback OAuth
│   │   └── pago.html                   # Pantalla de pago MercadoPago
│   │
│   ├── comercio/
│   │   ├── comercio.html               # Panel del comercio (productos, pedidos entrantes)
│   │   ├── login.html                  # Login del comercio
│   │   └── registro-comercio.html      # Registro de comercio nuevo
│   │
│   ├── cadete/
│   │   ├── cadete.html                 # Panel del cadete (ofertas, viaje activo, perfil)
│   │   ├── registro-cadete.html        # Login con Google OAuth
│   │   └── oauth-callback-cadete.html  # Callback OAuth cadete
│   │
│   ├── embajador/
│   │   └── dashboard.html              # Billetera, comisiones, agregar comercio, retiros
│   │
│   ├── admin/
│   │   ├── admin.html                  # Panel administrativo
│   │   ├── admin-acceso.html           # Login admin
│   │   └── crear-embajador.html        # Crear usuario embajador
│   │
│   ├── assets/
│   │   ├── css/                        # Un CSS por rol (index, login, cadete, comercio, etc.)
│   │   └── js/
│   │       ├── config.js               # Inicializa cliente Supabase desde window globals
│   │       ├── auth-service.js         # signIn, signUp, signUpAndAssignRole, logout
│   │       ├── login.js                # Login general — redirige por rol según perfiles.usuario_id
│   │       ├── cliente.js              # App cliente: comercios, carrito, tracking con Leaflet
│   │       ├── comercio.js             # Panel comercio: productos, pedidos, difundir
│   │       ├── cadete.js               # Panel cadete: ofertas, GPS, códigos, onboarding
│   │       ├── embajador.js            # Dashboard embajador: billetera, retiros, comercios
│   │       ├── admin.js                # Panel admin
│   │       ├── order-service.js        # Helpers de pedidos
│   │       ├── api.js                  # Fetch helpers
│   │       ├── state.js                # Estado global del carrito
│   │       ├── ui.js                   # formatARS, sanitizeHTML
│   │       ├── icons.js                # SVG icons como strings
│   │       └── main.js                 # Bootstrap: carga config, expone globals
│   │
│   ├── index.html                      # Redirect / → /login.html
│   ├── login.html                      # Login general (todos los roles)
│   ├── sw.js                           # Service Worker para push notifications
│   ├── env.js.template                 # Template: SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_URL
│   ├── _redirects                      # Netlify redirects (fallback)
│   └── vercel.json                     # Config Vercel: SPA routing
│
├── supabase/
│   ├── schema-definitivo-v2.sql        # TODO el schema SQL en un solo archivo (ver detalle abajo)
│   └── functions/mp-webhook/index.ts   # Edge Function alternativa para webhook MP
│
├── .gitignore
└── README.md
```

---

## Base de datos — Tablas principales

| Tabla | Descripción | Columnas clave |
|-------|-------------|----------------|
| `perfiles` | Perfil de cada usuario | `usuario_id` (FK auth.users), `rol`, `nombre`, `apellido` |
| `comercios` | Tiendas registradas | `usuario_id`, `lat`, `lng`, `creado_por_embajador_id` |
| `cadetes` | Repartidores | `auth_uid` (FK auth.users), `vehiculo` (moto/bici), `cvu`, `foto_dni_url`, `onboarding_completo`, `codigo_referido` |
| `productos` | Catálogo por comercio | `comercio_id`, `nombre`, `precio_base`, `imagen_url` |
| `pedidos` | Órdenes | `cliente_id`, `comercio_id`, `cadete_id`, `estado`, `codigo_retiro`, `codigo_entrega`, `distancia_estimada`, `pago_cadete` |
| `ofertas_cadetes` | Ofertas de viaje broadcast | `pedido_id`, `cadete_id`, `distancia_km`, `ganancia_estimada`, `estado` |
| `ubicacion_cadetes` | GPS en tiempo real | `cadete_id`, `latitud`, `longitud`, `pedido_id`, `ultima_actualizacion` |
| `ratings` | Calificaciones a comercios | `pedido_id`, `comercio_id`, `usuario_id`, `rating` (1-5) |
| `resenas` | Calificaciones a cadetes | `pedido_id`, `cadete_id`, `cliente_id`, `rating` (1-5) |
| `patrocinios` | Embajador ↔ Comercio | `embajador_id`, `comercio_id`, `fecha_inicio`, `activo` |
| `historial_comisiones` | Comisión por pedido | `embajador_id`, `pedido_id`, `tasa_aplicada`, `monto_comision`, `meses_activo` |
| `billetera_embajador` | Saldo embajador | `saldo_disponible`, `saldo_acumulado`, `saldo_retirado` |
| `solicitudes_retiro` | Retiros pendientes | `embajador_id`, `monto`, `estado` (pendiente/pagado/rechazado) |

### RPCs (funciones atómicas en PostgreSQL)

| Función | Qué hace |
|---------|----------|
| `acreditar_comision(embajador_id, monto)` | UPSERT en billetera: incrementa saldo_disponible y saldo_acumulado |
| `solicitar_retiro_embajador(embajador_id, monto, cbu)` | Valida saldo, crea solicitud, congela monto — todo en una transacción |
| `confirmar_pago_retiro(solicitud_id)` | Admin marca pagado, suma a saldo_retirado |
| `rechazar_retiro(solicitud_id, motivo)` | Admin rechaza, devuelve monto a saldo_disponible |

### Triggers

| Trigger | Tabla | Qué hace |
|---------|-------|----------|
| `handle_new_auth_user_create_profile` | `auth.users` | Crea fila en `perfiles` con rol del `user_metadata` |
| `set_updated_at` | `cadetes`, `comercios` | Actualiza `updated_at` en cada UPDATE |
| `sync_ubicacion_lat_lng` | `ubicacion_cadetes` | Copia `latitud`→`lat`, `longitud`→`lng` |

---

## Endpoints del backend

### Autenticación
| Método | Ruta | Auth | Body | Descripción |
|--------|------|------|------|-------------|
| POST | `/api/auth/set-role` | JWT | `{ role }` | Asigna rol. Permitidos: `cliente`, `usuario`, `comercio`, `cadete`. Bloqueados: `admin`, `embajador`. Normaliza `usuario` → `cliente` |

### Pedidos
| Método | Ruta | Auth | Body | Descripción |
|--------|------|------|------|-------------|
| POST | `/api/pedidos/difundir` | JWT | `{ pedidoId, comercioId }` | Lee GPS de cadetes activos (últimos 15 min), calcula Haversine, filtra ≤10km, genera ofertas con tarifa (bici $1200 / moto $1800 base + $250/km) |
| POST | `/api/pedidos/aceptar` | JWT | `{ pedidoId, cadeteId, ofertaId }` | Anti-colisión: `.is('cadete_id', null)`. Genera códigos CSPRNG. Copia tarifa inmutable desde oferta |
| POST | `/api/pedidos/cambiar-estado` | JWT | `{ pedido_id, nuevo_estado, codigo_retiro?, codigo_entrega? }` | `en_camino` requiere código retiro, `entregado` requiere código entrega. Validación con `timingSafeEqual`. Al entregar, dispara comisión embajador |
| POST | `/api/pedidos/valorar` | JWT | `{ pedido_id, tipo, estrellas, comentario? }` | `tipo`: `comercio` (→ tabla ratings) o `cadete` (→ tabla resenas). Estrellas 1-5, UNIQUE por pedido |
| GET | `/api/pedidos/:id` | JWT | — | Devuelve pedido + perfil del cadete. Código entrega solo visible al cliente cuando estado = `en_camino` |

### MercadoPago
| Método | Ruta | Auth | Body | Descripción |
|--------|------|------|------|-------------|
| POST | `/api/mp/crear-preferencia` | JWT | `{ pedido_id, items, total, propina_cadete? }` | Crea preferencia MP. Verifica que el pedido pertenece al usuario. Propina máx $10.000 |
| POST | `/api/mp/webhook` | HMAC | Payload MP | Verifica firma HMAC-SHA256. Si `status=approved` → pedido pasa a `pagado` |

### Cadete GPS
| Método | Ruta | Auth | Body | Descripción |
|--------|------|------|------|-------------|
| POST | `/api/cadete/actualizar-ubicacion` | JWT | `{ lat, lng, pedido_id? }` | Valida rango GPS, verifica rol cadete via `resolveRol`, UPSERT en `ubicacion_cadetes`. El frontend lo llama cada 10s |

### Embajadores
| Método | Ruta | Auth | Body | Descripción |
|--------|------|------|------|-------------|
| GET | `/api/embajadores/dashboard` | JWT | — | Devuelve: billetera, últimas 50 comisiones (con `tasa_aplicada`), patrocinios con datos del comercio, solicitudes de retiro |
| POST | `/api/embajadores/comercios` | JWT | `{ nombre, direccion, rubro, telefono?, email?, lat?, lng? }` | Crea comercio + patrocinio. El comercio arranca con `estado_registro=pendiente` |
| POST | `/api/embajadores/solicitar-retiro` | JWT | `{ monto, cbu_alias? }` | Llama RPC `solicitar_retiro_embajador`. Congela el monto del saldo disponible |
| PATCH | `/api/embajadores/retiro/:id/pagar` | JWT (admin) | — | Llama RPC `confirmar_pago_retiro`. Solo admin |
| PATCH | `/api/embajadores/retiro/:id/rechazar` | JWT (admin) | `{ motivo? }` | Llama RPC `rechazar_retiro`. Devuelve saldo. Solo admin |

### Health
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | No | Devuelve `{ ok, service, env, timestamp }` |

---

## Flujos principales

### Flujo de un pedido (cliente → cadete → entrega)

```
1. Cliente elige productos y confirma pedido
   → INSERT en pedidos (estado: 'nuevo')

2. Comercio ve el pedido y lo acepta
   → POST /api/pedidos/difundir { pedidoId, comercioId }
   → Backend calcula Haversine para cada cadete con GPS activo
   → Filtra cadetes dentro de 10 km
   → INSERT en ofertas_cadetes (Supabase Realtime lo propaga)

3. Cadete ve la oferta en su panel (con timer de 20 segundos)
   → POST /api/pedidos/aceptar { pedidoId, cadeteId, ofertaId }
   → Anti-colisión: UPDATE WHERE cadete_id IS NULL
   → Se generan codigo_retiro y codigo_entrega (4 dígitos CSPRNG)
   → Se copia distancia_estimada y pago_cadete desde la oferta (inmutable)

4. Cadete va al comercio, retira el pedido
   → POST /api/pedidos/cambiar-estado { pedido_id, nuevo_estado: 'en_camino', codigo_retiro: '1234' }
   → Backend valida código con crypto.timingSafeEqual

5. Cadete llega al cliente, entrega el pedido
   → POST /api/pedidos/cambiar-estado { pedido_id, nuevo_estado: 'entregado', codigo_entrega: '5678' }
   → Backend valida código
   → Dispara comisión embajador si el comercio tiene patrocinio activo

6. Cliente califica
   → POST /api/pedidos/valorar { pedido_id, tipo: 'comercio', estrellas: 5 }
```

### Flujo de comisión embajador

```
1. Embajador registra un comercio
   → POST /api/embajadores/comercios
   → Se crea fila en patrocinios con fecha_inicio = now()

2. Cada vez que un pedido de ese comercio se entrega:
   → registrarComisionSiAplica() se ejecuta automáticamente
   → calcularComision(fecha_inicio, monto_pedido)
     - < 6 meses desde fecha_inicio: tasa = 5%
     - >= 6 meses: tasa = 2%
   → INSERT en historial_comisiones (con tasa_aplicada para transparencia)
   → RPC acreditar_comision incrementa billetera

3. Embajador solicita retiro
   → POST /api/embajadores/solicitar-retiro { monto: 5000, cbu_alias: 'mi.alias' }
   → RPC congela el monto (saldo_disponible -= monto)

4. Admin transfiere y confirma
   → PATCH /api/embajadores/retiro/:id/pagar
   → saldo_retirado += monto
```

### Tarifas cadete

| Vehículo | Base | Fórmula | 3 km | 5 km | 10 km |
|----------|------|---------|------|------|-------|
| Bici | $1.200 | `round((base + km × 250) / 50) × 50` | $1.950 | $2.450 | $3.700 |
| Moto | $1.800 | `round((base + km × 250) / 50) × 50` | $2.550 | $3.050 | $4.300 |

---

## Reglas de seguridad (no negociables)

1. **Secretos solo en server:** `SUPABASE_SERVICE_ROLE_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` solo viven en `process.env` del backend. Nunca en frontend.
2. **Rol via backend:** El frontend NO puede auto-asignarse roles. Siempre pasa por `POST /api/auth/set-role` que valida contra `ROLES_AUTOREGISTRO`.
3. **Anti-colisión:** La query de aceptar pedido condiciona `.is('cadete_id', null)` para evitar que dos cadetes tomen el mismo pedido.
4. **Tarifa inmutable:** `distancia_estimada` y `pago_cadete` se copian desde `ofertas_cadetes` al momento de aceptar. El frontend del cadete los lee pero no los puede modificar.
5. **Códigos CSPRNG:** `crypto.randomInt(0, 10000)` — no predecibles, validados con `crypto.timingSafeEqual`.
6. **HMAC webhook:** El webhook de MercadoPago verifica la firma HMAC-SHA256 antes de procesar cualquier pago.
7. **CORS allowlist:** Solo los orígenes definidos en `FRONTEND_URL` pueden hacer requests al backend.

---

## Tabla `perfiles` — aviso importante

La tabla `perfiles` tiene dos columnas UUID:
- `id` → UUID random (PK). **NO es el auth.users.id.**
- `usuario_id` → FK a `auth.users(id)`. **Este es el que hay que usar para filtrar.**

En cualquier query que filtre perfiles por el usuario logueado, usar:
```javascript
.from('perfiles').eq('usuario_id', req.user.id)   // CORRECTO
.from('perfiles').eq('id', req.user.id)            // MAL — solo funciona para usuarios viejos
```

---

## Variables de entorno

### Backend (`backend/.env`)

```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...          # Dashboard → Settings → API → service_role
MP_ACCESS_TOKEN=APP_USR-...               # MercadoPago → Credenciales
MP_WEBHOOK_SECRET=...                     # MercadoPago → Webhooks → Clave secreta
FRONTEND_URL=https://tuapp.vercel.app     # Acepta varios separados por coma
SERVER_URL=https://api.tuapp.com          # URL pública del backend
PORT=3000
```

### Frontend (`frontend/env.js`)

```javascript
window.SUPABASE_URL      = 'https://xxxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJ...';     // Dashboard → Settings → API → anon (pública)
window.BACKEND_URL       = 'https://api.tuapp.com';
```

---

## Setup local

```bash
# 1. Backend
cd backend
cp .env.example .env              # Completar con credenciales reales
npm install
npm start                         # http://localhost:3000

# 2. Frontend
cd frontend
cp env.js.template env.js         # Completar: SUPABASE_URL, ANON_KEY, BACKEND_URL
# Servir con cualquier server estático:
npx serve -l 8000                 # o python -m http.server 8000

# 3. Base de datos
# Ir a Supabase Dashboard → SQL Editor → pegar schema-definitivo-v2.sql → Run
```

## Setup Supabase (manual en Dashboard)

1. **Auth → Providers → Google** — activar con Client ID/Secret de Google Cloud
2. **Database → Replication** — activar Realtime para: `ofertas_cadetes`, `pedidos`, `ubicacion_cadetes`, `mensajes_pedido`
3. **Storage** — crear bucket `cadetes-antecedentes` (privado) y `productos` (público)
4. **Comercios** — cargar `lat`/`lng` en al menos 1 comercio para que funcione el matching

## Deploy producción

| Servicio | Plataforma | Root Directory | Start/Build |
|----------|-----------|----------------|-------------|
| Backend | Railway | `backend/` | `npm start` |
| Frontend | Vercel | `frontend/` | Sin build (HTML estático), output: `.` |
| DB | Supabase | — | Correr SQL en Dashboard |

Después del deploy, actualizar:
- `FRONTEND_URL` en Railway con la URL de Vercel
- `BACKEND_URL` en `frontend/env.js` con la URL de Railway
