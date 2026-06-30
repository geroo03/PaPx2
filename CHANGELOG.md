# Changelog — Puerta a Puerta X

---

## [2.6.0] — 29–30 de junio 2026

### Bugs críticos corregidos

#### Auth y JWT
- `authMiddleware.js`: cambiado de `supabase` (ANON client) a `supabaseAdmin` (SERVICE_ROLE) para validar tokens JWT — esto estaba causando 401 en TODOS los endpoints del backend (difundir, crear-preferencia, notificar-comercio, etc.)
- `pago.html`: reescrita lógica de auth en `iniciarPago()` — ahora siempre llama `refreshSession()` primero antes de enviar el token a MercadoPago; si el backend devuelve 401 después del refresh muestra error claro con link a login

#### Chat
- RLS policy `mensajes_insert_partes` en `mensajes_pedido` comparaba `comercio_id = auth.uid()` pero `comercio_id` referencia `comercios.id` (no `auth.users.id`). Fix: JOIN a través de `comercios` chequeando `c.usuario_id = auth.uid()`. SQL en `supabase/migration-fix-mensajes-rls.sql`

#### Cadete — buscarCadete no implementado
- `buscarCadete(id)` era referenciada en `dispatchAction` pero no existía — el botón "Buscar cadete" no hacía nada. Implementada con fetch a `POST /api/pedidos/difundir`

#### Cadete — "Sin cadetes disponibles" siempre
- `difundirPedido` requería `activo = true AND disponible = true` pero `activo` nunca se seteaba
- Fix: `togDisp()` ahora sincroniza `activo` junto con `disponible`; upsert de perfil incluye `activo: true`
- Fix: query elimina requisito de `activo`, solo necesita `disponible = true`
- Fix: fallback — si no hay cadetes con GPS en 10 km, notifica a TODOS los `disponible = true`
- GPS cutoff extendido de 15 min a 30 min

#### Tracking en tiempo real
- `currentPedido.estado` nunca se actualizaba en memoria al aceptar el comercio, entonces `iniciarTracking` arrancaba desde el estado viejo
- Fix: `pedidoConfirmadoPorComercio()` actualiza `currentPedido.estado = 'preparando'`
- Fix: `iniciarTracking()` hace fetch inmediato del estado real desde Supabase al abrir
- Fix: polling de respaldo cada 8s si Realtime no llega, se auto-cancela al detectar `entregado`

#### Tracking — se repetía después de entregado
- Poll de 5s ("esperar confirmación del comercio") tenía `clearInterval(poll)` DESPUÉS de `pedidoConfirmadoPorComercio()` — si la función tiraba error (elementos DOM no presentes), el catch lo tragaba y el poll corría para siempre
- Fix: `clearInterval(poll)` movido ANTES de la llamada a la función
- Fix: `pedidoConfirmadoPorComercio()` reescrita con optional chaining para no tirar nunca
- Fix: flag `_entregadoYaVisto` — toast y rating popup ahora disparan UNA sola vez por sesión de tracking aunque `actualizarEstado('entregado')` se llame múltiples veces
- Fix: `window.state.setPedido(null)` al detectar `entregado` limpia localStorage — el pedido ya no reaparece en la próxima carga de la app

#### comercio.js — tabla incorrecta
- `sb.from('comercio')` (singular) en 6 lugares referenciaba una tabla que no existe; la tabla real es `comercios` (plural). Esto causaba fallos silenciosos en abrirComercio, toggle abierto/cerrado, guardar horarios, guardar ubicación
- Mi propio `replace_all` anterior para renombrar el bucket de Storage había pisado también las queries de BD. Corregido

#### comercio.js — perfiles con FK equivocada
- `sb.from('perfiles').select('id,...').in('id', cadeteIds)` buscaba perfiles por PK random (`id`) en lugar de por `usuario_id` (FK a auth.users). Los cadetes asignados a pedidos nunca aparecían con nombre/vehículo en el panel del comercio

#### cliente.js — rating sin usuario_id
- `enviarRating()` insertaba directo a `ratings` sin incluir `usuario_id` — fallaba con error 400 (columna NOT NULL). Redirigido al backend `POST /api/pedidos/valorar` que ya maneja todo correctamente

---

### Fotos y Storage

