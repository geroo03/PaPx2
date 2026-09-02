# Puerta a Puerta

Plataforma de delivery en tiempo real para Santiago del Estero, Argentina.
Conecta 5 roles: **cliente**, **comercio**, **cadete** (repartidor), **embajador** y **admin**.

> ⚠️ **Para IAs:** las secciones de **detalle de funciones por archivo** de este README quedaron desactualizadas en varios puntos (deploy del frontend, tarifas de cadete, endpoints nuevos de efectivo/liquidaciones, Capacitor). Ante cualquier contradicción ahí, confiar en **[`CLAUDE.md`](CLAUDE.md)**.
>
> **Excepciones — estas secciones sí están al día y son la fuente de verdad de su tema:** el checklist de lanzamiento de acá abajo, [Sesión 2026-09-01/02](#sesión-2026-09-0102--auditoría-y-fixes-de-la-app-nativa-play-store) (qué se arregló, cómo se buildea y sube a Play Store, cómo leer un crash de Sentry) y [Errores históricos y soluciones](#errores-históricos-y-soluciones).

---

## 🟡 IMPORTANTE — Qué falta para poder lanzar

> Checklist completo y en detalle en [`PENDIENTES-LANZAMIENTO.md`](PENDIENTES-LANZAMIENTO.md). Resumen acá porque es lo más importante del repo en este momento. Actualizado 2026-08-19.

1. **Google Play Console — cuenta verificada, app ya creada, completando el checklist.** El track de Closed Testing exige un mínimo de **12 testers que acepten activamente la invitación** (no ~20 como se pensaba antes de tener la cuenta real), corridos 14 días antes de poder pedir Production — sigue siendo el ítem de mayor lead-time de todo el lanzamiento. Detalle línea por línea de qué está declarado y qué falta en `PENDIENTES-LANZAMIENTO.md` ítem 1.
2. **Backup del keystore de firma Android sin confirmar** fuera de esta máquina. Si se pierde, no hay forma de recuperarlo ni de que Google lo resetee — significaría no poder actualizar nunca más la misma ficha de Play Store.
3. **APK probado una vez en un dispositivo real (2026-08-11)**, aparecieron bugs de CSS — ya diagnosticados y arreglados en el código (edge-to-edge de Android 15 sin `safe-area-inset`). Falta reinstalar el build actualizado y reconfirmar que desaparecieron, más el resto del flujo: login con Google (deep link nativo), pedido de punta a punta, permisos de GPS/cámara. `qa-e2e.mjs` prueba el backend, pero no el shell nativo.
4. **Feature graphic de Play Store (1024×500 px)** — único gráfico que falta para la ficha.
5. **Payway** — a cargo de Fabri, no tocar sin que él avance.
6. **Firebase/FCM para push nativo — reabierto el 2026-08-19**, pospuesto a propósito hasta cerrar el checklist de Play Console (ítem 1). No está confirmado si ya existe un proyecto de Firebase de un intento anterior (hay un indicio real: una API key de Firebase huérfana en el historial de git). Ver `PENDIENTES-LANZAMIENTO.md` ítem 14.
7. ~~**Cuenta de prueba para el revisor de Google Play**~~ — **creada** (`googleplay.reviewer@puertaapuertax.app`). Ojo: el 2026-09-01 se encontró que su `perfiles.rol` había quedado en `cadete`, así que el revisor entraba al panel de cadete en vez de la app de cliente — corregido a `cliente` en `perfiles.rol` y en `user_metadata`. Si se vuelve a tocar esa cuenta, verificar el rol antes de declararla.
8. **Política de Privacidad — declaración en Play Console en pausa a propósito.** Hay un borrador con la cláusula de Propiedad Intelectual reforzada (`docs/legal-tyc-borrador-2026-08-17.html`) sin volcar todavía a la página en vivo (`frontend/legal.html`, ya en producción en `pa-px2.vercel.app/legal.html`).
9. **Trabajo real sin mergear a `main`** (detectado 2026-09-01, ver sección de sesión más abajo). La rama `work/2026-08-20-google-elegir-rol` tiene 8 commits que producción nunca recibió, incluido **`c3614a8` — un fix de crash del login con Google** (carrera de doble redirect). Hay que decidir qué se mergea y qué se descarta: es exactamente el mismo patrón que causó el crash de push que estuvo días en producción sin que nadie lo notara.
10. **iOS — la Mac ya está disponible** (2026-09-02). Se levanta el bloqueo que había: ahora se puede correr `npx cap add ios` + `pod install` de verdad y abrir el proyecto en Xcode. Ver `docs/IOS-BUILD.md` para los 3 ajustes manuales de `Info.plist` que hay que reaplicar después de regenerar `ios/` (permisos de cámara/ubicación, deep link de Google OAuth, push). Falta todavía una fuente cuadrada de 1024×1024 para el ícono.

---

## Sesión 2026-09-01/02 — auditoría y fixes de la app nativa (Play Store)

Todo esto salió de feedback de un **tester real probando la app instalada desde Google Play** (no la web). Se shippearon 4 commits a `main` y 5 builds firmados (`versionCode` 16 → 20). Deploy web: automático por Vercel al pushear a `main`. Deploy nativo: **no automático** — cada fix necesita `npx cap sync android` + build + subir el `.aab` a Play Console, ver "Cómo llega un fix al celular" más abajo.

### Bugs arreglados — panel de COMERCIO

**1. Overlay invisible del menú lateral bloqueaba TODOS los toques en celular.**
`frontend/assets/css/portal-layout.css` — dentro del `@media (max-width: 768px)`, la regla era `.sidebar-overlay { display: block; }` sin condicionar a la clase `.show` que el JS sí manejaba bien. Resultado: un `div` fijo, transparente, de pantalla completa (`inset:0`, `z-index:199`) tapando todo el contenido, siempre. El tester reportó que no andaba nada salvo pausar pedidos y cerrar sesión — justamente los dos controles que quedaban por encima (topbar `z-index:300` y sidebar `z-index:200`). Fix: `.sidebar-overlay.show { display: block; }`. Ya se había detectado el 2026-08-18 y se dejó sin tocar por estar fuera de alcance de esa tarea.

**2. El botón de estado del local se destruía a sí mismo + se cortaba en mobile.**
`frontend/assets/js/comercio.js` → `applyComercioToUI()` escribía en `btn.textContent` sobre el botón entero, borrando sus dos hijos: `.estado-dot` (el puntito de color) y `#estado-texto`. Pasaba **siempre**, no solo con horario automático. Además `.estado-btn` no tenía `white-space:nowrap`, así que los textos largos envolvían a 2 líneas y se cortaban contra el alto fijo del topbar. Fix: escribir en el span interno + `nowrap` + truncado con ellipsis en pantallas de 480px o menos.

### Bugs arreglados — panel de CADETE (8 reportes del tester)

| # | Problema | Fix |
|---|---|---|
| 1 | La foto de DNI aceptaba cualquier archivo sin validar | Validación de tipo y tamaño (imagen, máx 8MB) en los 3 puntos de subida: onboarding paso 1, onboarding final y Perfil |
| 2 | Cadete nuevo arrancaba con rating 5.0 | `migration-cadetes-rating-default-3.sql` — default de columna a 3.0, **no retroactivo**. Ya corrida en Supabase |
| 3 | La pestaña Perfil no cargaba los datos ya guardados | La precarga corría **una sola vez al cargar el script**, o sea antes de que el onboarding escribiera nada, y nunca se volvía a llamar. Extraída a `cargarDatosPerfil()` con 3 disparadores: al iniciar, al terminar el onboarding, y al entrar a la pestaña |
| 4 | La foto de DNI nunca se volvía a mostrar en Perfil | Nueva `mostrarFotoDniGuardada()` con `createSignedUrl` (bucket privado `cadetes-antecedentes`) |
| 5 | El botón de reportar tapaba el de enviar del chat | `toggleChatCadete()` ahora oculta `#viaje-alert-btn` mientras el chat está abierto. El de reportar es `position:fixed` y el de enviar vive in-flow en una card scrolleable, así que coincidían según el scroll |
| 6 | El sonido de nueva oferta se rompía con 2 pedidos simultáneos | `sonarViaje()` creaba un `AudioContext` nuevo por llamada sin cerrarlo nunca. En mobile se pisa el límite de contextos concurrentes y tira, silenciado por un `catch` vacío. Ahora reusa uno solo a nivel de módulo |
| 7 | Ver ruta al local salía a Google Maps externo | Mapa Leaflet embebido en la card del viaje activo, **sumado** al link externo (no lo reemplaza). De paso: `cargarOfertas()` nunca pedía `lat_entrega`/`lng_entrega`, lo que además tenía muerto el KM en vivo al cliente |
| 8 | El botón de reportar no hacía nada real | Era un `confirm()` más un `toast()` hardcodeado, sin ningún fetch. Ahora inserta de verdad en la tabla `reportes` (la policy `reportes_owner_all` ya lo permitía). **Falta la pantalla de admin para verlos** |

**Bonus encontrado en el camino:** `cancelarPorNoShow()` avisaba que el pedido se había cancelado aunque el backend hubiera rechazado la cancelación (devuelve 400 si el pedido no está exactamente en `en_camino`). El cadete quedaba convencido de que canceló mientras el pedido seguía activo para cliente y comercio. Ahora muestra el error real y no toca el estado local.

### Bug arreglado — las 3 apps (cliente, cadete, comercio)

**El botón físico de atrás de Android no hacía nada.** Reportado como que la app se congelaba, y también como que se cerraba sola: según el dispositivo, Android o no hace nada o mata la app. Ninguna de las 3 apps registraba un listener de `backButton` — el plugin `@capacitor/app` estaba instalado pero no se usaba para esto. Como la navegación es por clases CSS (`go()` / `stab()` / `navigate()`) sin `pushState`, Android no tenía ninguna pantalla anterior a la que volver. Fix con el mismo patrón en los 3 archivos: cerrar lo más específico primero (panel, modal o sidebar abierto), después volver a la pantalla principal, y recién ahí salir de la app.

### Crash crítico — push.js intentaba registrar FCM sin Firebase

Es el más importante de todos. Sentry (Issue `ANDROID-1`) capturó `IllegalStateException: Default FirebaseApp is not initialized`, disparado por `PushNotificationsPlugin.register()` desde `registrarPushNativa()`, llamada por `main.js` **después de cualquier login exitoso**, o directo al abrir la app si ya había sesión guardada. No es atajable con `try/catch`: pasa dentro del puente nativo de Capacitor (`Bridge.java`, invocación por reflection) antes de que el control vuelva a JS, así que Android mata el proceso entero.

**Lo grave no fue el bug sino cómo estaba perdido:** este fix ya se había diagnosticado y escrito en una sesión anterior, pero quedó **sin commitear, guardado en un `git stash` de otra rama**. Nunca llegó a `main`. Por eso los builds 16, 17, 18 y 19 de esta sesión salieron todos con el crash adentro, y el tester lo siguió reportando build tras build. Se recuperó del stash y se aplicó a `main` en el commit `48c0d5b` (versión 20).

### Otros arreglos

- **Cuenta del revisor de Google Play**: tenía `perfiles.rol` en `cadete`, así que el revisor habría entrado al panel de cadete en vez de la app de cliente. Corregida a `cliente` en `perfiles.rol` y en el metadata de auth.
- **Alerta de política de Android 16 (API 36) en Play Console**: se resolvió al subir builds nuevas. La causa de que siguiera apareciendo era una build vieja (versión 1) todavía activa en el track de Prueba Interna — Google evalúa **todos** los tracks activos, no solo Producción.

### Auditoría de la sección de cliente (sin hallazgos)

Se revisó buscando específicamente los dos patrones de bug encontrados en comercio: no hay overlays con `display` incondicional, ningún `textContent` pisa contenedores con hijos, todos los campos de texto ya tienen `font-size:16px` (evita el zoom automático de iOS), y no hay scroll horizontal entre 320px y 768px. El diseño es fluido con `max-width:430px` centrado, sin `@media` — no necesita breakpoints.

### Cómo llega un fix al celular (importante)

`capacitor.config.json` **no tiene `server.url`**: el frontend se empaqueta dentro del `.aab` en el momento del build. O sea:

| Vía de acceso | Cómo recibe un fix |
|---|---|
| Navegador (celular o PC) en `pa-px2.vercel.app` | **Al instante**, con solo pushear a `main` |
| App instalada desde Google Play | Solo con un `.aab` nuevo subido a Play Console y el usuario actualizando |
| iOS | No existe build todavía (ver checklist ítem 10) |

Receta del build firmado por línea de comandos, que evita el wizard de Android Studio, con las trampas de esta máquina en particular:

1. **Matar los daemons de Gradle/Java** que dejan colgados las extensiones de VS Code. Esta máquina tiene ~7.4GB de RAM y el build muere por OOM si no se hace. En PowerShell: listar con `Get-CimInstance Win32_Process` filtrando por `java.exe` y matarlos con `Stop-Process -Force`.
2. **Bumpear `versionCode`** en `android/app/build.gradle`. Play Console rechaza un `versionCode` ya usado en **cualquier** track, incluso si la subida anterior falló a mitad de camino.
3. `npx cap sync android`
4. Desde `android/`, correr `gradlew.bat bundleRelease --no-daemon` con `JAVA_HOME` apuntando al JBR de Android Studio (`/c/Program Files/Android/Android Studio/jbr`, **no** el Java del PATH que es un Java 8 viejo) y los 4 parámetros de firma `android.injected.signing` (keystore, alias `upload`, contraseñas en `C:\Users\Usser\puertaapuertax-android-keystore\LEEME-CRITICO.txt`).
5. **Verificar que quedó firmado de verdad**: el `.aab` tiene que tener `META-INF/UPLOAD.SF` y `META-INF/UPLOAD.RSA` en la raíz del zip. Sin eso, quedó sin firmar.

Salida: `android/app/build/outputs/bundle/release/app-release.aab`

### Cómo leer un crash de Sentry de este proyecto

Sentry nativo está activo (`io.sentry:sentry-android`, DSN en `AndroidManifest.xml`, organización `puerta-a-puerta-x`). **Ante cualquier crash reportado, mirar Sentry primero**, antes de teorizar leyendo código: el stack trace real aparece en minutos.

Al mirar un evento, **fijarse siempre en el tag `release` o `dist`**, que dice en qué `versionCode` pasó. Sentry agrupa por stack trace, así que un mismo Issue acumula eventos de versiones viejas todavía instaladas en teléfonos que no actualizaron. Un evento con `release 1.0+12` cuando la última versión es la 20 no es un bug nuevo: es una instalación vieja repitiendo algo ya resuelto.

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

## Estructura completa del proyecto

```
puertaapuerta-main/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   │   ├── authController.js
│   │   │   ├── pedidoController.js
│   │   │   ├── cadeteController.js
│   │   │   ├── mpController.js
│   │   │   └── embajadorController.js
│   │   ├── lib/
│   │   │   ├── supabaseClient.js
│   │   │   ├── roleUtils.js
│   │   │   └── comisionUtils.js
│   │   ├── middlewares/
│   │   │   └── authMiddleware.js
│   │   ├── routes/
│   │   │   ├── authRoutes.js
│   │   │   ├── pedidoRoutes.js
│   │   │   ├── cadeteRoutes.js
│   │   │   ├── mpRoutes.js
│   │   │   └── embajadorRoutes.js
│   │   └── server.js
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── package-lock.json
│
├── frontend/
│   ├── cliente/
│   │   ├── index.html
│   │   ├── login-usuario.html
│   │   ├── oauth-callback.html
│   │   └── pago.html
│   ├── comercio/
│   │   ├── comercio.html
│   │   ├── login.html
│   │   └── registro-comercio.html
│   ├── cadete/
│   │   ├── cadete.html
│   │   ├── registro-cadete.html
│   │   └── oauth-callback-cadete.html
│   ├── embajador/
│   │   └── dashboard.html
│   ├── admin/
│   │   ├── admin.html
│   │   └── admin-acceso.html
│   │   # crear-embajador.html se borró en la limpieza del 2026-08-07 — era
│   │   # un stub huérfano sin ningún link entrante, superseded por la
│   │   # pestaña "Crear usuario" de admin.html
│   ├── assets/
│   │   ├── css/   (index, login, cadete, comercio, embajador, admin, pago, etc.)
│   │   └── js/    (ver detalle de funciones abajo)
│   ├── index.html          # Redirect / → /login.html
│   ├── login.html          # Login general (todos los roles)
│   ├── sw.js               # Service Worker para push notifications
│   └── env.js.template     # Template: SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_URL
│   # Nota: _redirects y vercel.json fueron ELIMINADOS (rompían el deploy, ver CHANGELOG v2.6.0) — no existen más en el repo
│
├── supabase/
│   ├── schema-definitivo-v2.sql   # TODO el schema en un solo archivo
│   └── functions/mp-webhook/index.ts  # Edge Function alternativa para webhook MP
│
├── .gitignore
└── README.md
```

---

## Funciones por archivo — Backend

### `backend/src/server.js`
Punto de entrada. Monta CORS (allowlist desde `FRONTEND_URL`), JSON parser, rutas y handlers de error.

### `backend/src/middlewares/authMiddleware.js`
| Función | Descripción |
|---------|-------------|
| `requireAuth(req, res, next)` | Lee `Authorization: Bearer <jwt>`, valida contra Supabase Auth, inyecta `req.user`. Retorna 401 si falla. |

### `backend/src/lib/supabaseClient.js`
Exporta `supabaseAdmin` — cliente Supabase con `service_role` key (bypass total de RLS).

### `backend/src/lib/roleUtils.js`
| Función | Descripción |
|---------|-------------|
| `resolveRol(userId, userMetadata)` | Consulta `perfiles.usuario_id` para obtener el rol. Fallback a `user_metadata.role`. |

### `backend/src/lib/comisionUtils.js`
| Función | Descripción |
|---------|-------------|
| `calcularComision(fechaInicioPatrocinio, montoBase)` | Retorna `{ tasa, porcentaje, monto, mesesActivo }`. < 6 meses = 5%, >= 6 meses = 2%. |

### `backend/src/controllers/authController.js`
| Función | Ruta | Descripción |
|---------|------|-------------|
| `setRole(req, res)` | `POST /api/auth/set-role` | Asigna rol post-registro. Roles permitidos: `cliente`, `usuario`, `comercio`, `cadete`. Bloqueados: `admin`, `embajador`. Normaliza `usuario` → `cliente`. Upsert en `perfiles` por `usuario_id`. |

### `backend/src/controllers/pedidoController.js`
| Función | Ruta | Descripción |
|---------|------|-------------|
| `aceptarPedido(req, res)` | `POST /api/pedidos/aceptar` | Body: `{ pedidoId, cadeteId, ofertaId }`. Lee tarifa inmutable de `ofertas_cadetes`. Genera `codigo_retiro` y `codigo_entrega` (CSPRNG 4 dígitos). Anti-colisión: `.is('cadete_id', null)`. |
| `cambiarEstadoPedido(req, res)` | `POST /api/pedidos/cambiar-estado` | Body: `{ pedido_id, nuevo_estado, codigo_retiro?, codigo_entrega? }`. Valida código con `crypto.timingSafeEqual`. Al `entregado`, dispara comisión embajador. |
| `getPedidoConCadete(req, res)` | `GET /api/pedidos/:id` | Devuelve pedido + perfil cadete (`perfiles.usuario_id`). Código de entrega solo visible al cliente cuando estado = `en_camino`. |
| `difundirPedido(req, res)` | `POST /api/pedidos/difundir` | Body: `{ pedidoId, comercioId }`. Lee GPS cadetes (últimos 15 min), Haversine ≤ 10km, tarifa bici $1200 / moto $1800 + $250/km. Inserta en `ofertas_cadetes`. |
| `valorarPedido(req, res)` | `POST /api/pedidos/valorar` | Body: `{ pedido_id, tipo, estrellas, comentario? }`. `tipo`: `comercio` → `ratings`, `cadete` → `resenas`. Estrellas 1-5. |
| `generarCodigo4Digitos()` | (helper privado) | `crypto.randomInt(0, 10000).padStart(4, '0')` — CSPRNG. |
| `codigosIguales(a, b)` | (helper privado) | Comparación en tiempo constante con `crypto.timingSafeEqual`. |

### `backend/src/controllers/cadeteController.js`
| Función | Ruta | Descripción |
|---------|------|-------------|
| `actualizarUbicacion(req, res)` | `POST /api/cadete/actualizar-ubicacion` | Body: `{ lat, lng, pedido_id? }`. Valida rango GPS (-90/90, -180/180). Verifica rol cadete via `resolveRol`. UPSERT en `ubicacion_cadetes`. |

### `backend/src/controllers/mpController.js`
| Función | Ruta | Descripción |
|---------|------|-------------|
| `crearPreferencia(req, res)` | `POST /api/mp/crear-preferencia` | Body: `{ pedido_id, items, total, propina_cadete? }`. Verifica que pedido pertenece al usuario. Propina máx $10.000. Crea preferencia en MercadoPago. |
| `mpWebhook(req, res)` | `POST /api/mp/webhook` | Sin auth JWT — verifica firma HMAC-SHA256 (`x-signature`). Si `status=approved` → pedido pasa a `pagado`. Retorna 500 en error de DB para que MP reintente. |

### `backend/src/controllers/embajadorController.js`
| Función | Ruta | Descripción |
|---------|------|-------------|
| `getDashboard(req, res)` | `GET /api/embajadores/dashboard` | Retorna: billetera (3 saldos), últimas 50 comisiones, patrocinios con datos comercio, solicitudes retiro. |
| `vincularReferido(req, res)` | `POST /api/embajadores/vincular-referido` | Body: `{ comercioId }`. Llamado por la propia sesión del comercio justo tras registrarse vía link (`?ref=`). Crea la fila en `patrocinios` (la sesión del comercio no puede por RLS) validando server-side que `comercios.usuario_id = req.user.id`. Reemplaza al viejo `agregarComercio`, que creaba comercios sin `usuario_id` (sin login posible). |
| `solicitarRetiro(req, res)` | `POST /api/embajadores/solicitar-retiro` | Body: `{ monto, cbu_alias? }`. Llama RPC `solicitar_retiro_embajador` (atómico, congela saldo). |
| `confirmarPago(req, res)` | `PATCH /api/embajadores/retiro/:id/pagar` | Solo admin. Llama RPC `confirmar_pago_retiro`. |
| `rechazarRetiro(req, res)` | `PATCH /api/embajadores/retiro/:id/rechazar` | Solo admin. Body: `{ motivo? }`. Llama RPC `rechazar_retiro`, devuelve saldo. |
| `registrarComisionSiAplica(pedidoId, comercioId, montoBase)` | (interna) | Fire-and-forget. Busca patrocinio activo, calcula comisión, inserta en `historial_comisiones`, llama RPC `acreditar_comision`. |
| `requireEmbajador(req, res)` | (helper privado) | Verifica rol = `embajador` o `admin`. |

---

## Funciones por archivo — Frontend

### `frontend/assets/js/config.js`
| Función | Descripción |
|---------|-------------|
| `_resolveClient()` | Crea cliente Supabase desde `window.SUPABASE_URL` + `window.SUPABASE_ANON_KEY`. Exporta `supabase`, `USE_MOCK`, `MOCK_DATABASE`. |

### `frontend/assets/js/auth-service.js`
> Recortado en la limpieza del 2026-08-07: tenía 13 exports, 10 sin ningún
> caller en todo el repo (todo el código real usa `sb.auth.X` directo, no
> este wrapper). Quedaron solo los 3 que sí se usan.

| Función | Descripción |
|---------|-------------|
| `initAuthClient()` | Inicializa el cliente Supabase (`window.sb`/`window.supabase`). Dependencia interna de las otras dos. |
| `iniciarLoginGoogleNativo(redirectPathWeb)` | Login con Google — redirect normal en web, browser in-app + deep link en la app nativa Android. |
| `escucharCallbackOAuthNativo(onSuccess)` | Listener del deep link de vuelta de Google en la app nativa. |

### `frontend/assets/js/login.js`
| Función | Descripción |
|---------|-------------|
| `handleLogin()` | Lee email/password, llama `signInWithPassword`, redirige por rol. |
| `redirectPorRol(userId, silencioso)` | Consulta `perfiles.eq('usuario_id', userId)` → obtiene rol → redirige a la ruta correcta. |
| `handleForgot()` | Envía email de recuperación de contraseña. |
| `bindForm()` | Bind del botón login + Enter key. |
| `bindPasswordToggle()` | Toggle mostrar/ocultar password. |
| `bindRegisterMenu()` | Menú desplegable: registrar como comercio, cadete o cliente. |
| `showError(msg)`, `showOk(msg)`, `hideMessages()`, `setLoading(btn, loading)` | Helpers de UI. |

### `frontend/assets/js/cliente.js`
> `cambiarCantMenu`, `selPropina`, `addCartMenu`, `initAutocomplete`,
> `autocompletarDireccion`, `seleccionarDireccion` y la rama de
> "notificaciones" del perfil se borraron en la limpieza del 2026-08-07 —
> código muerto sin ningún caller. El selector de propina en particular
> inyectaba en un contenedor (`#tip-section`) que no existe en el HTML
> actual: `propinaSeleccionada` sigue sumándose al total pero hoy el
> usuario no tiene forma de cambiarla de $0 (gap de producto, no arreglado).

| Función | Descripción |
|---------|-------------|
| **Navegación** | |
| `go(screen)` | Cambia de pantalla (home, pedidos, carrito, tracking, perfil, etc.). |
| **Mapa Leaflet** | |
| `initTrackingMap(cLat, cLng)` | Inicializa mapa Leaflet en la pantalla de tracking. Marker azul = cliente. |
| `moverCadeteEnMapa(lat, lng)` | Mueve el marker 🛵 del cadete. `fitBounds` con 20% padding. Transición CSS suave. |
| **Comercios y catálogo** | |
| `cargarComercios()` | Lee todos los comercios de Supabase. Fallback a datos demo si falla. |
| `renderRubros()` | Renderiza tiles de categorías + cards de comercios. |
| `abrirRubro(catId, label)` | Filtra comercios por categoría. |
| `abrirComercio(id)` | Abre el menú de un comercio con productos y ratings. |
| `filtrar(el, cat)` | Filtro por categoría en la barra de tabs. |
| `buscarTiempoReal(q)` | Búsqueda con debounce 200ms sobre nombre/categoría. |
| `mostrarResultados(lista, q)` | Dropdown de resultados de búsqueda. |
| `cargarRatingsComercio(comercioId)` | Lee ratings del comercio y renderiza barras + comentarios. |
| **Carrito y pedido** | |
| `addCart(id, nombre, precio)` | Agrega producto al carrito. |
| `cambiarQty(id, delta)` | +/- cantidad desde el carrito. |
| `renderCarrito()` | Renderiza items, subtotal, envío, propina, total. |
| `actualizarCartFloat()` | Badge flotante "Ver carrito (N productos)". |
| `confirmarPedido()` | INSERT en `pedidos`, redirige a pago MP o muestra confirmación. |
| **Dirección de entrega** | |
| `cargarDireccionesEnCarrito()` | Carga direcciones guardadas + GPS actual. |
| `selDireccion(tipo)` | Selecciona dirección: GPS, nueva, o guardada. |
| `actualizarDirGPS()` | `navigator.geolocation` → reverse geocoding con Nominatim. |
| `buscarDireccion(q)` | Autocomplete de direcciones con Nominatim. |
| `cargarMapaCarrito(lat, lng)` | Mapa Google en el carrito con pin arrastrable. |
| `getDireccionEntrega()` | Retorna la dirección seleccionada como string. |
| **Tracking del pedido** | |
| `iniciarTracking()` | Suscribe a Realtime (`pedidos` + `ubicacion_cadetes`). Timeline de estados. |
| `fetchPedidoConCadete(pedidoId)` | `GET /api/pedidos/:id` — lee perfil cadete + código entrega. |
| `poblarCadeteCard(pedido)` | Muestra nombre, vehículo y avatar del cadete. |
| `mostrarConfirmado(numPedido)` | Pantalla "Pedido enviado, esperando confirmación". |
| `pedidoConfirmadoPorComercio()` | Pantalla "Pedido confirmado, siendo preparado". |
| `irAlTracking()` | Abre la pantalla de tracking con mapa. |
| **Historial y detalle** | |
| `cargarPedidos()` | Lista últimos 30 pedidos con estado y badge. |
| `verDetallePedido(id)` | Abre detalle de un pedido histórico. |
| `repetirPedido(comercioId)` | Abre el comercio para re-pedir. |
| **Ratings** | |
| `mostrarRating(comercioNombre)` | Modal de calificación con estrellas. |
| `selStar(n)` | Selecciona N estrellas (1-5). |
| `enviarRating()` | INSERT en `ratings`. |
| **Reportes y soporte** | |
| `reportarProblema(tipo)` | Crea reporte + advertencia al comercio + abre chat. |
| `abrirChatReporte(reporteId, tipoLabel, limiteStr)` | Chat en vivo con countdown de 10 min. |
| `enviarMsgReporte()` | Envía mensaje en el chat de reporte. |
| `cargarChatsReporte()` | Lista reportes activos en la sección soporte. |
| **Asistente IA** | |
| `abrirAsistente()` | Abre el chat de asistente IA. |
| `enviarAsistente()` | Envía mensaje al Edge Function `asistente`. |
| **Perfil** | |
| `cerrarSesion()` | Sign out + limpia storage + redirige. |
| `guardarDireccion()` | Guarda dirección nueva en localStorage. |
| `selMetodoPago(m)` | Guarda método de pago preferido. |
| `detectarUbicacion()` | Detecta ubicación GPS actual. |

### `frontend/assets/js/cadete.js`
| Función | Descripción |
|---------|-------------|
| **GPS Reporter** | |
| `iniciarReporteGPS()` | `watchPosition` → `POST /api/cadete/actualizar-ubicacion` cada 10s. |
| `detenerReporteGPS()` | `clearWatch`. Se desactiva con toggle "Inactivo". |
| **Core** | |
| `apiPost(path, body)` | Fetch con Bearer JWT desde la sesión activa. |
| `togDisp()` | Toggle disponible/inactivo. Activa/desactiva GPS. |
| `haversineKm(lat1, lng1, lat2, lng2)` | Distancia en km entre dos coordenadas. |
| `fmtKm(km)` | Formatea: < 1km → metros, >= 1km → "X.X km". |
| **Ofertas** | |
| `cargarOfertas()` | Lee `ofertas_cadetes` WHERE `cadete_id = mi_uid AND estado = pendiente`. |
| `renderViajes()` | Renderiza cards de ofertas con timer 20s + botones aceptar/rechazar. |
| `aceptarViaje(pedidoId)` | `POST /api/pedidos/aceptar`. Maneja 409 (ya tomado). |
| `rechazarOferta(pedidoId)` | Descarta oferta localmente. Limpia timer. |
| **Viaje activo** | |
| `renderTripActivo(container)` | UI según estado: 1=yendo al local, 2=en camino al cliente, 3=finalizado. |
| `confirmarRetiro()` | `POST /api/pedidos/cambiar-estado { nuevo_estado: 'en_camino', codigo_retiro }`. |
| `confirmarEntrega()` | `POST /api/pedidos/cambiar-estado { nuevo_estado: 'entregado', codigo_entrega }`. |
| `validarInputCodigo(btnId, inputId)` | Habilita botón cuando el input tiene 4 dígitos. |
| `suscribirKmCadete(pedidoId, targetLat, targetLng, elementId)` | Realtime: recalcula distancia en vivo. |
| **Timer no-show (10 min)** | |
| `iniciarTimerNoShow()` | Arranca countdown de 10 min con barra roja. |
| `cancelarPorNoShow()` | Fuerza finalización cuando el cliente no aparece. |
| **Vehículo y tarifas** | |
| `calcularGananciaLocal(distanciaKm)` | Base según `cadeteVehiculo`: bici=$1200, moto=$1800 + $250/km. |
| `actualizarSelectorVehiculo()` | UI del selector bici/moto con tarifa base visible. |
| `cambiarVehiculo(tipo)` | Cambia vehículo + persiste en DB + re-renderiza ofertas. |
| `bindVehiculoSelect()` | Show/hide campos de moto (patente, carnet, seguro). |
| **Onboarding** | |
| `verificarOnboarding()` | Si `onboarding_completo = false`, muestra overlay obligatorio. |
| `bindOnboardingForm()` | Submit: sube DNI a Storage, guarda CVU, vehículo, código referido. |
| `obSelVeh(tipo)` | Selector bici/moto en el onboarding. |
| **Historial** | |
| `cargarHistorial()` | Lee pedidos entregados/en_camino del cadete. Renderiza lista. |
| **Documentos** | |
| `previsualizarDNI(input)` | Preview de la foto del DNI antes de subir. |
| `subirDocumento(input, tipo)` | Sube archivo a Supabase Storage (`cadetes-antecedentes`). |
| **Referidos** | |
| `generarCodigoReferido(uid)` | `'PAP-' + uid.slice(0,4).toUpperCase()`. |
| `cargarCodigoReferido()` | Lee o genera el código del cadete. |
| `copiarCodigo()` | Copia al clipboard + toast. |
| **Realtime** | |
| `iniciarRealtimeCadete()` | Suscribe a `ofertas_cadetes` INSERT → suena notificación + recarga. |
| `sonarViaje()` | Tono de 4 notas con Web Audio API. |
| **Stats y perfil** | |
| `actualizarStats()` | Calcula viajes hoy y ganancia del día. |
| **Asistente IA** | |
| `iniciarAsistenteCadete()`, `enviarIACadete()`, `preguntaRapidaCadete(pregunta)` | Chat IA para cadetes. |
| **MercadoPago** | |
| `conectarMPCadete()` | OAuth flow para conectar cuenta MP del cadete (75% directo, pago inmediato). ⚠️ Diseño de pago viejo, sin ningún botón que la llame hoy — el modelo actual es cobro semanal por CVU/alias. Detectada como código muerto en la auditoría del 2026-08-07 pero se decidió no borrarla, podría retomarse. |
| **Simulador** | |
| `simularNuevoViaje()` | Genera oferta falsa para testing local. |

### `frontend/assets/js/embajador.js`
| Función | Descripción |
|---------|-------------|
| `init()` | Verifica sesión, carga dashboard. |
| `bindTabs()` | Tabs: "Mi Embajada" / "Ir a la Tienda". |
| `bindLogout()` | Cierra sesión. |
| `cargarDashboard()` | `GET /api/embajadores/dashboard` → renderiza todo. |
| `renderBilletera(b)` | 3 cards: disponible, acumulado, retirado. |
| `renderRetiros(retiros)` | Lista de solicitudes de retiro con badge de estado. |
| `renderComisiones(comisiones)` | Historial con tasa visible (5% o 2%) y monto. |
| `renderPatrocinios(patrocinios)` | Comercios registrados con meses activo y tasa actual. |
| `bindRetiroModal()` | Modal "Solicitar Retiro": valida saldo, envía a backend. |
| `bindFormAlta()` | Formulario "Armar Link para un Comercio": nombre, rubro, dirección, teléfono, email → genera un link personalizado a `registro-comercio.html` con esos datos precargados (querystring), no crea nada por sí solo — el comercio confirma y pone su contraseña del otro lado. |
| `cargarLinkReferidos()` | Arma el link fijo genérico `registro-comercio.html?ref=<uid>` y lo deja listo para copiar/compartir por WhatsApp. |
| `authFetch(url, opts)` | Fetch con Bearer JWT. |
| `sanitize(str)` | Escapa HTML para prevenir XSS. |

### `frontend/assets/js/comercio.js`
| Función | Descripción |
|---------|-------------|
| **Core** | |
| `init()` | Auth guard + carga comercio + setup Realtime. |
| `navigate(viewName)` | Navegación entre vistas: tablero, pedidos, menu, finanzas, etc. |
| `applyComercioToUI(com)` | Aplica datos del comercio al header y forms. |
| `bindAllEvents()` | Event delegation global para botones y acciones. |
| **Pedidos** | |
| `loadTablero()` | KPIs: pedidos hoy, ingresos, pendientes. |
| `loadPedidos()` | Lista de pedidos con filtros de fecha. |
| `renderPedidosTable(pedidos, advMap, cadetesMap)` | Tabla de pedidos con estado, detalle expandible. |
| `aceptarPedido(id)` | Acepta pedido → llama `/api/pedidos/difundir` para buscar cadetes. |
| `rechazarPedido(id)` | Rechaza pedido. |
| `marcarListo(id)` | Marca como listo para retirar. |
| `detallePedido(p, advs, cadetesMap)` | Renderiza detalle expandible de un pedido. |
| **Menú / Productos** | |
| `loadMenu()` | Carga categorías + productos. |
| `renderCategorias()` | Lista de categorías con tabs. |
| `renderProductos(prods, catId)` | Cards de productos con toggle disponible/no disponible. |
| `openModalProducto(prodId)` | Modal para crear/editar producto con upload de imagen. |
| `saveProducto()` | Guarda producto en Supabase (insert o update). Sube imagen a Storage `productos`. |
| `toggleProducto(inputEl, id)` | Toggle `disponible` true/false. |
| `saveCategoria()` | Crea nueva categoría. |
| **Finanzas** | |
| `loadFinanzas()` | Carga estado financiero + facturas. |
| `loadFinanzasEstado()` | KPIs: ingresos, comisión app, deuda. |
| `renderFacturas(pedidos)` | Tabla de facturas (pedidos entregados). |
| **Horarios** | |
| `loadHorarios()`, `renderHorarios()` | Configuración de horarios por día. |
| `openModalCierre()`, `saveCierre()` | Cierre programado. |
| **Promociones** | |
| `loadPromociones()` | Carga y renderiza promociones activas. |
| `loadMisPromociones()` | Lista promociones del comercio. |
| `pausarPromo(id)`, `eliminarPromo(id)` | Gestión de promos. |
| **Reseñas** | |
| `loadResenas()` | Carga ratings del comercio. |
| `renderResumenResenas(ratings)` | Promedio + barras por estrella. |
| `renderListaResenas(ratings)` | Lista de comentarios. |
| **Realtime** | |
| `setupRealtime()` | Suscribe a cambios en `pedidos` del comercio. |
| `handleRealtimePedido(payload)` | Procesa nuevo pedido → beep + badge + recarga. |
| `playBeep()` | Sonido de notificación con Web Audio. |
| **Config** | |
| `toggleEstado()` | Abierto/cerrado del comercio. |
| `logout()` | Cierra sesión del comercio. |

### `frontend/assets/js/admin-acceso.js`
| Función | Descripción |
|---------|-------------|
| `login()` | Login del admin con email/password + verificación de rol admin. |

### Otros archivos JS
| Archivo | Descripción |
|---------|-------------|
| `main.js` | Bootstrap: carga `config.js`, expone `window.sb`, `window.ICONS`. |
| `state.js` | Estado global del carrito (`window.state.cart`). Persiste en localStorage. |
| `ui.js` | `formatARS(n)`, `sanitizeHTML(str)` — helpers compartidos. |
| `icons.js` | Objeto `ICONS` con SVGs como strings (check, close, scooter, pin, etc.). |

> `login-root.js`, `login-usuario.js`, `order-service.js` y `api.js` ya no
> existen en el repo — quedaban referenciados acá de una versión anterior.
> `login-usuario.js` en particular se borró en la limpieza del 2026-08-07:
> era código huérfano que le pegaba a un endpoint (`/api/auth/login`) que
> nunca existió en el backend. El login real usa `assets/js/login.js` (para
> `/login.html` y `/comercio/login.html`) y la lógica inline de
> `cliente/login-usuario.html`.

---

## Base de datos — Tablas

| Tabla | Descripción | Columnas clave |
|-------|-------------|----------------|
| `perfiles` | Perfil de usuario | `usuario_id` (FK auth.users), `rol`, `nombre`, `apellido` |
| `comercios` | Tiendas | `usuario_id`, `lat`, `lng`, `creado_por_embajador_id`, `estado_registro` |
| `cadetes` | Repartidores | `auth_uid`, `vehiculo` (moto/bici), `cvu`, `foto_dni_url`, `onboarding_completo`, `codigo_referido`, `referido_por` |
| `productos` | Catálogo | `comercio_id`, `nombre`, `precio_base`, `imagen_url`, `disponible` |
| `categorias_producto` | Categorías del menú | `comercio_id`, `nombre` |
| `pedidos` | Órdenes | `cliente_id`, `comercio_id`, `cadete_id`, `estado`, `codigo_retiro`, `codigo_entrega`, `distancia_estimada`, `pago_cadete`, `propina_cadete` |
| `ofertas_cadetes` | Ofertas broadcast | `pedido_id`, `cadete_id`, `distancia_km`, `ganancia_estimada`, `estado` |
| `ubicacion_cadetes` | GPS tiempo real | `cadete_id`, `latitud`, `longitud`, `lat`, `lng`, `pedido_id` |
| `ratings` | Calificaciones comercio | `pedido_id`, `comercio_id`, `usuario_id`, `rating` (1-5) |
| `resenas` | Calificaciones cadete | `pedido_id`, `cadete_id`, `cliente_id`, `rating` (1-5) |
| `reportes` | Reportes de problemas | `pedido_id`, `comercio_id`, `tipo`, `estado`, `limite_resolucion` |
| `chat_reportes` | Chat de reportes | `reporte_id`, `de` (usuario/comercio/sistema), `texto` |
| `promociones` | Promociones activas | `comercio_id`, `tipo`, `porcentaje`, `activa`, `fecha_fin` |
| `patrocinios` | Embajador ↔ Comercio | `embajador_id`, `comercio_id`, `fecha_inicio`, `activo` |
| `historial_comisiones` | Comisión por pedido | `embajador_id`, `pedido_id`, `tasa_aplicada` (0.05/0.02), `monto_comision`, `meses_activo` |
| `billetera_embajador` | Saldo embajador | `saldo_disponible`, `saldo_acumulado`, `saldo_retirado` |
| `solicitudes_retiro` | Retiros | `embajador_id`, `monto`, `estado` (pendiente/pagado/rechazado), `cbu_alias` |

### RPCs atómicas

| Función | Qué hace |
|---------|----------|
| `acreditar_comision(embajador_id, monto)` | UPSERT billetera: incrementa disponible + acumulado |
| `solicitar_retiro_embajador(embajador_id, monto, cbu)` | Valida saldo → crea solicitud → congela monto (FOR UPDATE) |
| `confirmar_pago_retiro(solicitud_id)` | Marca pagado → suma a saldo_retirado |
| `rechazar_retiro(solicitud_id, motivo)` | Rechaza → devuelve monto a saldo_disponible |

### Triggers

| Trigger | Tabla | Acción |
|---------|-------|--------|
| `handle_new_auth_user_create_profile` | `auth.users` | INSERT → crea fila en `perfiles` con rol de `user_metadata` |
| `set_updated_at` | `cadetes`, `comercios` | UPDATE → actualiza `updated_at` |
| `sync_ubicacion_lat_lng` | `ubicacion_cadetes` | INSERT/UPDATE → copia `latitud`→`lat`, `longitud`→`lng` |

---

## Tarifas cadete

> Corregido: la tabla anterior usaba `$250/km`, que fue la tarifa vigente hasta el fix de CHANGELOG v2.7.0. El valor real desde entonces es `$750/km` (verificado en `backend/src/controllers/pedidoController.js`).

| Vehículo | Base | Fórmula | 3 km | 5 km | 10 km |
|----------|------|---------|------|------|-------|
| Bici | $1.200 | `round((base + km × 750) / 50) × 50` | $3.450 | $4.950 | $8.700 |
| Moto | $1.800 | `round((base + km × 750) / 50) × 50` | $4.050 | $5.550 | $9.300 |

Con tarifa clima activa (`cadetes.tarifa_clima = true`), el resultado se multiplica ×1.20 (redondeado a $50). Ver [CLAUDE.md](CLAUDE.md) sección 6.

---

## Comisiones embajador

| Antigüedad del patrocinio | Tasa | Ejemplo ($10.000 venta) |
|---------------------------|------|------------------------|
| < 6 meses | 5% | $500 |
| >= 6 meses | 2% | $200 |

Se calcula dinámicamente comparando `patrocinios.fecha_inicio` vs fecha del pedido.

---

## Errores históricos y soluciones

Errores que surgieron durante el desarrollo y cómo se resolvieron. Útil para evitar repetirlos.

### 1. `ERROR 42703: column "tipo_delivery" does not exist`
**Causa:** El SQL tenía `ADD CONSTRAINT CHECK(tipo_delivery)` ANTES de `ADD COLUMN tipo_delivery`.
**Solución:** Siempre ejecutar `ALTER TABLE ADD COLUMN IF NOT EXISTS` antes de cualquier `ADD CONSTRAINT` que referencie esa columna.

### 2. `ERROR 42703: column "usuario_id" does not exist` (en perfiles)
**Causa:** La tabla `perfiles` original tenía `id = auth.users.id` (PK = FK). La migración agregó `usuario_id` como columna separada, pero los constraints se ejecutaron antes de que la columna existiera.
**Solución:** Agregar columna sin FK/UNIQUE primero, backfill `SET usuario_id = id WHERE usuario_id IS NULL`, luego constraints en bloque `DO $$ EXCEPTION`.

### 3. `ERROR 42703: column "usuario_id" does not exist` (en ratings)
**Causa:** La tabla `ratings` existía en Supabase sin columna `usuario_id`, pero una política RLS la referenciaba.
**Solución:** `ALTER TABLE ratings ADD COLUMN IF NOT EXISTS usuario_id uuid` antes de crear la política.

### 4. `ERROR 42P07: relation already exists` (en constraints)
**Causa:** `EXCEPTION WHEN duplicate_object` no atrapa `42P07` (que es `duplicate_table` no `duplicate_object`).
**Solución:** Usar `EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;` para atrapar todos los errores de duplicados.

### 5. Bug en `authController.js`: upsert en perfiles con PK random
**Causa:** `.upsert({ id: req.user.id, rol: role }, { onConflict: 'id' })` — pero `perfiles.id` es un UUID random, no `auth.users.id`.
**Solución:** Cambiar a `{ usuario_id: req.user.id }` con `{ onConflict: 'usuario_id' }`.

### 6. Bug en `login.js`: query a perfiles con columna incorrecta
**Causa:** `perfiles.eq('id', userId)` — funciona para usuarios viejos (id = auth.uid) pero falla para nuevos (id = random UUID).
**Solución:** Cambiar a `.eq('usuario_id', userId)`.

### 7. `backend/server.js` monolítico no ejecutable
**Causa:** Usaba CommonJS (`require()`) pero `package.json` tiene `"type": "module"`.
**Solución:** Se portaron todos los endpoints al sistema modular `backend/src/` con ES modules y se eliminó el archivo raíz.

### 8. Un fix real perdido en un `git stash` de otra rama (2026-09-01)

**Causa:** el fix del crash de push (ver ítem 9) se escribió y se probó en una sesión anterior, pero quedó sin commitear, guardado en un stash sobre una rama de trabajo sin mergear. `main` nunca lo recibió. Como los builds de Play Store se arman desde `main`, se subieron 4 versiones seguidas (16 a 19) con un crash conocido y ya resuelto adentro, mientras el tester lo reportaba una y otra vez.
**Solución:** se recuperó del stash y se aplicó a `main`.
**Regla:** antes de armar un build para Play Store, correr `git status`, `git stash list` y `git log --oneline main..<rama>` y confirmar que no hay fixes varados. Un fix que no está en `main` no existe para producción. A la fecha **todavía quedan 8 commits sin mergear** en `work/2026-08-20-google-elegir-rol`, uno de ellos otro fix de crash de login con Google.

### 9. Crash nativo al loguearse: `Default FirebaseApp is not initialized`

**Causa:** `registrarPushNativa()` (`push.js`) llamaba a `PushNotifications.register()` sin que Firebase estuviera configurado (falta `google-services.json`). Del lado nativo eso llama a `FirebaseMessaging.getInstance()`, que tira `IllegalStateException` y **mata el proceso entero**.
**Por qué el `try/catch` no servía:** la excepción ocurre dentro del puente nativo de Capacitor (`Bridge.java`, invocación por reflection), antes de que el control vuelva a JS. Ningún `try/catch` de JavaScript la puede atajar.
**Solución:** `registrarPushNativa()` retorna de entrada, sin llamar a `register()`, hasta que Firebase esté configurado de verdad. No se pierde nada: las push nativas nunca funcionaron.
**Regla:** no asumir que un `try/catch` en JS protege de todo lo que hace un plugin de Capacitor. Los crashes de proceso solo se ven con reporte nativo (Sentry), no en la consola del navegador.

### 10. Overlay invisible que se traga todos los toques

**Causa:** `.sidebar-overlay` quedaba en `display:block` dentro del media query de mobile sin depender de la clase `.show`. Un `div` transparente a pantalla completa por encima del contenido, permanente.
**Síntoma engañoso:** el usuario reporta que "no anda nada", pero lo que pasa es que los toques nunca llegan a los botones. Los únicos controles que responden son los que tienen un `z-index` mayor que el del overlay.
**Cómo detectarlo:** `document.elementFromPoint(x, y)` sobre el botón que no responde. Si devuelve otro elemento, hay algo tapándolo. Ojo: `elemento.click()` desde la consola **sí** funciona aunque el botón esté tapado, porque saltea el hit-testing — por eso este bug se puede escapar en una prueba automatizada mal hecha.

### 11. `textContent` sobre un contenedor borra sus hijos

**Causa:** `boton.textContent = 'texto'` sobre un botón que tenía adentro un `<span>` con un ícono y otro con el texto. Asignar `textContent` reemplaza **todo** el contenido del nodo, incluidos los hijos.
**Solución:** escribir en el span interno, nunca en el contenedor.

### 12. El botón físico de atrás de Android no hace nada

**Causa:** una SPA que cambia de pantalla con clases CSS, sin `pushState`, no le da a Android ninguna pantalla anterior a la que volver. Sin un listener de `backButton` del plugin `@capacitor/app`, el botón de atrás o no hace nada (parece que la app se colgó) o cierra la app entera.
**Solución:** registrar el listener y manejar la pila de pantallas a mano: cerrar lo más específico primero, después volver a la pantalla principal, y recién ahí salir.

### 13. Una precarga que corre antes de que existan los datos

**Causa:** el bloque que llenaba el formulario de Perfil corría una sola vez al cargar el script, o sea antes de que el onboarding guardara nada, y no se volvía a llamar nunca. El formulario quedaba vacío para siempre aunque los datos ya estuvieran en la base.
**Solución:** extraer a una función nombrada y llamarla también después de guardar y al entrar a la pestaña.
**Regla:** ojo con el código de inicialización a nivel de módulo que depende de estado que todavía no existe. En este proyecto los guards de sesión corren al final del archivo, así que cualquier variable global que ellos setean (por ejemplo `cadeteUserId`) está en `null` para el código de arriba.

### Regla general para SQL en Supabase
Toda migración debe seguir este patrón:
```sql
-- 1. Crear tabla si no existe
CREATE TABLE IF NOT EXISTS public.foo (...);

-- 2. Agregar columnas faltantes (ANTES de constraints)
ALTER TABLE public.foo ADD COLUMN IF NOT EXISTS bar uuid;

-- 3. Constraints en bloque con exception handler
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.foo ADD CONSTRAINT foo_bar_fkey
      FOREIGN KEY (bar) REFERENCES auth.users(id);
  EXCEPTION WHEN duplicate_object THEN NULL; WHEN OTHERS THEN NULL;
  END;
END; $$;
```

---

## Reglas de seguridad (no negociables)

1. **Secretos solo en server:** `SUPABASE_SERVICE_ROLE_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` solo en `process.env`.
2. **Rol via backend:** El frontend NO puede auto-asignarse roles. Siempre via `POST /api/auth/set-role`.
3. **Anti-colisión:** `.is('cadete_id', null)` en el UPDATE de aceptar pedido.
4. **Tarifa inmutable:** `distancia_estimada` y `pago_cadete` se copian de `ofertas_cadetes` al aceptar. Read-only para el cliente.
5. **Códigos CSPRNG:** `crypto.randomInt(0, 10000)` — validados con `crypto.timingSafeEqual`.
6. **HMAC webhook:** Firma SHA256 verificada antes de procesar pagos.
7. **CORS allowlist:** Solo orígenes de `FRONTEND_URL`.
8. **Idempotencia del webhook MP:** antes de crear un pedido nuevo se chequea si ya existe uno con ese `mp_payment_id` — reintentos/duplicados de MercadoPago no crean pedidos repetidos.
9. **Rate limiting + helmet:** `server.js` aplica `helmet()` (headers de seguridad) y `express-rate-limit` (300 req/min general, 20 req/15min en `/api/auth/register` y `/api/auth/admin/crear-usuario`).

---

## Tabla `perfiles` — AVISO IMPORTANTE

```javascript
// CORRECTO — usuario_id es el FK a auth.users
.from('perfiles').eq('usuario_id', req.user.id)

// MAL — id es un UUID random, no el auth UID
.from('perfiles').eq('id', req.user.id)
```

---

## Variables de entorno

### Backend (`backend/.env`)
```env
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
MP_ACCESS_TOKEN=APP_USR-...
MP_WEBHOOK_SECRET=...
FRONTEND_URL=https://tuapp.vercel.app    # Varios separados por coma
SERVER_URL=https://api.tuapp.com
PORT=3000
```

### Frontend (`frontend/env.js`)
```javascript
window.SUPABASE_URL      = 'https://xxxxx.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJ...';
window.BACKEND_URL       = 'https://api.tuapp.com';
```

---

## Setup local

```bash
# Backend
cd backend
cp .env.example .env
npm install
npm start                   # http://localhost:3000

# Frontend
cd frontend
cp env.js.template env.js   # Completar keys
npx serve -l 8000           # o python -m http.server 8000

# Base de datos
# Supabase Dashboard → SQL Editor → pegar schema-definitivo-v2.sql → Run
```

## Setup Supabase (manual en Dashboard)

1. **Auth → Providers → Google** — Client ID/Secret de Google Cloud Console
2. **Database → Replication** — Realtime para: `ofertas_cadetes`, `pedidos`, `ubicacion_cadetes`, `mensajes_pedido`
3. **Storage** — bucket `cadetes-antecedentes` (privado), bucket `productos` (público)
4. **Comercios** — cargar `lat`/`lng` en al menos 1 comercio

## Deploy producción

| Servicio | Plataforma | Root | Start |
|----------|-----------|------|-------|
| Backend | Railway | `backend/` | `npm start` |
| Frontend | Vercel (`pa-px2.vercel.app`) | `frontend/` | Sin build, output: `.` |
| DB | Supabase | — | SQL en Dashboard |

Post-deploy: actualizar `FRONTEND_URL` en Railway y `BACKEND_URL` en `frontend/env.js`.

> Confirmado en vivo (2026-07-13): `pa-px2.vercel.app` responde con header `Server: Vercel` y sirve el mismo HTML que `frontend/index.html` de este repo — sigue siendo el hosting real, conectado a este repo, y se actualiza con cada `git push` a `main`. `vercel.json`/`_redirects` fueron eliminados (CHANGELOG v2.6.0) pero no hacían falta para el preset "Other" que usa este proyecto.
