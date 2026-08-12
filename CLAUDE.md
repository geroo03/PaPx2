# CLAUDE.md — Puerta a Puerta X

> Documento de contexto para IAs. Leer antes de cualquier tarea. Última actualización: 2026-08-11.

---

## 1. Qué es el proyecto

App de delivery local, Argentina. Conecta clientes con comercios locales y cadetes (repartidores). Moneda: pesos argentinos (ARS). Lanzamiento en 3 ciudades: Santiago del Estero (plaza original), La Plata y Córdoba. `comercios.ciudad` es texto libre a propósito (no un enum), para no bloquear la expansión a más ciudades sin migración.

**Roles:**
| Rol | Descripción |
|-----|-------------|
| `cliente` | Hace pedidos desde la app web/nativa |
| `comercio` | Gestiona productos, acepta pedidos, busca cadetes |
| `cadete` | Recibe ofertas de entrega, actualiza GPS, confirma retiro/entrega |
| `embajador` | Capta comercios, cobra comisiones automáticas |
| `admin` | Acceso total, aprueba comercios, gestiona cadetes |

---

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Frontend | HTML + CSS + JS vanilla (sin framework). ES Modules. |
| Backend | Node.js 22 + Express 5. `"type": "module"` (ESM). Deployado en Railway. |
| Base de datos | Supabase (PostgreSQL 15 + Auth + Realtime + Storage) |
| Pagos | MercadoPago (preferencias + webhook HMAC) |
| Push notifications | Web Push / VAPID (web) · FCM vía Capacitor (nativo, pendiente Firebase) |
| App nativa | Capacitor 7 (configurado, APK pendiente de build) |
| CI/CD | GitHub → Railway (backend) y Vercel (frontend, `pa-px2.vercel.app`) auto-deploy en push a `main` |

**Hosting del frontend confirmado (2026-07-13):** Vercel, dominio `pa-px2.vercel.app` (hardcodeado en `frontend/qr.html`). Verificado en vivo: header `Server: Vercel` y el HTML servido es idéntico al de `frontend/index.html` en este repo — está conectado a este repo y se actualiza solo con `git push` a `main`. `vercel.json`/`_redirects` fueron eliminados (CHANGELOG v2.6.0) pero Vercel no los necesita para su preset "Other" (estático sin build), así que su ausencia no significa que se dejó de usar Vercel.

---

## 3. Estructura de archivos

