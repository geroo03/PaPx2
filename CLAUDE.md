# CLAUDE.md — Puerta a Puerta X

> Documento de contexto para IAs. Leer antes de cualquier tarea. Última actualización: 2026-07-11.

---

## 1. Qué es el proyecto

App de delivery local para Santiago del Estero, Argentina. Conecta clientes con comercios locales y cadetes (repartidores). Moneda: pesos argentinos (ARS).

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
| CI/CD | GitHub → Railway auto-deploy en push a `main` |

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
│   ├── logo-192.png           # Ícono PWA 192x192
│   ├── logo-512.png           # Ícono PWA 512x512
│   ├── android-icons/         # Íconos Android (mdpi→xxxhdpi + playstore)
│   └── puertaApuerta.png      # Logo original fuente (1024x1024 aprox)
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
│   │   │   ├── pedidoController.js   # Pricing, difundir, aceptar, cambiar-estado
│   │   │   ├── cadeteController.js   # GPS, efectivo, liquidaciones
│   │   │   ├── embajadorController.js # Dashboard, comercios, retiros, comisiones
│   │   │   ├── mpController.js       # MercadoPago preferencias + webhook
│   │   │   └── pushController.js     # Web Push VAPID
│   │   ├── middlewares/
│   │   │   └── authMiddleware.js     # requireAuth (Bearer JWT) + requireAdmin
│   │   └── lib/
│   │       ├── supabaseClient.js     # Exporta `supabase` (anon) y `supabaseAdmin` (service_role)
│   │       ├── roleUtils.js          # resolveRol(userId) → string
│   │       └── comisionUtils.js      # calcularComision(fechaInicio, monto) → {tasa, monto}
│   └── package.json                  # "type":"module", Express 5, Supabase JS, web-push
│
├── supabase/
│   ├── README-database.md     # Documentación completa de las 27 tablas (LEER PRIMERO)
│   ├── schema-definitivo-v2.sql
│   ├── fix-criticos-importantes.sql  # Parche de bugs críticos (ya aplicado)
│   ├── migration-lat-entrega-pedidos.sql  # lat_entrega/lng_entrega en pedidos (ya aplicado)
│   ├── migration-tarifa-clima.sql    # cadetes.tarifa_clima (PENDIENTE aplicar en Supabase)
│   └── [otras migraciones ya aplicadas]
│
├── package.json               # Raíz: dependencias Capacitor 7
├── capacitor.config.json      # appId: com.puertaapuertax.app, webDir: frontend
├── ANDROID-BUILD.md           # Guía paso a paso para el builder con Android Studio
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
VAPID_PUBLIC_KEY=...               # ⚠ NO configurado aún → push notifications rotas
VAPID_PRIVATE_KEY=...              # ⚠ NO configurado aún
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
| POST | `/aceptar` | JWT | Cadete acepta oferta. Anti-colisión: UPDATE WHERE cadete_id IS NULL. |
| POST | `/cambiar-estado` | JWT | Cadete actualiza estado (preparado→en_camino→entregado). Valida PIN. |
| POST | `/difundir` | JWT | Comercio busca cadetes. Calcula distancias Haversine. Inserta en ofertas_cadetes. |
| POST | `/valorar` | JWT | Cliente valora comercio y cadete. Actualiza rating promedio. |
| POST | `/notificar-comercio` | JWT | Push al comercio cuando llega pedido nuevo. |
| POST | `/no-show` | JWT | Cadete reporta que el cliente no estaba. |
| GET | `/:id` | JWT | Lee pedido + perfil del cadete asignado. Visibilidad controlada. |

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
RECARGO_PLATAFORMA = 15%                     // Se suma al precio del comercio → lo paga el cliente

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

### Tarifa clima (+20%)
- El cadete activa un toggle en su app → se guarda `cadetes.tarifa_clima = true`
- `difundirPedido` lee el flag y multiplica la `ganancia` por 1.20
- El cliente NO ve el recargo; el aumento va íntegro al cadete

### Recargo plataforma (15%)
- Se aplica en el frontend del cliente al mostrar precios: `precio_mostrado = precio_comercio × 1.15`
- El comercio recibe el 100% de su precio definido
- La diferencia (15%) es la comisión de la plataforma

---

## 7. Base de datos — convenciones críticas

> **Leer `supabase/README-database.md` para el schema completo de las 27 tablas.**

### Relaciones de auth UID (IMPORTANTE)
```
perfiles.usuario_id  → auth.users.id   // FK real. perfiles.id es UUID random distinto.
cadetes.auth_uid     → auth.users.id   // FK real.
comercios.usuario_id → auth.users.id   // FK real.
```