#### Buckets creados en Supabase Storage
- `productos` (público, 5 MB, image/*) — fotos de productos del menú
- `cadetes-antecedentes` (privado, 10 MB, image/* + PDF) — DNI, carnet, seguro
- `comercio` (público) — fotos de portada de tiendas

#### Menú del cliente — fotos de productos
- Reestructurado el render de cada ítem del menú: la imagen ahora va a la **izquierda** usando las clases CSS `.mi-img` / `.mi-left` que ya existían pero no se usaban. Antes la imagen iba dentro de `.mi-right` mezclada con precio y botón, haciéndola invisible visualmente

#### Panel comercio — foto de portada
- Nueva sección "Foto de portada" en la tab Configuración
- Preview instantáneo al seleccionar archivo
- Upload al bucket `comercio` con ruta `{comercio_id}/portada.{ext}`, `upsert: true`
- Guarda URL pública en `comercios.imagen_url` — aparece inmediatamente en las tarjetas del cliente

---

### Performance y UX

#### Cadete — arranque más rápido
- `guardCadete()`: cambiado de `getUser()` (network round-trip) a `getSession()` (localStorage, instantáneo)
- Init paralelo: `await Promise.all([verificarOnboarding(), cargarOfertas()])` en vez de secuencial

#### Sonidos de notificación en bucle
- `playBeep()` (comercio, nuevo pedido): ahora repite 6 veces × 0.5s = **3 segundos**
- `sonarViaje()` (cadete, nuevo viaje): ahora repite la secuencia de 4 notas 5 veces = **~3 segundos**
- Implementado con Web Audio API pre-programando todos los osciladores — timing exacto sin `setInterval`

---

### HTML

#### cadete.html — estructura rota
- 3 `</div>` de cierre huérfanos (restos de código eliminado en la sección de liquidaciones) cerraban prematuramente el div `.app`, dejando `sec-ia` y `sec-p` fuera del contenedor — la tab Perfil no renderizaba correctamente y el botón "Cerrar sesión" no era visible
- Nav bar duplicado eliminado (dos `<div class="nav">` fijos en `bottom:0` superpuestos)

---

## [2.5.0] — 25 de junio 2026

### Push Notifications
- Web Push nativo con VAPID keys (sin Firebase, gratis e ilimitado)
- Cadete recibe push cuando le llega un nuevo viaje
- Cliente recibe push cuando su pedido cambia de estado (preparando, en camino, entregado)
- Comercio recibe push cuando le llega un pedido nuevo
- Service worker actualizado para distintos tipos de notificacion
- Auto-registro de suscripcion en todas las paginas autenticadas via main.js

### Sistema de Efectivo
- Tabla `liquidaciones` para registrar devoluciones del cadete
- Trigger `pedidos_acumular_deuda_efectivo` — al entregar pedido en efectivo suma a `cadetes.deuda_efectivo`
- Columnas `deuda_efectivo` ($0) y `limite_efectivo` ($15.000) en cadetes
- Endpoints: `GET /api/cadete/efectivo`, `POST /api/cadete/solicitar-liquidacion`
- UI cadete: barra de progreso verde/amarillo/rojo, boton "Liquidar" con modal
- Historial de liquidaciones en panel del cadete
- Opcion "Efectivo" funcional en checkout del cliente con mensaje de total a pagar

### Referidos entre Cadetes
- Tabla `referidos_cadete` con tracking de viajes y comisiones
- Comision 2% al referente por los primeros 50 viajes del referido
- Trigger `pedidos_comision_referido` se ejecuta automaticamente en cada entrega
- Validacion de codigo via backend (`POST /api/cadete/validar-referido`)
- Contador de "Cadetes invitados" en perfil del cadete

### Admin — Control de Efectivo
- Tabla de cadetes con barra de deuda por color de riesgo
- Input editable para limite de efectivo por cadete
- Boton "Editar deuda" para ajustar manualmente
- Seccion "Liquidaciones pendientes" con Confirmar/Rechazar
- Confirmar descuenta la deuda del cadete automaticamente
- Endpoints: `PATCH /api/cadete/:id/efectivo`, `GET /api/cadete/admin/lista`

### Datos Bancarios Comercio
- 10 columnas nuevas: titular_bancario, tipo_cuenta, cbu_alias, cuit, razon_social, ciudad, codigo_postal, barrio, email_facturacion, banco
- Formulario editable en seccion Finanzas del comercio

### Rating Real
- Al valorar cadete se recalcula promedio y actualiza `cadetes.rating`
- Al valorar comercio se recalcula promedio y actualiza `comercios.rating`

### Legal
- Pagina `/legal.html` con Terminos y Condiciones + Politica de Privacidad
- Ley 25.326, modelo de negocio, codigos de seguridad, efectivo, referidos
- Links desde login, registro cadete, y perfil del cliente

### PWA
- Banner "Instalar Puerta a Puerta X" con install prompt nativo
- Se muestra una vez, descartable, detecta instalacion

### Performance
- Preconnect hints para Supabase y CDN en 6 HTML
- localStorage cache para comercios y rubros
- Imagenes reducidas de w=600 a w=400
- Middleware `compression` (gzip) en backend

### Configuracion
- SMTP Resend en Supabase para emails transaccionales
- VAPID keys en Railway para Web Push
- MP Access Token de produccion en Railway

---

## [2.0.0] — Sesion de desarrollo 20 de junio 2026

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