```
puertaapuerta-main/
├── frontend/                  # App web estática (Capacitor webDir)
│   ├── index.html             # Redirige a /login.html
│   ├── login.html             # Login genérico (redirecciona según rol)
│   ├── env.js                 # window.SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_URL
│   ├── env.js.template        # Plantilla para clonar el repo
│   ├── manifest.json          # PWA manifest (icons: logo-192.png, logo-512.png)
│   ├── sw.js                  # Service Worker: recibe y muestra push notifications
│   ├── cliente/
│   │   ├── index.html         # App del cliente (SPA inline, guard de sesión embebido)
│   │   ├── login-usuario.html
│   │   ├── pago.html          # Resultado de pago MercadoPago
│   │   └── oauth-callback.html
│   ├── cadete/
│   │   ├── cadete.html        # Panel cadete (tabs: Viajes / Historial / Ganancias / Perfil)
│   │   ├── registro-cadete.html
│   │   └── oauth-callback-cadete.html
│   ├── comercio/
│   │   ├── comercio.html      # Panel comercio (tabs: Pedidos / Menú / Finanzas / etc.)
│   │   ├── registro-comercio.html  # Lee ?ref=<embajador_id> → creado_por_embajador_id
│   │   └── login.html
│   ├── embajador/
│   │   └── dashboard.html     # Dashboard: billetera, comisiones, link de referidos
│   ├── admin/
│   │   ├── admin.html
│   │   ├── admin-acceso.html
│   │   └── crear-embajador.html
│   ├── assets/
│   │   ├── css/               # index.css, cadete.css, comercio.css, embajador.css, ...
│   │   ├── img/
│   │   │   ├── logo-original.png   # Logo fuente 1024x1024 (PNG original)
│   │   │   └── android-icons/      # Íconos Android (mdpi→xxxhdpi + playstore)
│   │   └── js/
│   │       ├── config.js      # Shim: exporta `supabase` desde window.sb (UMD)
│   │       ├── main.js        # Init global: state, push, helpers
│   │       ├── cliente.js     # Lógica completa del cliente (~990 líneas)
│   │       ├── cadete.js      # Lógica completa del cadete (~1840 líneas)
│   │       ├── comercio.js    # Lógica completa del comercio (~1354 líneas)
│   │       ├── embajador.js   # Dashboard embajador + link de referidos
│   │       ├── push.js        # Push: web (VAPID) + nativa (Capacitor FCM)
│   │       ├── state.js       # Estado global (LocalStorage persistence)
│   │       ├── ui.js          # sanitizeHTML, formatARS, navigateSeguro
│   │       └── icons.js       # Objeto ICONS con emojis/SVG
│   ├── logo-192.png           # Ícono PWA 192x192 (referenciado en manifest.json)
│   └── logo-512.png           # Ícono PWA 512x512 (referenciado en manifest.json)
│
├── backend/
│   ├── src/
│   │   ├── server.js          # Express entry point. CORS incluye capacitor://localhost
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── pedidoRoutes.js
│   │   │   ├── cadeteRoutes.js
│   │   │   ├── embajadorRoutes.js
│   │   │   └── mpRoutes.js
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── pedidoController.js   # Pricing, ejecutarDifusion/difundir, aceptar, aceptar-comercio, rechazar-oferta, cambiar-estado
│   │   │   ├── cadeteController.js   # GPS, efectivo, liquidaciones
│   │   │   ├── embajadorController.js # Dashboard, comercios, retiros, comisiones
│   │   │   ├── mpController.js       # MercadoPago preferencias + webhook
│   │   │   └── pushController.js     # Web Push VAPID
│   │   ├── jobs/
│   │   │   ├── matchingScheduler.js  # setInterval 15s: despacho diferido + re-difusión automática + expira ofertas + refresco de clima (15min)
│   │   │   └── horariosScheduler.js  # setInterval 60s: abierto_ahora automático según horario configurado
│   │   ├── middlewares/
│   │   │   └── authMiddleware.js     # requireAuth (Bearer JWT) + requireAdmin
│   │   └── lib/
│   │       ├── supabaseClient.js     # Exporta `supabase` (anon) y `supabaseAdmin` (service_role)
│   │       ├── roleUtils.js          # resolveRol(userId) → string
│   │       ├── comisionUtils.js      # calcularComision(fechaInicio, monto) → {tasa, monto}
│   │       ├── tarifaUtils.js        # calcularTarifa(vehiculo, distanciaKm, climaAplicado) → ganancia
│   │       ├── matchingUtils.js      # haversineKm + rankearCandidatos(candidatos, config) — fairness/rotación
│   │       ├── climaUtils.js         # esClimaAdverso(weatherCode) — clasificación pura, testeable
│   │       └── climaService.js       # esClimaAdversoParaUbicacion(lat,lng) cache-first + refrescarCacheClima()
│   ├── test/                         # node:test — matchingUtils, climaUtils, tarifaUtils, comisionUtils, codigoUtils
│   ├── scripts/qa-e2e.mjs            # Smoke test E2E contra producción real (sin service_role) — correr antes de cada release
│   └── package.json                  # "type":"module", Express 5, Supabase JS, web-push
│
├── supabase/
│   ├── README-database.md     # Documentación completa del schema (LEER PRIMERO)
│   ├── schema-definitivo-v2.sql
│   ├── fix-criticos-importantes.sql  # Parche de bugs críticos (ya aplicado)
│   └── migrations/            # Migraciones incrementales (todas aditivas/idempotentes, todas aplicadas)
│       ├── migration-tarifa-clima.sql
│       ├── migration-fix-resenas-cadete-fk.sql
│       ├── migration-fix-recursion-perfiles-comercios-v2.sql / -v3.sql  # public.rol_actual() — ver §7
│       ├── migration-recargo-plataforma-20.sql        # 15%→20%, 2026-07-20
│       ├── migration-tiempo-preparacion-pedidos.sql    # pedidos: tiempo_preparacion_min, listo_estimado_at, etc.
│       ├── migration-config-zonas-matching.sql         # tabla configuracion_zonas (tuning por ciudad, sin redeploy)
│       ├── migration-cadetes-fairness-rotacion.sql     # cadetes.ultima_asignacion_at
│       ├── migration-ofertas-cadetes-campos-matching.sql
│       ├── migration-clima-cache.sql                   # tabla clima_cache (grid geográfico)
│       ├── migration-comercios-pausa-manual.sql        # comercios.pausado_manual/pausado_desde
│       ├── migration-pedidos-bloquear-comercio-cerrado.sql  # RLS restrictiva: no se puede pedir a un comercio cerrado
│       └── migration-cierres-especiales.sql            # tabla cierres_especiales (saveCierre) — 2026-08-11, pendiente correr en Supabase
│
├── docs/
│   └── ANDROID-BUILD.md       # Guía paso a paso para el builder con Android Studio
├── package.json               # Raíz: dependencias Capacitor 7
├── capacitor.config.json      # appId: com.puertaapuertax.app, webDir: frontend
├── CHANGELOG.md               # Historial de cambios por versión
└── .gitignore                 # Excluye android/, ios/, node_modules/, *.keystore
```

---

## 4. Variables de entorno

### Backend (`backend/.env`)
```
SUPABASE_URL=https://[proyecto].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # Nunca al frontend
MP_ACCESS_TOKEN=APP_USR-...        # MercadoPago producción
MP_WEBHOOK_SECRET=...              # Firma HMAC del webhook
FRONTEND_URL=https://tu-dominio.com,https://otro-dominio.com
SERVER_URL=https://tu-backend.railway.app
VAPID_PUBLIC_KEY=...                # Configurado en Railway (2026-08-11)
VAPID_PRIVATE_KEY=...               # Configurado en Railway (2026-08-11)
VAPID_EMAIL=mailto:puertaapuertax@gmail.com
PORT=3000
```

### Frontend (`frontend/env.js`)
```js
window.SUPABASE_URL      = '...'
window.SUPABASE_ANON_KEY = '...'   // Solo ANON key. Nunca SERVICE_ROLE.
window.BACKEND_URL       = 'https://tu-backend.railway.app'
window.VAPID_PUBLIC_KEY  = ''      // Solo web push. Opcional.
```

---

## 5. API del backend — endpoints completos