### Problema conocido de tipos (RLS)
`reportes.comercio_id` y `advertencias_comercio.comercio_id` son `text`, no `uuid`.
En políticas RLS que comparan con `auth.uid()` (que retorna `uuid`) se debe castear:
```sql
auth.uid()::text = comercio_id
```

### Tablas con Realtime habilitado en Supabase Dashboard
- `ofertas_cadetes` — cadete recibe nuevas ofertas en tiempo real
- `ubicacion_cadetes` — cliente ve el mapa del cadete en tiempo real
- `mensajes_pedido` — chat en tiempo real entre cliente/comercio/cadete

### Migración pendiente de aplicar
```sql
-- migration-tarifa-clima.sql (NO aplicada aún)
ALTER TABLE public.cadetes ADD COLUMN IF NOT EXISTS tarifa_clima boolean DEFAULT false;
```

---

## 8. Flujo de pedido completo

```
1. Cliente agrega productos al carrito → confirmarPedido()
   - Captura lat_entrega/lng_entrega del pin del mapa
   - Inserta en `pedidos` (estado='nuevo', estado_pago='pendiente')
   - Si MercadoPago: POST /api/mp/crear-preferencia → redirige a MP
   - Si efectivo: pedido ya confirmado

2. Webhook MP / confirmación efectivo → pedido.estado_pago = 'aprobado'

3. Comercio ve el pedido en su panel (Realtime en pedidos)
   - Acepta → estado='preparando'
   - POST /api/pedidos/difundir → busca cadetes en radio 10km
     * Calcula Haversine para cada cadete con GPS
     * Inserta en `ofertas_cadetes` (Realtime notifica al cadete)
     * Envía push notification (si VAPID configurado)

4. Cadete ve la oferta → acepta → POST /api/pedidos/aceptar
   - Anti-colisión: UPDATE WHERE cadete_id IS NULL
   - Genera codigo_retiro y codigo_entrega (CSPRNG 4 dígitos)
   - Congela ganancia_estimada en ofertas_cadetes

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
   - Trigger: si metodo_pago='efectivo' → acumula deuda_efectivo en cadetes

8. Cliente califica → POST /api/pedidos/valorar
   - Actualiza rating de comercio y cadete
```

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
- **⚠ VAPID keys NO están configuradas en Railway** → push notifications no funcionan en producción

### Nativa Android (Capacitor — pendiente Firebase)
- `push.js` detecta `window.Capacitor.isNativePlatform()` → usa `@capacitor/push-notifications`
- Requiere: proyecto Firebase + `google-services.json` en `android/app/`
- El `pushController.js` actual envía VAPID (web push). Para nativo necesita FCM API v1.

---

## 12. Capacitor (app nativa Android/iOS)

**Estado actual:** Configurado pero sin `android/` generado.

```json
// capacitor.config.json
{
  "appId": "com.puertaapuertax.app",
  "appName": "Puerta a Puerta X",
  "webDir": "frontend",
  "server": { "androidScheme": "https" }
}
```

**Para buildear el APK:**
```bash
npm install                  # instala Capacitor 7
npx cap add android          # genera android/ (~200MB, excluido de git)
npx cap sync android         # copia frontend/ al proyecto Android
npx cap open android         # abre Android Studio
# En Android Studio: Build → Build APK(s)
```

**Íconos listos:** `frontend/android-icons/ic_launcher_[mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi].png`

**Migraciones pendientes post-capicator:**
- `cadetes.tarifa_clima` (ver sección 7)
- Firebase / FCM para push nativas

---

## 13. Pendientes conocidos (por orden de impacto)

| # | Tarea | Impacto |
|---|-------|---------|
| 1 | Configurar `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` en Railway | Push notifications rotas en producción |
| 2 | Aplicar `migration-tarifa-clima.sql` en Supabase | Toggle clima del cadete no persiste |
| 3 | Build del APK Android (requiere alguien con Android Studio) | App nativa |
| 4 | Firebase → `google-services.json` → FCM para nativo | Push en app Android cerrada |
| 5 | Background GPS para cadetes (plugin Capacitor) | Tracking al minimizar la app |
| 6 | Publicar en Google Play Store ($25 cuenta desarrollador) | Distribución |
| 7 | Horarios automáticos de comercios (hoy es toggle manual) | UX |
| 8 | `reportes.comercio_id` y `advertencias_comercio.comercio_id` migrar a `uuid` | Deuda técnica |

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
