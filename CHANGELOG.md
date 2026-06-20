# Changelog — Sesion de desarrollo 20 de junio 2026

Registro completo de todo lo implementado, corregido y limpiado durante esta sesion.

---

## Resumen ejecutivo

Se tomo el proyecto desde un estado de desarrollo con datos mock, bypasses de seguridad y codigo muerto, y se llevo a un estado deployable en produccion con Railway (backend) + Vercel (frontend) + Supabase (DB).

**Numeros:**
- 34 commits
- ~4000 lineas agregadas, ~6000 eliminadas
- 2 vulnerabilidades de seguridad cerradas
- 7 bugs criticos arreglados
- ~100 emojis reemplazados por SVG
- 5 archivos muertos eliminados
- 100+ lineas de mock data removidas
- Panel admin reescrito de cero

---

## 1. Backend — Modularizacion y endpoints nuevos

### Lo que se hizo
- **Migrado** de `backend/server.js` monolitico (CommonJS, no ejecutable) a sistema modular `backend/src/` con ES modules
- **Portados** 5 endpoints que faltaban del servidor viejo:
  - `POST /api/mp/crear-preferencia` — MercadoPago payments
  - `POST /api/mp/webhook` — webhook con verificacion HMAC-SHA256
  - `POST /api/cadete/actualizar-ubicacion` — GPS tracking
  - `POST /api/pedidos/valorar` — ratings de comercio y cadete
  - `registrarComisionSiAplica()` — hook automatico al entregar pedido

### Archivos creados
- `backend/src/controllers/mpController.js`
- `backend/src/controllers/cadeteController.js`
- `backend/src/controllers/embajadorController.js`
- `backend/src/lib/roleUtils.js` — `resolveRol()` usando `perfiles.usuario_id`
- `backend/src/lib/comisionUtils.js` — `calcularComision(fechaInicio, monto)`
- `backend/src/routes/mpRoutes.js`
- `backend/src/routes/cadeteRoutes.js`
- `backend/src/routes/embajadorRoutes.js`

### Archivos eliminados
- `backend/server.js` (monolitico muerto, CommonJS incompatible)
- `backend/scripts/` (test scripts)

---

## 2. Sistema de embajadores (feature completo)

### Backend
- `calcularComision()` — < 6 meses: 5%, >= 6 meses: 2% del monto del pedido
- `registrarComisionSiAplica()` — fire-and-forget al entregar pedido
- Endpoints: dashboard, agregar-comercio, solicitar-retiro, confirmar-pago, rechazar-retiro

### Base de datos (SQL)
- 4 tablas nuevas: `patrocinios`, `historial_comisiones`, `billetera_embajador`, `solicitudes_retiro`
- 4 RPCs atomicas: `acreditar_comision`, `solicitar_retiro_embajador`, `confirmar_pago_retiro`, `rechazar_retiro`
- 7 indices, 8 politicas RLS
- Todo consolidado en `supabase/schema-definitivo-v2.sql`

### Frontend
- Dashboard embajador: billetera (3 saldos), historial comisiones con tasa visible, comercios registrados, solicitar retiro con modal

---

## 3. Panel del cadete (mejoras)

### Onboarding obligatorio
- Google OAuth registration (boton unico, sin formulario email/password)
- Overlay de onboarding: nombre, foto DNI, CVU, vehiculo (bici/moto)
- Campos de moto (patente, carnet, seguro) aparecen solo al elegir moto
- Se guarda todo en tabla `cadetes` + sube DNI a Supabase Storage

### GPS Reporter
- `navigator.geolocation.watchPosition()` envia posicion cada 10 segundos
- `POST /api/cadete/actualizar-ubicacion` con lat, lng, pedido_id
- Se activa/desactiva con toggle de disponibilidad

### Ofertas con timer
- Barra de 20 segundos que se consume linealmente
- Auto-rechazo al expirar
- Timer de 10 minutos cuando el cliente no aparece (no-show)

### Referidos
- Codigo `PAP-XXXX` auto-generado
- Campo en onboarding para ingresar codigo de quien te invito
- Boton "Copiar" en el perfil

### Vehiculo
- Selector bici/moto con confirmacion al cambiar
- Tarifas: bici $1.200 / moto $1.800 base + $250/km
- Campos de moto se muestran/ocultan dinamicamente

### Perfil
- Autocompletado de todos los campos desde la tabla `cadetes`
- Campo de telefono/WhatsApp agregado
- Tracking: horas activo, rating, viajes totales
- Historial de viajes (tab dedicada)

### Bugs corregidos
- Guard usa `getUser()` en vez de `getSession()` (valida token real, no cache)
- Consulta `perfiles.usuario_id` como fallback para el rol
- Toggle disponible persiste en sessionStorage (no se resetea con Alt+Tab)
- Nombre se carga desde tabla `cadetes`, no desde email

---

## 4. Tracking del cliente (mapa Leaflet)

- Reemplazo del SVG estatico por mapa Leaflet real
- Marker azul = cliente, marker scooter = cadete
- `fitBounds` con 20% padding + animacion
- CSS transition 1.5s para movimiento suave del cadete
- Distancia + ETA calculados con Haversine en cada update GPS
- Tooltips oscuros con nombre