### Auth `/api/auth`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/register` | Público | Crea usuario (roles: cliente/comercio/cadete). Bypasea confirmación email. |
| POST | `/set-role` | JWT | El usuario asigna su propio rol post-registro. No permite admin/embajador. |
| POST | `/admin/crear-usuario` | Admin | Admin crea cualquier rol incluyendo embajador. |

### Pedidos `/api/pedidos`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/aceptar-comercio` | JWT | Comercio acepta pedido nuevo y declara `tiempoPreparacionMin` (3–90, reloj del servidor). Ya NO difunde inline — eso lo decide `matchingScheduler.js`. |
| POST | `/aceptar` | JWT | Cadete acepta oferta. Anti-colisión: UPDATE WHERE cadete_id IS NULL. Transiciona `ofertas_cadetes.estado` a aceptada/rechazada y actualiza `cadetes.ultima_asignacion_at`. |
| POST | `/rechazar-oferta` | JWT | Cadete rechaza una oferta explícitamente (botón o timeout 20s) — persiste en DB, ya no es 100% client-side. |
| POST | `/cambiar-estado` | JWT | Cadete actualiza estado (preparado→en_camino→entregado). Valida PIN. |
| PATCH | `/:id/productos` | JWT | Comercio edita productos/cantidades de un pedido propio antes de que el cadete retire (`nuevo`/`preparando`/`listo`/`en_preparacion`). Bloqueado si pagó con MercadoPago. |
| POST | `/difundir` | JWT | Botón manual "Buscar cadete" del comercio — wrapper fino sobre `ejecutarDifusion()` (misma lógica que usa el scheduler automático: ranking por distancia/rating/rotación, clima por zona). |
| POST | `/valorar` | JWT | Cliente valora comercio y cadete. Actualiza rating promedio. |
| POST | `/notificar-comercio` | JWT | Push al comercio cuando llega pedido nuevo. |
| POST | `/no-show` | JWT | Cadete reporta que el cliente no estaba. |
| GET | `/:id` | JWT | Lee pedido + perfil del cadete asignado. Visibilidad controlada. |

> El despacho de cadetes ya NO depende solo de este endpoint manual: `backend/src/jobs/matchingScheduler.js` corre dentro del mismo proceso Node (setInterval 15s) y llama a la misma función `ejecutarDifusion()` para: despacho inicial diferido según `listo_estimado_at - anticipacion_difusion_min`, re-difusión automática si nadie acepta (ensancha el radio una vez antes de rendirse y avisarle al comercio por push), y expiración de ofertas vencidas. Parámetros de tuning (radio, timeout, pesos de ranking, etc.) viven en la tabla `configuracion_zonas`, ajustables por SQL sin redeploy — ver §6 y §7.

### Cadete `/api/cadete`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/actualizar-ubicacion` | JWT | UPSERT en ubicacion_cadetes. Body: {lat, lng, pedido_id?}. |
| GET | `/efectivo` | JWT | Deuda en efectivo + liquidaciones recientes. |
| POST | `/solicitar-liquidacion` | JWT | Cadete solicita liquidar su deuda en efectivo. |
| POST | `/validar-referido` | JWT | Valida código de referido al registrarse. |
| PATCH | `/liquidacion/:id/confirmar` | Admin | Confirma liquidación. |
| PATCH | `/liquidacion/:id/rechazar` | Admin | Rechaza liquidación. |
| PATCH | `/:id/efectivo` | Admin | Admin ajusta deuda de efectivo de un cadete. |
| GET | `/admin/lista` | Admin | Lista todos los cadetes. |

### Embajador `/api/embajadores`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/dashboard` | JWT | Billetera + comisiones + patrocinios + retiros en una llamada. |
| POST | `/comercios` | JWT | Embajador registra comercio manualmente. |
| POST | `/solicitar-retiro` | JWT | Embajador solicita retiro de saldo. |
| PATCH | `/retiro/:id/pagar` | JWT | Admin/Embajador confirma pago de retiro. |
| PATCH | `/retiro/:id/rechazar` | JWT | Admin rechaza retiro. |

### MercadoPago `/api/mp`
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/crear-preferencia` | JWT | Crea preferencia de pago. Retorna init_point. |
| POST | `/webhook` | Público | Recibe notificación MP. Verifica HMAC. Crea pedido si pago aprobado. |

> ⚠️ **Alerta para IA:** MercadoPago es la pasarela de pago actual e integrada, pero se está **evaluando migrar a Payway** (pasarela de pagos argentina) como alternativa. Todavía no es una decisión firme. No asumir que MercadoPago es definitivo, no proponer ni empezar una migración de pasarela por cuenta propia — confirmar con el usuario primero si el trabajo pedido toca esta área.
>
> También hay una Edge Function `supabase/functions/mp-webhook/index.ts` en el repo que **no parece estar en uso**: `mpController.js` configura `notification_url` apuntando al propio backend (`/api/mp/webhook`), no a la Edge Function, y esta no fue tocada desde la modularización inicial. Antes de tocarla o borrarla, confirmar con el usuario si sigue siendo necesaria (podría ser un remanente de un diseño anterior).

### Diagnóstico
| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| GET | `/health` | Público | Retorna {ok, cors, env, timestamp}. Sin datos sensibles. |

---

## 6. Lógica de negocio crítica

### Precios de delivery (pedidoController.js)
```
TARIFA_BASE = { moto: 1800, bici: 1200 }   // ARS
TARIFA_POR_KM = 750                          // ARS por km
RECARGO_PLATAFORMA = 20%                     // Se suma al precio del comercio → lo paga el cliente

