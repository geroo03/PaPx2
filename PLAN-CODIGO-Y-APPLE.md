# Plan de cierre — código al 100% + Apple

> Escrito el 2026-09-02, verificado contra el código real (no contra notas viejas).
> Complementa a [`PENDIENTES-LANZAMIENTO.md`](PENDIENTES-LANZAMIENTO.md), que cubre
> el checklist administrativo de Play Console. Este archivo cubre **solo lo que
> es trabajo de código**, más el plan de Apple al final.
>
> Estado del que parte: `main` en `de0476c`, versión 20 en Play Store (Prueba
> cerrada — Alpha), backend y web en producción funcionando.

---

## Índice

- [Parte 1 — Terminar el código](#parte-1--terminar-el-código)
  - [Fase 0 — Recuperar el trabajo varado (bloqueante)](#fase-0--recuperar-el-trabajo-varado-bloqueante)
  - [Fase 1 — Agujeros que la UI ya promete pero el código no cumple](#fase-1--agujeros-que-la-ui-ya-promete-pero-el-código-no-cumple)
  - [Fase 2 — Features a medio construir](#fase-2--features-a-medio-construir)
  - [Fase 3 — Deuda que no bloquea el lanzamiento](#fase-3--deuda-que-no-bloquea-el-lanzamiento)
- [Parte 2 — Apple / iOS](#parte-2--apple--ios)

---

# Parte 1 — Terminar el código

## Fase 0 — Recuperar el trabajo varado (bloqueante)

**Por qué primero:** hay un fix de crash que producción nunca recibió. Es el
mismo patrón que hizo que la app crasheara al loguearse durante 4 builds
seguidas (ver README → "Errores históricos" ítem 8). Mientras esto siga
pendiente, cualquier build nueva sale incompleta.

La rama `work/2026-08-20-google-elegir-rol` tiene 8 commits sin mergear.
**No se puede mergear derecho**: la rama es anterior a los fixes de esta
sesión, así que un merge revertiría el fix del crash de push y la migración
del rating. Hay que ir commit por commit.

### 0.1 — Cherry-pick de los 3 commits que entran limpios

Estos tocan archivos que **no** se modificaron en la sesión del 2026-09-01,
así que no deberían dar conflicto:

| Commit | Qué es | Archivos |
|---|---|---|
| `c3614a8` | **Fix de crash del login con Google** (carrera de doble redirect) | `auth-service.js`, `login.js`, `registro-cadete.html`, `login-usuario.html`, `registro-comercio.html` |
| `4728e3e` | Fix: "Convertite en Cadete" no aparecía + opción fija en Perfil | `cliente/index.html` |
| `cb479fa` | Feature: al loguearte con Google sin cuenta previa, preguntar qué querés ser | `login.js` |

```bash
git checkout main
git cherry-pick c3614a8 4728e3e cb479fa
node --check frontend/assets/js/login.js
node --check frontend/assets/js/auth-service.js
```

**Cuidado:** `c3614a8` y `cb479fa` tocan los dos `login.js`. Aplicarlos en ese
orden (primero el fix, después el feature) para que el segundo se apoye en el
primero.

**Verificación obligatoria antes de dar esto por hecho:** probar el login con
Google de punta a punta en un dispositivo real, en los 3 flujos (cliente,
cadete, comercio). Es un fix de crash de login: si sale mal, nadie entra a la
app. No alcanza con que compile.

### 0.2 — GPS en segundo plano + splash (`93a1ae7`) — necesita resolución manual

Este **sí va a dar conflicto**: toca `cadete.js`, que se reescribió bastante en
la sesión del 2026-09-01 (mapa embebido, precarga de perfil, sonido, botón de
atrás). Suma 91 líneas nuevas a `cadete.js`, más `capacitor.config.json`,
`package.json` (un plugin nuevo) y las imágenes de splash en `resources/`.

Decisión previa a tomar: **GPS en segundo plano estaba en la lista de "en pausa
explícita"** de CLAUDE.md §13. Alguien lo construyó igual en esa rama. Hay que
decidir si entra ahora o se descarta, porque no es gratis: el permiso de
ubicación en segundo plano es uno de los que Google Play revisa con lupa y pide
justificación por escrito en el formulario de permisos sensibles. Puede sumar
fricción a la aprobación.

- **Si entra:** cherry-pick con resolución manual de `cadete.js`, y sumar la
  declaración del permiso en Play Console.
- **Si no entra:** rescatar solo el splash (`resources/*.png` +
  `capacitor.config.json`), que es inofensivo y mejora la percepción de
  arranque.

### 0.3 — Limpiar el stash y cerrar la rama

Queda un `git stash` con el `defer` de Leaflet en `cliente/index.html`,
`comercio.html` y `registro-comercio.html` (mitigación de carga en celulares
lentos, no llegó a main). Revisarlo, aplicar lo que sirva, y **borrar la rama y
el stash** para que no vuelva a pasar lo mismo.

---

## Fase 1 — Agujeros que la UI ya promete pero el código no cumple

Todo esto es funcionalidad que el usuario **ya ve ofrecida en pantalla** y que
hoy no hace lo que dice. Es lo más urgente después de la Fase 0, porque
erosiona la confianza del que la usa.

### 1.1 — Panel de admin: ver los documentos de los cadetes

**Estado:** el cadete sube DNI (y carnet + seguro si es moto) y la pantalla le
dice *"Se usa para verificar tu identidad"*. **Nadie puede verlos.**
`admin.html` → `loadCadetes()` incluso **ya pide `foto_dni_url` en la consulta
y lo descarta** sin usarlo.

**Qué hacer:** agregar una columna o botón "Ver documentos" en la tabla de
cadetes que abra un modal con las 3 imágenes. El bucket
`cadetes-antecedentes` es privado, así que hace falta `createSignedUrl` — el
patrón ya está resuelto en `cadete.js` → `mostrarFotoDniGuardada()`, se puede
copiar. Verificar que la policy de Storage deje leer al admin (hoy está
restringida por carpeta = `auth.uid()`, es probable que haya que sumar una
excepción para el rol admin).

**Tamaño:** chico. Es web pura, no necesita build nativo ni migración.

### 1.2 — Panel de admin: ver los reportes de problemas

**Estado:** desde el 2026-09-01 el botón de reportar del cadete **sí** guarda en
la tabla `reportes`. Pero no hay ninguna pantalla que los lea, así que hoy es un
buzón sin destinatario. La tabla también recibe reportes del cliente
(`cliente.js` inserta ahí).

**Qué hacer:** pestaña nueva en `admin.html` que liste `reportes` (con
`pedido_id`, quién lo hizo, motivo, descripción, estado) y permita marcarlos
resueltos. La policy `reportes_admin_all` ya existe.

**Tamaño:** chico-medio.

### 1.3 — Carrusel de banners del admin apunta a la tabla equivocada

**Estado:** confirmado leyendo el código. `admin.html` (líneas ~659, ~722,
~724) hace `from('patrocinios')` con `orden`, `titulo`, `imagen_url`,
`link_oferta`. Pero `patrocinios` se redefinió como la relación
embajador↔comercio, y los banners se migraron a la tabla **`banners`** (que
tiene exactamente esas columnas). En el mismo archivo, la línea 488 ya usa
`patrocinios` correctamente como relación — o sea, el archivo usa la misma
tabla con dos significados distintos.

**Qué hacer:** cambiar las 3 consultas del carrusel de `patrocinios` a
`banners`. Antes, confirmar en Supabase si el carrusel del home del cliente
está roto hoy o si hay algo compensando.

**Tamaño:** muy chico, pero verificar primero en producción qué se rompió.

### 1.4 — Los opcionales de productos no existen para el cliente

**Estado:** el comercio puede crear grupos de opcionales (agrandar, extras,
sacar ingredientes) desde su panel, incluso importarlos por CSV. **El cliente
nunca los ve.** Confirmado: ni `cliente.js` ni `cliente/index.html` mencionan
`grupos_opcionales` ni `opciones_items` en ningún lado.

Es la brecha funcional más grande que queda: un comercio carga sus opcionales,
los ve guardados, y ningún pedido los refleja jamás.

**Qué hacer:**
1. Al abrir un producto en el cliente, traer sus grupos y opciones.
2. UI de selección respetando `min`/`max` por grupo (obligatorio vs opcional).
3. Sumar `precio_adicional` al precio del ítem (ojo: el recargo del 20% se
   aplica al mostrar, no se persiste — mismo criterio que el precio base).
4. Guardar la selección en el snapshot de `pedidos.productos`.
5. Mostrarla al comercio en el detalle del pedido y al cadete en su card.

**Tamaño:** el más grande de la Fase 1. Toca cliente, el cálculo de precios y
lo que ven comercio y cadete. Es también el que más valor entrega.

> **Nota de negocio:** conviene decidir si esto entra antes o después del
> lanzamiento. Sin esto, un comercio de comidas con variantes (pizzas por
> tamaño, hamburguesas con agregados) no puede vender bien. Con esto, el
> catálogo se vuelve realmente usable.

---

## Fase 2 — Features a medio construir

Cosas visiblemente marcadas como "Próximamente" en la UI. No están rotas: están
apagadas a propósito. Entran acá para que quede explícito qué falta para
prenderlas.

| Qué | Dónde | Estado real |
|---|---|---|
| **Crear promociones** (comercio) | `comercio.html` líneas 387, 548, 581 | La UI de lectura existe; la creación está bloqueada con `pointer-events:none`. Falta el CRUD y decidir cómo impacta en el precio |
| **Administración de usuarios** (comercio) | `comercio.html` línea 684 | Tarjeta deshabilitada. Sería para que un comercio tenga varios empleados con acceso |
| **Permiso de procesamiento de pedidos** | `comercio.html` línea 695 | Deshabilitado |
| **Foto de portada** (comercio) | `comercio.html` línea 706 | Deshabilitado |
| **Favoritos** (cliente) | `cliente/index.html` línea 370 | Muestra "Próximamente" |
| **Grupo familiar** (cliente) | `cliente/index.html` línea 375 | Muestra "Próximamente" |
| **Notificaciones** (cliente) | `cliente/index.html` línea 384 | Muestra "Próximamente" |

**Recomendación:** para el lanzamiento no hace falta ninguna. Lo que sí conviene
es **decidir si se dejan visibles en gris o se ocultan**. Una app nueva llena de
botones apagados da sensación de producto incompleto; ocultarlos es un cambio de
CSS de 10 minutos y se ven mejor.

---

## Fase 3 — Deuda que no bloquea el lanzamiento

### 3.1 — Firebase / FCM (push notificaciones nativas)

Hoy **las push nativas están desactivadas por código a propósito**:
`registrarPushNativa()` retorna de entrada, porque llamarla sin Firebase
configurado crasheaba la app entera (README → "Errores históricos" ítem 9).

Para prenderlas hace falta, en orden:
1. Crear (o encontrar) el proyecto de Firebase para `com.puertaapuertax.app`.
   **Antes de crear uno nuevo, revisar si ya existe**: hay una API key de
   Firebase huérfana en el historial de git que sugiere un intento anterior.
2. `google-services.json` en `android/app/` + plugin de Gradle
   (`android/app/build.gradle` ya tiene el bloque condicional listo).
3. Sacar el `return` temprano de `registrarPushNativa()`. Ese es todo el cambio
   de JS.
4. Backend: `pushController.js` hoy manda solo Web Push (VAPID). Para nativo
   necesita FCM API v1 con el Admin SDK, y una tabla para los tokens nativos.

**Ojo:** para iOS esto además necesita el certificado APNs de la cuenta de
Apple Developer, así que conviene coordinarlo con la Parte 2.

### 3.2 — Pasarela de pagos (Payway / Getnet)

A cargo de Fabri. Hay un esqueleto WIP y está bloqueado esperando credenciales
de sandbox. **No tocar sin que él avance.** Dato ya confirmado y que conviene no
volver a averiguar: el webhook de Getnet usa Basic Auth, no HMAC como asumía el
código WIP.

### 3.3 — Seguridad menor

- Deshabilitar la `GMAPS_KEY` vieja, que vive en otro proyecto de Google Cloud y
  nunca tuvo restricciones. La app ya no la usa.
- Restringir la API key de Firebase que quedó en el historial de git (por
  referrer HTTP + scope de API). Riesgo bajo, pero cobra sentido cuando se
  active Firebase en 3.1.

### 3.4 — Higiene de datos de prueba en producción

Antes de abrir al público real hay que decidir qué pasa con: el comercio de
muestra "Sabores del Centro" y sus 5 productos, los fixtures de `qa-e2e.mjs`
marcados como activos (compiten con comercios reales en el home), el cadete de
prueba, y un pedido de prueba congelado en `en_camino` para siempre. La cuenta
del revisor de Google **no se toca** mientras la app pueda ser re-revisada.

---

## Orden recomendado

```
Fase 0  ──►  1.3 (chico, arregla algo roto)  ──►  1.1 + 1.2 (admin, web puro)
                                                        │
                                                        ▼
                                             1.4 (opcionales, el grande)
                                                        │
                                                        ▼
                                    Fase 2: decidir qué ocultar (10 min)
```

La Fase 3 corre en paralelo o después: no bloquea el lanzamiento.

**Un detalle de logística que ahorra tiempo:** 1.1, 1.2 y 1.3 son del panel de
admin, que es **web puro y no viaja dentro del `.aab`**. Se pueden shippear con
solo pushear a `main`, sin build nativo ni actualización de los testers. La 1.4
sí toca la app del cliente y necesita build nuevo.

---

# Parte 2 — Apple / iOS

**Estado de partida:** `@capacitor/ios` ya está en `package.json`, y la carpeta
`ios/` se generó una vez desde Windows (2026-08-11) pero **sin `pod install`
real**, porque CocoaPods no corre en Windows. Como `ios/` está en `.gitignore`,
lo más probable es que haya que regenerarla desde cero en la Mac.

**La Mac ya está disponible (2026-09-02)** — este es el momento de arrancar.

> Realidad temporal: el camino de Apple es **más largo que el de Android**, no
> por el código sino por los trámites. La cuenta de desarrollador puede tardar
> días en verificarse, y la revisión de App Store es humana y suele rebotar la
> primera vez. Conviene arrancar los trámites **ya**, en paralelo con la Parte 1,
> aunque el código todavía no esté al 100%.

## Etapa A — Trámites (arrancar primero, tienen espera)

1. **Apple Developer Program — 99 USD/año.** Si la cuenta va a nombre de una
   empresa hace falta el número D-U-N-S, que es un trámite aparte y puede tardar
   **hasta 2 semanas**. A nombre de persona física es más rápido pero la ficha
   muestra tu nombre personal como desarrollador. **Decidir esto antes de pagar:
   cambiar de individual a organización después implica rehacer la cuenta.**
2. **Verificación de identidad** de Apple.
3. Crear la app en **App Store Connect** con el bundle id
   `com.puertaapuertax.app` (el mismo que Android, conviene mantenerlo).

## Etapa B — Preparar el proyecto en la Mac

```bash
# En la Mac, con Xcode instalado y el repo clonado
npm install
npx cap add ios          # regenera ios/ y corre pod install de verdad
npx cap sync ios
npx cap open ios         # abre Xcode
```

Después de regenerar `ios/` hay que **reaplicar 3 ajustes manuales** que se
pierden porque la carpeta no está versionada (detalle en
[`docs/IOS-BUILD.md`](docs/IOS-BUILD.md)):

1. **Permisos en `Info.plist`** con textos en español explicando el porqué:
   cámara (foto de DNI y de productos), ubicación en uso (dirección de entrega y
   seguimiento del cadete), y fototeca si se permite elegir imagen existente.
   **Apple rechaza builds con textos genéricos o vacíos** — tienen que explicar
   el uso real.
2. **Deep link de Google OAuth**: el esquema `com.puertaapuertax.app://` en
   `CFBundleURLTypes`, igual que en Android. Sin esto, el login con Google
   vuelve a un limbo.
3. **Capabilities de push** (si para entonces está hecho el punto 3.1):
   Push Notifications + Background Modes → Remote notifications.

## Etapa C — Ajustes de código específicos de iOS

El código es el mismo, pero hay diferencias reales que conviene revisar antes de
la primera build, y **todas se pueden mirar desde ahora sin la Mac**:

- **Safe areas**: iPhone con notch/Dynamic Island. El proyecto ya tiene
  `safe-area.css` y la regla de `viewport-fit=cover`, así que debería estar
  cubierto — pero hay que verificarlo en el simulador, sobre todo la barra de
  navegación inferior del cliente y los headers fijos.
- **`100dvh`**: ya está usado con fallback a `100vh`. Safari iOS es el navegador
  donde más importa; verificar que no queden huecos al aparecer/desaparecer la
  barra de direcciones.
- **Zoom automático al enfocar inputs**: ya está resuelto (todos los campos
  tienen `font-size:16px`), verificado el 2026-09-01. Mantener esa regla en
  cualquier campo nuevo.
- **Botón físico de atrás**: iOS **no tiene**. El fix del 2026-09-01 usa
  `App.addListener('backButton')`, que en iOS simplemente no dispara. No rompe
  nada, pero significa que en iOS **los botones de "Volver" en pantalla son la
  única salida** — hay que verificar que todas las pantallas y paneles tengan
  uno visible. En iOS también se espera el gesto de swipe desde el borde
  izquierdo, que esta app no implementa: evaluar si vale agregarlo.
- **Geolocalización**: iOS pide el permiso de otra forma y es más estricto con
  el uso en segundo plano. Si el GPS en segundo plano del punto 0.2 entra, en
  iOS necesita justificación aparte y suele ser motivo de rechazo si no está
  bien argumentado.
- **MercadoPago**: verificar que el flujo de pago (que sale de la app y vuelve)
  funcione con el navegador in-app de iOS.

## Etapa D — Assets que faltan

- **Ícono 1024×1024 sin transparencia y sin esquinas redondeadas** (Apple las
  redondea solo, y rechaza los que ya vienen redondeados). Hoy **no hay una
  fuente cuadrada de ese tamaño en el repo** — hay que generarla desde
  `frontend/assets/img/logo-original.png`.
- **Capturas de pantalla** en los tamaños que pide App Store Connect: 6.7"
  (iPhone 15/16 Pro Max) y 6.5" como mínimo. Se sacan del simulador.
- Textos de la ficha: se pueden reusar los de Play Store, adaptados.

## Etapa E — Build, TestFlight y revisión

1. Build de archivo en Xcode → subir a App Store Connect.
2. **TestFlight** es el equivalente de la prueba cerrada de Android, pero **sin
   el requisito de 12 testers × 14 días** que tiene Google. Es bastante más
   rápido para probar.
3. Enviar a revisión. Prepararse para lo que Apple mira con más atención en una
   app así:
   - **Cuenta de prueba funcionando** en las notas del revisor (igual que
     Google; ojo con el rol de esa cuenta, ya nos pasó de que quedara mal).
   - **Textos de permisos** justificados (Etapa B punto 1).
   - **Pagos**: los bienes físicos con pasarela externa están permitidos —
     entregar comida es exactamente eso, no requiere compras in-app. Si alguna
     vez se venden suscripciones o beneficios digitales, ahí sí Apple exige su
     sistema de pagos con su comisión.
   - **Guideline 4.2 ("mínima funcionalidad")**: Apple rechaza apps que son
     solo un sitio web envuelto. Esta app usa GPS, cámara, mapa en vivo y push,
     así que hay argumentos sólidos, pero conviene que la primera build ya los
     tenga funcionando y visibles.

## Riesgo principal de la Parte 2

El rechazo de la primera revisión es común y cada ida y vuelta con Apple suma
días. Los dos motivos más probables acá son los **textos de permisos** y la
**cuenta de prueba que no funcione**. Los dos son baratos de prevenir y caros de
descubrir después.