---

## 5. Panel admin (reescritura completa)

### Antes
- HTML duplicado (doctype anidado)
- Codigo huerfano despues de `</html>`
- Texto "datos simulados"
- Tabla de comercios vacia
- Pedidos vacios
- Boton Actualizar sin funcion
- Buscador sin funcion
- Patrocinios usaban tabla equivocada

### Despues
- 6 tabs: Pedidos, Comercios, Cadetes, Embajadores, Retiros, Crear usuario
- 6 KPIs reales: usuarios, comercios, cadetes, facturacion, embajadores, retiros pendientes
- Tabla de cadetes: nombre, email, tel, vehiculo, CVU, foto DNI, estado
- Tabla de embajadores: billetera con 3 saldos + cantidad de comercios
- Solicitudes de retiro: botones Pagar/Rechazar (llaman RPCs del backend)
- Boton Actualizar recarga todo
- Buscador filtra todas las tablas
- Crear embajador guarda/restaura sesion admin

---

## 6. Seguridad

### Vulnerabilidades cerradas
1. **Role escalation** — `sb.auth.updateUser({data:{role:'cadete'}})` en cliente/index.html permitia a cualquier usuario auto-asignarse cadete. Reemplazado por `POST /api/auth/set-role` (backend valida)
2. **Auth bypass** — `pap_bypass_activo` en localStorage permitia saltear Supabase auth. Eliminado de login-usuario.html, cliente/index.html y cliente.js

### Fixes de seguridad
- Admin no se desloguea al crear embajador (save/restore session)
- `perfiles.upsert` en registro-comercio.html corregido: `id` → `usuario_id`
- Todos los endpoints protegidos con JWT (testeado: 15/15 devuelven 401 sin token)
- CORS allowlist desde `FRONTEND_URL`
- Webhook MercadoPago verifica HMAC-SHA256

---

## 7. Limpieza de codigo

### Mock data eliminado
- `HABIBI_ESTATICO` y 3 comercios demo fallback (cliente.js)
- `menusFallback` con productos hardcodeados (cliente.js)
- `MOCK_DATABASE` con usuarios y pedidos de prueba (config.js)
- Objeto `MOCK` de 100 lineas en comercio.js (comercio, categorias, productos, ratings, promos)
- `simularNuevoViaje()` en cadete.js
- `order-service.js` (archivo entero, mock de localStorage)
- Banners hardcodeados de Burger King/Pizza Hut/Disco (cliente/index.html)
- `USE_MOCK` y todos los `if (USE_MOCK)` branches en login.js, admin-acceso.js
- Placeholder "Miguel Gonzalez" reemplazado por nombre real del usuario

### Archivos eliminados (total proyecto)
- `backend/server.js` (monolitico CommonJS)
- `backend/scripts/` (test scripts)
- `frontend/assets/js/order-service.js` (mock)
- `frontend/assets/js/mock-data.js` (mock)
- `frontend/assets/js/login-root.js` (dead code, no usado por ninguna pagina)
- `frontend/assets/js/api.js` (dead code, tenia bug de columna)
- `frontend/api/` (funciones serverless de Netlify, reemplazadas por Express)
- `frontend/react/` (componentes React sin usar)
- `frontend/firebase-messaging-sw.js` (no usado)
- `frontend/assets/comercio-capturas/` (screenshots de desarrollo)
- `frontend/_redirects` (Netlify, crasheaba Vercel)
- `frontend/vercel.json` (rewrite interceptaba archivos estaticos)
- `tools/`, `test_agente_claude/`, `scripts/` (carpetas de prueba)
- Scripts PowerShell: `cleanup-backend.ps1`, `reorganize.ps1`, `start-all.ps1`
- `crear_usuario_test.js`, `netlify_build`, `puertaapuerta-netlify.zip`
- `DEPLOYMENT.md`, `README_FRONTEND_ONLY.md`, `SUPABASE_ROLE_PLAYBOOK.sql`
- 5 migraciones SQL antiguas (reemplazadas por schema-definitivo-v2.sql)

### Emojis → SVG
- `icons.js` reescrito: 12 SVG icons (scooter, check, warn, close, pin, confetti, star, fire, clock, calendar, chat, plate)
- ~100 emojis reemplazados en 14 archivos JS/HTML
- Emojis en toasts, headers, labels, botones → texto plano o `ICONS.xxx`

### Fixes de infraestructura
- Supabase CDN agregado a 8 paginas HTML que lo tenian faltante
- CDN duplicados removidos (cliente/index.html, comercio/comercio.html)
- CDN versionado a `@2` en embajador/dashboard.html
- `env.js` agregado a pago.html y oauth-callback.html
- Path de env.js corregido en admin-acceso.html (`../assets/env.js` → `/env.js`)
- `ws` package agregado para Node 20 en Railway (WebSocket polyfill)
- `package-lock.json` removido (npm roto localmente, Railway regenera)

---

## 8. Deploy