gananciaBase = round((tarifa_base + distancia_entrega_km × 750) / 50) × 50
ganancia = tarifa_clima ? round((gananciaBase × 1.20) / 50) × 50 : gananciaBase

// distancia_entrega = Haversine(comercio.lat, comercio.lng, pedido.lat_entrega, pedido.lng_entrega)
// distancia_proximidad = Haversine(cadete.lat, cadete.lng, comercio.lat, comercio.lng) — solo para mostrar
```

### Comisiones embajador (comisionUtils.js)
```
Mes 1–6:   5% del total_final del pedido
Mes 7–12:  2% del total_final
Mes 13+:   0% (sin comisión)
```

### Comisiones referidos cadete
```
2% del pago_cadete por cada viaje del referido (máximo 50 viajes)
```

### Anti-colisión aceptar pedido
```sql
-- Se ejecuta como UPDATE con condición WHERE cadete_id IS NULL
-- Si otro cadete ya lo aceptó, no actualiza ninguna fila → el frontend recibe {ok:false}
UPDATE pedidos SET cadete_id=?, codigo_retiro=?, codigo_entrega=?
WHERE id=? AND cadete_id IS NULL
```

### Tarifa clima (+20%) — manual + automática
- Override manual: el cadete activa un toggle en su app → se guarda `cadetes.tarifa_clima = true`.
- Detección automática (2026-07-30): `climaService.esClimaAdversoParaUbicacion(lat,lng)` consulta wttr.in con caché geográfica en `clima_cache` (grilla de ~11km, TTL 20min) — se calcula UNA VEZ por tanda de difusión (no por cadete), a partir de la ubicación del comercio.
- `climaAplicado = climaAdversoDetectado || cadete.tarifa_clima` — el toggle manual es un OR, no lo reemplaza.
- `ejecutarDifusion()`/`calcularTarifa()` multiplican la `ganancia` por 1.20 (redondeado a $50) cuando `climaAplicado`.
- El cliente NO ve el recargo; el aumento va íntegro al cadete.

### Recargo plataforma (20%)
- Se aplica en el frontend del cliente al mostrar precios: `precio_mostrado = precio_comercio × 1.20`
- El comercio recibe el 100% de su precio definido
- La diferencia (20%) es la comisión de la plataforma
- Subido del 15% al 20% el 2026-07-20 (`migration-recargo-plataforma-20.sql`) — decisión de negocio del usuario, no retroactivo

### Matching automático de cadetes (2026-07-30)
- `matchingUtils.rankearCandidatos(candidatos, config)` combina distancia, rating y rotación/fairness (horas desde `cadetes.ultima_asignacion_at`, tope 4hs, cadete nunca asignado recibe el bonus máximo) en un único score ponderado — reemplaza el sort puro por distancia de antes.
- Pesos y demás parámetros (radio, radio ampliado, timeout de oferta, intentos de re-difusión, anticipación de despacho) viven en `configuracion_zonas`, con fallback global si la `comercios.ciudad` (texto libre, normalizado sin tildes) no matchea ninguna fila específica — ajustable por `UPDATE` en Supabase, sin redeploy.
- Si nadie acepta tras `redifusion_max_intentos`, se reintenta UNA vez con `radio_ampliado_km` antes de marcar `pedidos.difusion_agotada=true` y avisarle al comercio por push.

### Tiempo de preparación (2026-07-30)
- El comercio declara `tiempoPreparacionMin` (3–90) al aceptar (`POST /api/pedidos/aceptar-comercio`) → `pedidos.listo_estimado_at = now() + minutos` (reloj del servidor).
- `matchingScheduler.js` despacha cadetes recién cuando `ahora >= listo_estimado_at - anticipacion_difusion_min` (default 8 min) — antes se avisaba siempre inmediatamente al aceptar, sin relación con cuánto tardaba la comida.

### Horarios automáticos de comercios (2026-07-31)
- El comercio configura `horario_apertura`/`horario_cierre`/`dias_abierto` (UI ya existía, nada la leía antes). `horariosScheduler.js` (tick 60s) calcula `comercios.abierto_ahora` automáticamente a partir de eso. Comercios sin horario configurado quedan 100% manual, sin regresión.
- El switch manual pasa a ser una pausa temporal (`pausado_manual`/`pausado_desde`) cuando hay horario configurado: cierra al instante, se limpia sola en la próxima apertura programada.
- No soportado (a propósito, ver el job): horarios que cruzan medianoche (`horario_cierre <= horario_apertura`).
- Un comercio "cerrado" bloquea de verdad la creación de pedidos: policy RLS **restrictiva** en `pedidos` (`pedidos_bloquear_comercio_cerrado`) exige `comercios.abierto_ahora=true` (u admin) para el INSERT — antes solo era un bloqueo cosmético del botón en el cliente.
- **Cierres especiales por fecha (2026-08-11):** el comercio puede cargar días puntuales (feriado, vacaciones) desde el panel (Horarios → "Agregar cierre especial"), tabla `cierres_especiales` (`comercio_id`, `fecha`, `motivo` opcional). `horariosScheduler.js` fuerza `abierto_ahora=false` cuando hay una fila con `fecha = hoy` para ese comercio — mismo alcance que `pausado_manual`: solo aplica a comercios con horario configurado, y se autolimpia solo (el chequeo es siempre contra la fecha de hoy, no queda ningún flag que revertir al otro día).

---

## 7. Base de datos — convenciones críticas

> **Leer `supabase/README-database.md` para el schema completo.**

### Relaciones de auth UID (IMPORTANTE)
```
perfiles.usuario_id  → auth.users.id   // FK real. perfiles.id es UUID random distinto.
cadetes.auth_uid     → auth.users.id   // FK real.
comercios.usuario_id → auth.users.id   // FK real.
```

### Problema de tipos (RLS) — en vías de resolución
`advertencias_comercio.comercio_id` y `chat_reportes.comercio_id` eran
`text`, no `uuid` (`reportes.comercio_id` sí es `uuid` — se corrigió en
`fix-criticos-importantes.sql`, no confundir con las otras dos).
Migración escrita el 2026-08-11
(`supabase/migrations/migration-comercio-id-uuid.sql`), **pendiente de
correr en Supabase** — hasta que se corra, seguir tratando ambas columnas
como potencialmente `text` en cualquier policy RLS nueva:
```sql
auth.uid()::text = comercio_id
-- o, comparando contra otra tabla:
c.id::text = comercio_id
```
Una vez corrida la migración, el cast ya no hace falta (aunque dejarlo no
rompe nada — comparar `uuid::text = uuid::text` sigue funcionando).

### RLS — usar siempre `public.rol_actual()`, nunca subqueries inline
`public.rol_actual()` (`SECURITY DEFINER`, `LANGUAGE plpgsql`, no `sql` — el planner
puede inlinear funciones SQL y anular el bypass de RLS) reemplaza cualquier
`(SELECT rol FROM perfiles WHERE usuario_id = auth.uid())` inline dentro de una
policy. Una versión anterior con subqueries crudas causó una recursión infinita
real en producción (`infinite recursion detected in policy`, 42P17) — ver
CHANGELOG v3.3.0. Toda policy nueva desde entonces (incluida
`pedidos_bloquear_comercio_cerrado`) usa `rol_actual()`.

Para tablas `configuracion_zonas`/`clima_cache` (solo backend/admin, ningún
acceso directo desde cliente/comercio/cadete): policy `FOR ALL USING
(rol_actual() = 'admin')`.

### Tablas con Realtime habilitado en Supabase Dashboard
- `ofertas_cadetes` — cadete recibe nuevas ofertas en tiempo real
- `ubicacion_cadetes` — cliente ve el mapa del cadete en tiempo real
- `mensajes_pedido` — chat en tiempo real entre cliente/comercio/cadete

### Tablas nuevas (2026-07-30/31)
- `configuracion_zonas` — parámetros de matching/tuning por ciudad (o fila `NULL` = fallback global): radio_km, radio_ampliado_km, max_ofertas, oferta_timeout_seg, redifusion_intervalo_seg, redifusion_max_intentos, anticipacion_difusion_min, pesos de ranking. Se edita por SQL directo, no hay pantalla de admin.
- `clima_cache` — caché de clima por grilla geográfica (`grid_lat`,`grid_lng` redondeados a 1 decimal), usada por `climaService.js`.

### Tabla nueva (2026-08-11)
- `cierres_especiales` — días puntuales en los que un comercio no abre (feriado, vacaciones), una fila por fecha. `comercio_id`, `fecha`, `motivo` opcional. `horariosScheduler.js` la consulta cada tick para forzar `abierto_ahora=false` el día que corresponda — ver §6. **Pendiente de correr en Supabase** (`migration-cierres-especiales.sql`) antes de pushear el código que la usa.

### Migraciones — estado
Todas las migraciones aplicadas hasta el 2026-07-31 (ver lista completa en §3),
salvo `migration-cierres-especiales.sql` (2026-08-11, todavía sin correr en
Supabase — ver arriba). Todas siguen la convención `ADD COLUMN IF NOT EXISTS`
/ `DROP POLICY IF EXISTS` + `CREATE POLICY` — aditivas e idempotentes,
seguras de re-correr.

---

## 8. Flujo de pedido completo

```
1. Cliente agrega productos al carrito → confirmarPedido()
   - Captura lat_entrega/lng_entrega del pin del mapa
   - Bloqueado a nivel de datos si el comercio está cerrado: RLS restrictiva
     pedidos_bloquear_comercio_cerrado exige comercios.abierto_ahora=true
     (u admin) para el INSERT — no es solo un botón deshabilitado en la UI.
   - Inserta en `pedidos` (estado='nuevo', estado_pago='pendiente')
   - Si MercadoPago: POST /api/mp/crear-preferencia → redirige a MP
   - Si efectivo: pedido ya confirmado

