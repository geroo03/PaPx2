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

## 3. 🔴 Rotar la key de Google Maps (`GMAPS_KEY`) en Google Cloud Console

GitGuardian avisó (7 de agosto) que la key de Google Maps estaba hardcodeada
en `cliente.js`. Ya se movió a `frontend/env.js` (mismo patrón que
`SUPABASE_ANON_KEY`), pero es solo un refactor de ubicación — **la key en sí
sigue siendo la misma que ya quedó expuesta** en el historial de git.

- Entrá a Google Cloud Console → APIs & Services → Credentials.
- Generá una key nueva (o regenerá el secreto de la actual) y restringila:
  **Application restriction = HTTP referrers** (`pa-px2.vercel.app/*`) +
  **API restriction** = solo Geocoding API (o las que uses).
- Reemplazá el valor de `window.GMAPS_KEY` en `frontend/env.js` por la key
  nueva y hacé commit + push.

Sin esto, la key vieja sigue siendo válida y sin restricciones — cualquiera
que la vea en el historial de git podría usarla contra tu cuota/facturación
de Google Cloud.

## 5. 🟡 Cargar las claves VAPID en Railway

Ya te las pasé en el chat anterior (no las repito acá para no dejarlas
guardadas en un archivo del repo). Entrá a Railway → tu servicio backend →
pestaña **Variables** y cargá las 3: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_EMAIL`. Confirmá que Railway redeployó después de guardarlas.

Sin esto, las notificaciones push por web (avisos de pedido, oferta, etc.)
no llegan — no rompe nada más, pero es una feature muerta hasta que lo
hagas.

## 6. 🟡 Probar el APK en un dispositivo real

Ya generé un `.apk` de debug con todo el código de julio (matching
automático, horarios automáticos, edición de productos, recargo 20%, todo).
Instalalo en un celular Android real (o pasáselo a Fabri) y probá a mano:

- Login con Google (el flow nativo con deep link) — confirmá que redirige
  bien de vuelta a la app.
- Un pedido de punta a punta: cliente → comercio acepta con tiempo de
  preparación → cadete recibe la oferta automáticamente → retiro → entrega.
- Permisos de GPS y cámara.

`qa-e2e.mjs` ya prueba todo el backend (56/56 la última vez) pero **no**
prueba el shell nativo — este paso a mano no es opcional antes de mandar
nada a Play Store.

## 7. 🟢 Diseñar el "feature graphic" de Play Store (1024×500 px)

Es el único gráfico que falta para la ficha — el ícono de 512×512 ya existe.
Si querés, te ayudo con el texto/concepto, pero el diseño en sí (imagen)
no lo puedo generar yo.

## 8. 🟢 Cuando tengan Payway resuelto (Fabri)

No toqué nada de esto a propósito. Cuando Fabri termine su parte, avisame y
lo integramos/probamos junto con todo lo demás antes del lanzamiento final.

## 9. 🟢 Duplicación de lógica entre archivos (deuda técnica, no urgente)

También del 7 de agosto: la misma lógica está reimplementada en varios
archivos en vez de compartirse — login (3 veces), toggle de mostrar/ocultar
contraseña (3 veces), sanitización HTML (4 veces), inicialización del
cliente Supabase (5 veces). Funciona todo bien, no bloquea el lanzamiento,
pero es un buen candidato para una tarea de refactor aparte.

## 10. 🟢 Deuda técnica: `comercio_id` como `text` en 2 tablas

`advertencias_comercio.comercio_id` y `chat_reportes.comercio_id` deberían
ser `uuid`, no `text` (`reportes.comercio_id` ya se arregló en su momento).
Evaluado el 11 de agosto y dejado afuera **a propósito** — no bloquea el
lanzamiento, las policies RLS ya castean ambos lados a `text` así que
funcionan igual hoy. Candidato para una limpieza aparte, sin apuro.

## 11. 🟡 `saveCierre()` (panel comercio) — código listo, falta correr la migración

Detectado en la auditoría de código muerto del 7 de agosto: el botón
"Guardar cierre especial" mostraba éxito pero no escribía nada en la base
— no existía la tabla. Código ya escrito y commiteado (11 de agosto): nueva
tabla `cierres_especiales` (`supabase/migrations/migration-cierres-especiales.sql`)
+ `comercio.js`/`comercio.html` ahora persisten, listan y borran cierres de
verdad, y `horariosScheduler.js` fuerza el comercio cerrado ese día.

**Antes de pushear este código a `main`:** correr
`migration-cierres-especiales.sql` en el SQL Editor de Supabase (es
aditiva/idempotente, se puede re-correr sin problema). Si se pushea sin
correrla primero, el botón "Guardar cierre especial" va a fallar en
producción (la tabla no existe todavía).

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