### Railway (backend)
- Root directory: `backend/`
- Start command: `npm start`
- 8 variables de entorno configuradas
- Dominio: `papx2-production.up.railway.app`
- Estado: corriendo sin errores

### Vercel (frontend)
- Root directory: `frontend/`
- Framework preset: Other (HTML estatico)
- Sin build command
- `env.js` commiteado con anon key publica + BACKEND_URL de Railway
- Estado: deployado

### Supabase
- Schema principal + embajador aplicados
- Storage buckets creados: `cadetes-antecedentes` (privado), `productos` (publico)
- Politicas RLS de Storage configuradas
- Politicas RLS de `comercios` y `perfiles` simplificadas (sin recursion)
- Constraint `telefono NOT NULL` removido de `cadetes`
- Triggers viejos problemáticos eliminados (`perfiles_force_cliente`, `perfiles_prevent_role_escalation`)
- Trigger `handle_new_auth_user_create_profile` recreado con `usuario_id`

---

## 9. Tests ejecutados

### Backend (41/41 OK)
- 15 endpoints → 401 sin token
- Webhook sin HMAC → 401
- Token falso → 401
- CORS origen malicioso → bloqueado
- CORS localhost:8000 → permitido
- Health check → 200
- 24 paginas frontend cargan correctamente
- Frontend → Backend CORS OK

### Logica de negocio (50/50 OK)
- Haversine: misma ubicacion, 7km, >10km
- Tarifas: 0=$600, 3=$1350, 5=$1850, 7.5=$2500, 10=$3100
- Tarifas por vehiculo: bici/moto con bases diferentes
- Codigos 4 digitos CSPRNG (1000 iteraciones)
- timingSafeEqual: iguales/distintos/null
- Roles: admin/embajador bloqueados, normalizacion usuario→cliente
- HMAC webhook: firma valida/invalida
- Propina: limite $10000, negativos→0, float→floor
- GPS: lat/lng fuera de rango rechazados
- Estrellas: 1-5 validas, 0/6/float/string rechazados

### Comisiones embajador (32/32 OK)
- Tasa 5% en meses 0-5, tasa 2% en meses 6+
- Montos correctos con redondeo
- Flujo billetera: acumular → solicitar retiro → confirmar/rechazar
- Edge cases: fecha futura, monto negativo, string ISO

---

## 10. Lo que falta para produccion

### Alta prioridad (hacer antes de lanzar)

| Tarea | Donde |
|-------|-------|
| Activar Realtime para `ofertas_cadetes`, `pedidos`, `ubicacion_cadetes` | Supabase SQL Editor |
| Probar flujo completo: pedido → cadete acepta → entrega | 2 ventanas del navegador |
| Tener al menos 1 comercio real con productos y lat/lng | Admin o embajador |

### Media prioridad

| Tarea | Donde |
|-------|-------|
| Activar Google OAuth en Supabase Auth | Google Cloud Console + Supabase Dashboard |
| Limpiar ~40 bloques `if (USE_MOCK)` muertos en comercio.js | Frontend JS |
| Verificar panel comercio funciona sin mock data (login + CRUD) | Testing manual |
| Emojis restantes en comercio.html (~8 en promos/horarios) | Frontend HTML |

### Baja prioridad (post-lanzamiento)

| Tarea | Donde |
|-------|-------|
| Variacion de precios por horario/demanda | Backend — necesita reglas de negocio |
| Notificaciones push reales (Firebase/OneSignal) | Frontend + backend |
| Dashboard de metricas con graficos reales (no SVG estaticos) | Admin panel |
| Paginacion en tablas del admin (ahora limit 50) | Frontend |
| Tests automatizados E2E | Playwright o similar |

---

## 11. Errores historicos y soluciones

Documentados para que no se repitan:

| Error | Causa | Solucion |
|-------|-------|----------|
| `column "tipo_delivery" does not exist` | ADD CONSTRAINT antes de ADD COLUMN | Siempre ADD COLUMN primero |
| `column "usuario_id" does not exist` (perfiles) | Schema viejo: id=auth.uid, nuevo: id=random | Backfill + usar usuario_id |
| `column "usuario_id" does not exist` (ratings) | Tabla existia sin esa columna | ADD COLUMN IF NOT EXISTS |
| `relation already exists` (42P07) | EXCEPTION WHEN duplicate_object no atrapa 42P07 | Usar WHEN OTHERS THEN NULL |
| `perfiles.id` vs `perfiles.usuario_id` | id es PK random, usuario_id es FK a auth | Siempre .eq('usuario_id', uid) |
| Node 20 sin WebSocket nativo | Railway usa Node 20, Supabase Realtime necesita WS | Instalar package `ws` |
| Vercel `fsPath` crash | `_redirects` (Netlify) incompatible con Vercel | Eliminar archivo |
| Vercel rewrite intercepta archivos | `vercel.json` con `/(.*) → index.html` | Eliminar vercel.json |
| `infinite recursion in policy` | Politicas RLS con subqueries a tablas con RLS | Politicas simples sin subqueries |
| Admin se desloguea al crear embajador | `signUp()` reemplaza la sesion activa | Save/restore session |