2. Webhook MP / confirmación efectivo → pedido.estado_pago = 'aprobado'

3. Comercio ve el pedido en su panel (Realtime en pedidos)
   - Acepta declarando tiempo de preparación → POST /api/pedidos/aceptar-comercio
     {tiempoPreparacionMin: 3-90} → estado='preparando',
     listo_estimado_at = now() + minutos (reloj del servidor)
   - Ya NO difunde inline. matchingScheduler.js (setInterval 15s) despacha
     cadetes automáticamente cuando ahora >= listo_estimado_at -
     anticipacion_difusion_min (default 8 min) — llama a ejecutarDifusion():
     * rankearCandidatos() combina distancia + rating + rotación/fairness
       (matchingUtils.js), no solo distancia pura
     * Detecta clima adverso una vez por tanda (climaService.js, wttr.in +
       caché) y aplica +20% si corresponde (OR con el toggle manual del cadete)
     * Inserta en `ofertas_cadetes` (Realtime notifica al cadete) + push
     * Si nadie acepta: re-difusión automática (hasta 5 intentos), ensancha
       el radio una vez antes de rendirse y avisarle al comercio por push
   - El comercio también puede seguir usando "Buscar cadete" a mano
     (POST /api/pedidos/difundir) — misma lógica de ejecutarDifusion()

