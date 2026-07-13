# Puerta a Puerta

Plataforma de delivery en tiempo real para Santiago del Estero, Argentina.
Conecta 5 roles: **cliente**, **comercio**, **cadete** (repartidor), **embajador** y **admin**.

> ⚠️ **Para IAs:** este README quedó desactualizado en varios puntos (deploy del frontend, tarifas de cadete, endpoints nuevos de efectivo/liquidaciones, Capacitor). **[`CLAUDE.md`](CLAUDE.md) es la fuente de verdad actualizada** — leerlo primero. Este archivo se mantiene como introducción general y detalle de funciones por archivo, pero ante cualquier contradicción con CLAUDE.md, confiar en CLAUDE.md.

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
│   │   ├── admin-acceso.html
│   │   └── crear-embajador.html
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
| `agregarComercio(req, res)` | `POST /api/embajadores/comercios` | Body: `{ nombre, direccion, rubro, telefono?, email?, lat?, lng? }`. Crea comercio + patrocinio. Estado: `pendiente`. |
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
| Función | Descripción |
|---------|-------------|
| `initAuthClient()` | Inicializa `window.supabase` desde CDN. |
| `getClient()` | Retorna el cliente Supabase. |
| `signInWithPassword({ email, password })` | Login con email/password. |
| `signUp({ email, password, options })` | Registro directo con Supabase Auth. |
| `signUpAndAssignRole({ email, password, full_name, role })` | Registro + asignación de rol via `/api/auth/set-role`. |
| `signInWithOAuth(provider, opts)` | Login con Google/OAuth. |
| `getSession()` | Obtiene sesión activa. |
| `resetPasswordForEmail(email, opts)` | Envía email de recuperación. |
| `signOut()` | Cierra sesión. |
| `logout(redirectTo)` | Cierra sesión + limpia storage + redirige. |
| `verifyUserRole(session)` | Lee rol de `session.user.user_metadata.role`. |

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
| `cambiarCantMenu(id, nombre, precio, delta)` | +/- cantidad desde el menú. |
| `cambiarQty(id, delta)` | +/- cantidad desde el carrito. |
| `renderCarrito()` | Renderiza items, subtotal, envío, propina, total. |
| `selPropina(amt)` | Selector de propina: $0, $200, $500, $1000. |
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
| `conectarMPCadete()` | OAuth flow para conectar cuenta MP del cadete. |
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
| `bindFormAlta()` | Formulario "Agregar Comercio": nombre, dirección, rubro, teléfono, email. |
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

### `frontend/assets/js/login-root.js`
| Función | Descripción |
|---------|-------------|
| `setTab(tab)` | Switch entre tab login / registro. |
| `setRole(role)` | Selecciona rol en el registro (comercio, cadete, usuario). |
| `loginGoogle()` | OAuth con Google. |
| `submitForm()` | Login o registro según tab activo + asignación de rol via backend. |
| `olvideClave()` | Envía email de recuperación. |
| `initSessionCheck()` | Si ya hay sesión, redirige automáticamente. |

### `frontend/assets/js/login-usuario.js`
| Función | Descripción |
|---------|-------------|
| `handleLoginSubmit(e)` | Login del cliente con email/password. |
| `attachListeners()` | Bind de eventos del formulario. |

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
| `order-service.js` | Helpers de pedidos (legacy). |
| `api.js` | Fetch helpers (legacy). |

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
| Frontend | ⚠️ Sin confirmar (ver nota abajo) | `frontend/` | Sin build, output: `.` |
| DB | Supabase | — | SQL en Dashboard |

Post-deploy: actualizar `FRONTEND_URL` en Railway y `BACKEND_URL` donde corresponda.

> ⚠️ Esta tabla decía "Vercel", pero `vercel.json` y `_redirects` fueron eliminados del repo (CHANGELOG v2.6.0) por romper el deploy. Además el proyecto ahora empaqueta `frontend/` como `webDir` de Capacitor para la app nativa. No está confirmado si Vercel sigue siendo el hosting web actual — confirmar con el usuario antes de asumirlo o dar instrucciones de deploy.
