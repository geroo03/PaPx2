# Pendientes de lanzamiento — checklist para vos

> Esto es solo para vos (y para Fabri). No es documentación técnica del
> proyecto — para eso está `CLAUDE.md`. Acá va nada más lo que falta hacer
> a mano para lanzar, en orden de prioridad. Lo que dice "hecho" ya está
> resuelto en el código, no hace falta que lo toques.

---

## 1. 🔴 Crear la cuenta de Google Play Console — HACELO YA

Es lo más urgente de toda la lista, aunque no parezca "técnico". Google exige
a las cuentas de desarrollador **nuevas** pasar un track de **Closed Testing**
(mínimo ~20 testers que acepten, 14 días corridos) antes de habilitar
Production. Como todavía no existe la cuenta, esos 14 días ni arrancaron —
es lo que más atrasa la fecha real en que la app puede estar pública en Play
Store, más que cualquier otra cosa de esta lista.

- Entrá a [play.google.com/console](https://play.google.com/console) y creá
  la cuenta ($25, pago único).
- Elegí cuenta **Personal** (no Organización — esa pide D-U-N-S y tarda
  semanas), salvo que ya tengan una entidad legal registrada para esto.
- La verificación de identidad de Google puede tardar de horas a días.
- Apenas esté creada, avisame — ahí arranca el resto del workstream de Play
  Store (ficha, capturas, Data Safety, etc.), y hay varias cosas que puedo
  redactar por vos (descripción de la ficha, texto del formulario de Data
  Safety) en cuanto me confirmes que existe la cuenta.

## 2. 🔴 Confirmar el backup del keystore de firma

Ubicación: `C:\Users\Usser\puertaapuertax-android-keystore\`

Copiá **toda esa carpeta** (no solo el `.jks`) a por lo menos uno de estos
lugares, fuera de esta compu:
- Google Drive / Dropbox
- Un pendrive o disco externo
- Un gestor de contraseñas que soporte adjuntar archivos (1Password, etc.)

**Si se pierde ese archivo, no hay forma de recuperarlo ni de pedirle a
Google que lo resetee** — significa no poder subir nunca más una
actualización a la misma ficha de Play Store. El archivo `LEEME-CRITICO.txt`
en esa misma carpeta tiene el detalle completo (contraseña, alias, etc.).

## 3. ✅ Inhabilitar el Client Secret viejo de Google OAuth — ya resuelto

Cabo suelto del incidente del login roto (ver más abajo, no era parte de
este checklist todavía). El secret del 29 de junio quedó desincronizado de
Supabase y causó semanas de login con Google roto en producción; se arregló
el 7 de agosto generando un secret nuevo. El 11 de agosto se confirmó que
Supabase tiene el secret correcto cargado y se inhabilitó el viejo en
Google Cloud Console (Credentials → ese Client → "Inhabilitar", no
"Borrar" — reversible por las dudas). Cerrado, no necesitás hacer nada más.

## 4. ✅ Rotar la key de Google Maps (`GMAPS_KEY`) en Google Cloud Console — ya resuelto

GitGuardian avisó (7 de agosto) que la key de Google Maps estaba hardcodeada
en `cliente.js`. Resuelto del todo el 11 de agosto: la key vieja vivía en un
proyecto de Google Cloud distinto (por eso no aparecía en las credenciales
de "Puerta a Puerta X") — se habilitó la Geocoding API en el proyecto
correcto y se creó una key nueva, restringida (HTTP referrers =
`pa-px2.vercel.app/*` + API restriction = solo Geocoding API).
`frontend/env.js` actualizado con la key nueva, ya en uso.

**Ojo, cabo suelto real:** la key vieja (`AIzaSyASBhagsg9K...`) sigue sin
rastrear — vive en algún otro proyecto de Google Cloud (no en "Puerta a
Puerta X") y nunca tuvo restricciones. La app ya no la usa, pero si querés
cerrarla del todo hay que encontrar en qué proyecto está (puede ser una
cuenta/proyecto viejo de quien la generó originalmente) y deshabilitarla
ahí. No es urgente porque ya no está en uso, pero técnicamente sigue viva.

## 5. ✅ VAPID — ya resuelto y en producción

Confirmado el 11 de agosto: las 3 variables (`VAPID_PUBLIC_KEY`,
`VAPID_PRIVATE_KEY`, `VAPID_EMAIL`) ya estaban cargadas en Railway. El
problema real era que `frontend/env.js` tenía una pública de **otro**
par distinto (huérfana, sin la privada correspondiente en ningún lado) —
VAPID exige que ambas mitades sean del mismo par, si no, el push falla
en silencio. Corregido y pusheado — `frontend/env.js` en `main` ya usa la
misma pública que Railway. Push web funcional en producción.

## 6. 🟡 Probar el APK en un dispositivo real — en curso, fix de CSS ya aplicado

Probado en un celular real el 11 de agosto — aparecieron errores de CSS.
Investigado y arreglado el mismo día (sin haber visto todavía las capturas
puntuales del usuario): la causa más probable es que Android 15
(`targetSdkVersion=35`) fuerza edge-to-edge por defecto, y no había
ninguna protección de `safe-area-inset-top` en ningún lado — el contenido
de arriba de cada pantalla probablemente se dibujaba debajo de la barra de
estado. Fix aplicado (`safe-area.css` nuevo + `viewport-fit=cover` +
padding en sidebar/topbar/headers + `StatusBar` wireado + inputs a 16px
para prevenir zoom en iOS).

**Falta:**
- Instalar en el celular el APK debug ya recompilado el 13 de agosto
  (`android/app/build/outputs/apk/debug/app-debug.apk`, sincronizado con
  todo lo de `main` hasta `d96ff83`) y confirmar que los bugs de CSS
  desaparecieron — es la única verificación real, nada emula el WebView
  nativo con exactitud.
- Si algo sigue roto, mandar las capturas para un segundo pase puntual.
- Terminar de confirmar el resto: login con Google (deep link), un pedido
  de punta a punta, permisos de GPS y cámara.
- Este APK todavía **no** incluye el fix de comisiones de embajador del
  ítem 14 (sigue sin pushear) — si querés probar eso también, avisame y
  recompilo después de pushear.

`qa-e2e.mjs` ya prueba todo el backend (56/56 la última vez) pero **no**
prueba el shell nativo — este paso a mano sigue sin ser opcional antes de
mandar nada a Play Store.

## 7. 🟢 Diseñar el "feature graphic" de Play Store (1024×500 px)

Es el único gráfico que falta para la ficha — el ícono de 512×512 ya existe.
Si querés, te ayudo con el texto/concepto, pero el diseño en sí (imagen)
no lo puedo generar yo.

## 8b. ✅ Fix de comisiones de embajador — pusheado a `main`

Surgió el 13 de agosto charlando de cómo simplificar el alta de comercios
por parte de un embajador. Se encontró un bug real, no solo de UX: el link
de referidos (el que el dashboard del embajador promueve) nunca generó
comisión — la sesión del comercio no puede crear la fila en `patrocinios`
que hace falta para que se acredite algo. Detalle completo en `CLAUDE.md`
§6/§13 y `CHANGELOG.md` v3.17.0.

- Código testeado (`backend/test` 40/40) y **pusheado a `main`**
  (`bd89017`, 13 de agosto) — Railway/Vercel lo despliegan solos.
- La migración de backfill (`migration-backfill-patrocinios-referidos.sql`)
  ya estaba corrida en Supabase de antes.
- El APK debug del ítem 6 (compilado antes de este push) **no** incluye
  todavía este fix — si vas a probar el flujo de embajador desde la app
  nativa, avisame y recompilo.

## 8. 🟢 Cuando tengan Payway resuelto (Fabri)

No toqué nada de esto a propósito. Cuando Fabri termine su parte, avisame y
lo integramos/probamos junto con todo lo demás antes del lanzamiento final.

## 9. ✅ Duplicación de lógica entre archivos — resuelta en su mayor parte

Del 7 de agosto: la misma lógica estaba reimplementada en varios archivos
en vez de compartirse. Investigado a fondo el 11 de agosto antes de tocar
nada — resultó que no todo era copy-paste accidental:

- **Sanitización HTML, toggle de contraseña, init de Supabase** — sí eran
  duplicación real (y la de sanitización tenía 2 bugs de verdad: en
  `comercio.js` no escapaba `'` y convertía `0`/`false` en `''`, lo que
  rompería mostrar por ejemplo un precio de `$0`). **Consolidado y
  arreglado** — todo vive ahora en `ui.js` (`sanitizeHTML`,
  `bindPasswordToggle`) y en un `bootstrap-supabase.js` nuevo. De paso se
  sacó una inconsistencia real: `login-usuario.html` tenía la versión del
  SDK de Supabase fijada en `2.43.4` mientras el resto usa la última
  versión 2.x sin fijar.
- **Login (3 implementaciones)** — investigado y confirmado que las
  diferencias son **intencionales, no accidentales**: `admin-acceso.js`
  nunca consulta la tabla `perfiles` para el rol (decisión de seguridad,
  el rol de admin no debería poder asignarse por lo que sea que escriba
  ahí), `login.js` no redirige solo si ya hay sesión activa (fix
  anti-secuestro de sesión) pero `admin-acceso.js` sí lo hace, y
  `login-usuario.html` guarda en `localStorage` en vez de
  `sessionStorage` como los otros dos. Unificar esto de verdad implica
  tocar el modelo de seguridad del admin — **se dejó sin tocar a
  propósito**, no es una tarea de limpieza mecánica.

## 10. ✅ `comercio_id` como `text` en 2 tablas — ya resuelto

`advertencias_comercio.comercio_id` y `chat_reportes.comercio_id` eran
`text`, deberían haber sido `uuid` desde siempre (`reportes.comercio_id`
ya se había arreglado antes). Migración
(`supabase/migrations/migration-comercio-id-uuid.sql`) escrita y corrida
en Supabase el 11 de agosto, código ya pusheado a `main`.

## 11. ✅ `saveCierre()` (panel comercio) — ya resuelto

Detectado en la auditoría de código muerto del 7 de agosto: el botón
"Guardar cierre especial" mostraba éxito pero no escribía nada en la base
— no existía la tabla. Código escrito y commiteado el 11 de agosto: nueva
tabla `cierres_especiales` (`supabase/migrations/migration-cierres-especiales.sql`)
+ `comercio.js`/`comercio.html` ahora persisten, listan y borran cierres de
verdad, y `horariosScheduler.js` fuerza el comercio cerrado ese día.
Migración corrida en Supabase el 11 de agosto — el commit ya está seguro
para pushear.

## 12. ✅ `cliente/login-usuario.html`: checkbox de TyC + bug de contraseña — ya resuelto

De la auditoría del login del 7 de agosto. Ya aplicado (11 de agosto):
checkbox de Términos y Condiciones agregado (mismo patrón que
`registro-comercio.html`) y el mínimo de 8 caracteres de contraseña ahora
solo se exige al registrarse, no al iniciar sesión.

## 13. ✅ `patrocinios` sin las columnas del carrusel — ya resuelto

El botón "Guardar Slot" de la pestaña Carrusel del admin nunca pudo
guardar nada en producción: a la tabla real le faltaban columnas
(`titulo`, `sub_titulo`, `imagen_url`, `link_oferta`, `orden`) y además
tenía `embajador_id`/`comercio_id` como `NOT NULL` sin que nada los
completara — heredado de un diseño anterior (embajador↔comercio para
comisiones) mezclado con el uso actual. Ya aplicado
(`migration-fix-patrocinios-columnas-carrusel.sql`, 7 de agosto). Probado
con datos de prueba: 3 comercios (uno por ciudad de lanzamiento) + 12
productos + el switch admin↔cliente para poder comprar con la misma
cuenta.

---

### Lo que ya está resuelto (no necesitás hacer nada más acá)
- Todo el backend/flujo de pedido (matching automático, clima automático,
  tiempo de preparación, horarios automáticos, edición de productos) —
  shippeado y verificado en producción.
- `android/` sincronizado con el código de julio.
- `capacitor.config.json` limpio (sacamos una referencia a un keystore que
  no correspondía).
- `GMAPS_KEY` sacada del código, movida a `env.js` (11 de agosto) — falta
  solo el paso manual de rotarla, ver ítem 3.
- `cliente/login-usuario.html`: checkbox de TyC + bug de contraseña (11 de
  agosto), ver ítem 12.
- `CLAUDE.md` al día con todo lo de arriba.

### Sobre la Mac de fines de agosto (iOS)
Ya dejé lo que se podía preparar sin la Mac (11 de agosto):
`@capacitor/ios` instalado, carpeta `ios/` generada (`npx cap add ios`,
proyecto Xcode completo), y 3 ajustes manuales ya aplicados en
`Info.plist` (permisos de cámara/ubicación, deep link de Google OAuth,
scheme del bundle) — documentados en `docs/IOS-BUILD.md` por si hay que
reaplicarlos (`ios/` está en `.gitignore`, igual que `android/`, así que
si se regenera de cero en la Mac esos 3 ajustes se pierden).

**Lo que sí necesita la Mac sí o sí:**
- Correr `pod install` de verdad (CocoaPods no corre en Windows) — sin
  esto no abre en Xcode.
- Un ícono de app en 1024×1024 — no hay ninguna fuente cuadrada de esa
  resolución en el repo todavía (la más grande es 512×512), así que el
  ícono de iOS quedó en el placeholder de Capacitor por ahora.
- Cuenta de Apple Developer ($99/año) para firmar y subir a TestFlight/App
  Store — separada de la de Google Play, hay que crearla en algún momento
  antes de esa parte.

Avisame cuando tengas la Mac y seguimos con eso (`docs/IOS-BUILD.md`
tiene el paso a paso completo).

### Sobre usuarios simultáneos / capacidad (no bloquea el lanzamiento)

A raíz de la charla sobre cuántos usuarios aguanta el backend: agregado
soporte de clustering (`WEB_CONCURRENCY`, 11 de agosto) para aprovechar
más de un vCPU de tu Railway Hobby cuando haga falta. **No tenés que
hacer nada ahora** — sin configurar la variable, todo sigue funcionando
exactamente igual que hoy.

Cuando el uso real lo justifique (no antes, no hace falta adivinar):
1. Entrá al dashboard de Railway → tu servicio backend → mirá cuántos
   vCPU tiene asignados de verdad.
2. Variables → agregá `WEB_CONCURRENCY` con un número acorde a eso (ej:
   si tiene 4 vCPU, probá con 2-4, no con 48 aunque el plan lo permita).
3. Confirmá que sigue respondiendo bien (`/health`) y mirá los logs — con
   clustering prendido vas a ver "Primary... levantando N workers HTTP".

Ver `CLAUDE.md` §16 para el detalle técnico completo (qué resuelve, qué
no resuelve — réplicas múltiples de Railway todavía necesitarían un paso
extra que no está hecho, documentado ahí).