4. Cadete ve la oferta → acepta → POST /api/pedidos/aceptar
   - Anti-colisión: UPDATE WHERE cadete_id IS NULL
   - Genera codigo_retiro y codigo_entrega (CSPRNG 4 dígitos)
   - Congela ganancia_estimada en ofertas_cadetes
   - Transiciona ofertas_cadetes.estado a 'aceptada' (la ganadora) y
     'rechazada' (las demás pendientes del mismo pedido)
   - Actualiza cadetes.ultima_asignacion_at (alimenta el ranking de rotación)
   - El cadete también puede rechazar una oferta explícitamente antes de
     aceptar (POST /api/pedidos/rechazar-oferta, botón o timeout de 20s)

5. Cadete va al comercio → comercio muestra codigo_retiro
   - Cadete ingresa el código → POST /api/pedidos/cambiar-estado {estado:'en_camino'}
   - Estado → 'en_camino'

6. Cadete actualiza GPS cada 5-10 seg → POST /api/cadete/actualizar-ubicacion
   - UPSERT en ubicacion_cadetes
   - Supabase Realtime propaga al cliente (mapa en vivo)

7. Cadete llega al cliente → cliente muestra codigo_entrega
   - Cadete ingresa el código → POST /api/pedidos/cambiar-estado {estado:'entregado'}
   - Trigger: acredita comisión al embajador (si aplica)
   - Trigger: acredita comisión al cadete referente (si aplica)
   - Trigger: si metodo_pago='efectivo' → marca cobrado_efectivo=true y acumula
     el 20% (monto_comision_app) como deuda en **comercios.deuda**. Confirmado
     con el usuario que este es el comportamiento correcto — el
     comercio le debe a la plataforma su comisión cuando el cobro fue en
     efectivo y no pasó por MercadoPago. `cadetes.deuda_efectivo` es un campo
     distinto, no relacionado a este trigger. CHANGELOG.md (v2.5.0) describe
     una versión más vieja de este feature donde la deuda iba al cadete; quedó
     desactualizado, el trigger actual (comercios.deuda) es la fuente de verdad.

8. Cliente califica → POST /api/pedidos/valorar
   - Actualiza rating de comercio y cadete
```

**Nota:** el comercio puede editar los productos del pedido (cantidad o
quitar un ítem) en cualquier momento antes de que el cadete retire —
`PATCH /api/pedidos/:id/productos` — salvo que el pago haya sido con
MercadoPago (ya se cobró el total viejo). El cliente y el cadete se enteran
en vivo por Realtime, con un toast.

---

## 9. Supabase — clientes en el frontend

El frontend usa el bundle UMD de Supabase cargado desde CDN:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
```
`window.sb = window.supabase.createClient(URL, KEY)` se inicializa en el guard de sesión de cada HTML.

`assets/js/config.js` exporta `supabase` que es un alias de `window.sb`. Los módulos ES importan desde config.js.

**El backend usa dos clientes:**
- `supabase` (anon key) → solo para validar JWTs en authMiddleware
- `supabaseAdmin` (service_role) → todos los controllers. Bypasea RLS.

### Edge Function `asistente` (chat IA — no vive en este repo)
`cliente.js` (`enviarAsistente()`) y `cadete.js` llaman directo a una Edge Function de Supabase alojada en `https://fmqlpgerqdiplnvjjarl.supabase.co/functions/v1/asistente` con `Authorization: Bearer <ANON_KEY>` y body `{ messages, rol }`. Esta función **no está en `supabase/functions/`** de este repo — solo existe en el Dashboard de Supabase del proyecto. No hay documentación de qué modelo/prompt usa. Si se necesita modificar este asistente, hay que pedirle el código/config al usuario o acceder al Dashboard directamente; no asumir su comportamiento a partir del frontend.

---

## 10. Autenticación — flujo

1. Usuario se registra en `registro-cadete.html` o `registro-comercio.html`
2. Frontend llama `POST /api/auth/register` → backend crea user con `admin.createUser` (sin verificación de email)
3. Backend asigna rol en `user_metadata` y hace upsert en `perfiles`
4. Para cadetes: también hace upsert en `cadetes`
5. Frontend guarda el JWT en localStorage (`access_token`)
6. Cada llamada al backend incluye `Authorization: Bearer <token>`
7. `requireAuth` valida el JWT con `supabaseAdmin.auth.getUser(token)`
8. `requireAdmin` además verifica `perfiles.rol = 'admin'`

**Para asignar rol embajador:** Solo el admin puede hacerlo desde `/admin/crear-embajador.html` → `POST /api/auth/admin/crear-usuario`

---

## 11. Push notifications

### Web (actual)
- Service Worker en `frontend/sw.js` — escucha evento `push` y muestra notificación
- `frontend/assets/js/push.js` → `registrarPush()` — registra la suscripción VAPID
- Backend: `pushController.js` → usa `web-push` npm package
- VAPID keys configuradas en Railway y alineadas con `frontend/env.js` desde el 2026-08-11 — push web funcional en producción

### Nativa Android (Capacitor — pendiente Firebase)
- `push.js` detecta `window.Capacitor.isNativePlatform()` → usa `@capacitor/push-notifications`
- Requiere: proyecto Firebase + `google-services.json` en `android/app/`
- El `pushController.js` actual envía VAPID (web push). Para nativo necesita FCM API v1.

---

## 12. Capacitor (app nativa Android/iOS)

**Estado actual — Android:** `android/` generado y sincronizado con el
código (ver `docs/ANDROID-BUILD.md`). Keystore de release ya generado.

**Estado actual — iOS (2026-08-11):** `@capacitor/ios` agregado a
`package.json`. `ios/` se generó una vez desde Windows (`npx cap add
ios`) pero **sin `pod install` real** (CocoaPods no corre en Windows) —
no se puede abrir en Xcode todavía, hace falta la Mac. Como `ios/` está
en `.gitignore` (mismo criterio que `android/`, evita ~200MB en el repo),
es probable que se regenere de cero ahí — ver `docs/IOS-BUILD.md` para
los 3 ajustes manuales que hay que reaplicar después de `cap add ios`
(permisos de cámara/ubicación, deep link de Google OAuth, push
notifications) y qué falta del ícono (no hay una fuente cuadrada de
1024×1024 en el repo todavía, ver ese doc).

```json
// capacitor.config.json — mismo config para ambas plataformas, sin bloque "ios" propio
{
  "appId": "com.puertaapuertax.app",
  "appName": "Puerta a Puerta X",
  "webDir": "frontend",
  "server": { "androidScheme": "https" }
}
```

**Para buildear el APK (Android, cualquier SO):**
```bash
npm install                  # instala Capacitor 7
npx cap add android          # genera android/ (~200MB, excluido de git)
npx cap sync android         # copia frontend/ al proyecto Android
npx cap open android         # abre Android Studio
# En Android Studio: Build → Build APK(s)
```
Detalle completo, incluido el deep link de Google OAuth y Firebase:
`docs/ANDROID-BUILD.md`.

**Para buildear iOS (requiere Mac + Xcode + CocoaPods):**
```bash
npm install
npx cap add ios               # genera ios/App, corre pod install (en Mac)
npx cap sync ios
npx cap open ios              # abre Xcode
```
Detalle completo, incluidos los 3 ajustes manuales de Info.plist:
`docs/IOS-BUILD.md`.

**Íconos listos (Android):** `frontend/assets/img/android-icons/ic_launcher_[mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi].png`

**Migraciones pendientes post-capacitor:**
- Firebase / FCM para push nativas, Android e iOS (ninguna migración de Supabase pendiente)

---

## 13. Pendientes conocidos (por orden de impacto)

| # | Tarea | Impacto |
|---|-------|---------|
| 1 | Crear cuenta de desarrollador de Google Play Console ($25) — **todavía no existe**. Google exige a cuentas nuevas un track de Closed Testing (~20 testers, 14 días corridos) antes de habilitar Production — es el ítem de mayor lead time de todo el lanzamiento, arrancarlo antes que nada. | Distribución / fecha real de lanzamiento |
| 2 | Generar el `.aab` firmado en Android Studio (`docs/ANDROID-BUILD.md`) e instalarlo en un dispositivo real para probar a mano — `android/` ya existe, ya sincronizado (2026-07-31), keystore ya generado. Confirmar backup externo del keystore antes (irrecuperable si se pierde). En curso 2026-08-11: probado en un celular real, aparecieron bugs de CSS pendientes de detalle. | App nativa |
| 3 | Diseñar el "feature graphic" 1024×500 para la ficha de Play Store (único asset gráfico que falta — el ícono 512×512 ya existe) | Ficha de Play Store |
| 4 | Payway vs. MercadoPago — a cargo de Fabri, no tocar sin que él avance | Pagos |
| 5 | Encontrar y deshabilitar la `GMAPS_KEY` vieja (`AIzaSyASBhagsg9K...`) — vive en algún otro proyecto de Google Cloud (no en "Puerta a Puerta X"), nunca tuvo restricciones. La app ya no la usa (rotada 2026-08-11), no es urgente, pero sigue técnicamente viva. | Seguridad, baja prioridad |

**Explícitamente en pausa (decisión ya tomada, no retomar sin que el usuario lo pida):** Firebase/FCM para push nativo, GPS en background para cadetes, y desbloquear "Crear Promociones" en el panel de comercio (`comercio.html`, hoy con `pointer-events:none` a propósito — el dato/UI de lectura de promociones existe pero la creación está deshabilitada, no es un bug). Los tres quedan para una fase 2 posterior al lanzamiento.

**iOS (Capacitor):** `@capacitor/ios` agregado y `ios/` generado una vez desde Windows (2026-08-11), pero sin `pod install` real (CocoaPods no corre en Windows) — no se puede compilar/abrir en Xcode todavía. Falta la Mac (prevista fines de agosto 2026) para terminarlo — ver §12 y `docs/IOS-BUILD.md`.

~~Horarios automáticos de comercios~~ — shippeado 2026-07-31, ver §6 y CHANGELOG v3.9.0.

~~Cargar VAPID en Railway~~ — resuelto 2026-08-11. Ya estaba cargado (par completo), el problema real era que `frontend/env.js` tenía la pública de otro par distinto (huérfana) — corregido para que coincida con el par de Railway.

~~Rotar `GMAPS_KEY`~~ — resuelto 2026-08-11. Key nueva creada y restringida (HTTP referrer `pa-px2.vercel.app/*` + Geocoding API) en el proyecto correcto de Google Cloud (la vieja vivía en otro proyecto, por eso no aparecía en "Puerta a Puerta X"). Encontrar y deshabilitar la vieja queda como ítem #5 de baja prioridad.

~~`advertencias_comercio.comercio_id`/`chat_reportes.comercio_id` migrar a `uuid`~~ — código listo 2026-08-11 (`migration-comercio-id-uuid.sql`), **pendiente de correr en Supabase**. De paso se simplificó la policy `advertencias_comercio_ver` (usa `es_dueno_de_comercio()` en vez de un `EXISTS` con cast `::text` inline) y se sacó un `String()` ya innecesario en `comercio.js`. Ver §7.

~~Duplicación de lógica entre archivos~~ — resuelto parcialmente 2026-08-11: sanitización HTML (5 implementaciones distintas, 2 con bugs reales — `comercio.js` no escapaba `'` y colapsaba `0`/`false` a `''` — consolidadas en `ui.js` → `sanitizeHTML()`), toggle de mostrar/ocultar contraseña (`ui.js` → `bindPasswordToggle()`), e inicialización de Supabase (nuevo `bootstrap-supabase.js`, saca la versión del SDK que `login-usuario.html` tenía fijada en `@2.43.4` mientras el resto usa `@2`). **El login se dejó a propósito sin tocar** — investigado y confirmado que las 3 implementaciones (`login.js`, `login-usuario.html`, `admin-acceso.js`) tienen diferencias de comportamiento intencionales (admin-acceso.js nunca consulta `perfiles` para el rol, por seguridad; login.js no auto-redirige con sesión activa por el fix anti-secuestro de sesión pero admin-acceso.js sí; login-usuario.html usa `localStorage` en vez de `sessionStorage`) — unificarlo de verdad requeriría tocar el modelo de seguridad del admin, decisión que no correspondía tomar en una tarea de limpieza.

~~`saveCierre()` no persistía nada~~ — shippeado 2026-08-11 (tabla `cierres_especiales` + wiring en `comercio.js`/`horariosScheduler.js`), ver CHANGELOG v3.13.0. Migración `migration-cierres-especiales.sql` pendiente de correr en Supabase antes de pushear.

~~`login-usuario.html` sin checkbox de TyC + bug de password en login~~ — shippeado 2026-08-11, ver CHANGELOG v3.13.0.

**Contexto de mercado (investigación 2026-07-31, ver memoria de sesión):** Uber Eats
relanzó en Argentina en enero 2026 eligiendo **Córdoba** (una de las 3 ciudades de
lanzamiento) como punto de partida — Córdoba y La Plata ya tienen Rappi+PedidosYa;
Santiago del Estero parece ser la plaza con menos presencia de los grandes players.
No hay pre-orders ni carrito grupal (confirmado ausentes, no es un bug).

---

## 14. Reglas de desarrollo

### SQL
- Siempre `ADD COLUMN` antes de `ADD CONSTRAINT` en el mismo `ALTER TABLE`
- Toda constraint nueva: envolver en `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$`
- `perfiles.usuario_id` es la FK a auth.users, NO `perfiles.id`

### Backend
- Controllers usan `supabaseAdmin` (service_role) para bypassear RLS
- `resolveRol(userId)` consulta `perfiles.rol` como fuente de verdad; user_metadata es fallback
- Siempre redondear tarifas a múltiplos de $50: `Math.round(monto / 50) * 50`

### Frontend
- `sanitize(str)` antes de cualquier interpolación en innerHTML
- `window.sb` es el cliente Supabase global (inicializado en el guard de sesión de cada HTML)
- Los módulos ES usan `import { supabase } from './config.js'` que es alias de `window.sb`
- **Toda página nueva** debe tener `viewport-fit=cover` en su `<meta viewport">` y linkear `frontend/assets/css/safe-area.css` **primero**, antes de su propio CSS — es el único stylesheet compartido por todas las familias (cliente/cadete/portal-comercio-admin/embajador) y expone `--safe-top`/`--safe-bottom`/`--safe-left`/`--safe-right` (fix de CSS cross-device 2026-08-11, ver CHANGELOG v3.15.0).
- Todo `input`/`select`/`textarea` nuevo: `font-size` mínimo **16px** — por debajo de eso, iOS hace zoom automático al enfocar el campo.
- Layouts a pantalla completa: `min-height:100vh; min-height:100dvh;` (el segundo pisa al primero en navegadores que soportan `dvh`, fallback gratis para los que no).

---

## 15. Storage buckets (Supabase)

| Bucket | Contenido |
|--------|-----------|
| `cadetes-antecedentes` | DNI, carnet de conducir, seguro del cadete |
| `comercios` | Imágenes de los comercios |
| `productos` | Imágenes de productos |

---

## 16. Comandos útiles

```bash
# Backend local
cd backend && npm run dev

# Ver logs Railway
railway logs

# Verificar que el backend está vivo
curl https://[backend-url]/health

# Generar VAPID keys (una sola vez)
cd backend && node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(JSON.stringify(k,null,2))"
```
