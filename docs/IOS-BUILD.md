# Guía de Build — iOS (Capacitor)

> Estado al 2026-08-11: `@capacitor/ios` ya está en `package.json` y la
> carpeta `ios/` ya se generó una vez (`npx cap add ios`) desde Windows —
> pero **sin CocoaPods** (no corre en Windows), así que le falta el `pod
> install` real y no se puede abrir en Xcode todavía. Como `ios/` está en
> `.gitignore` (mismo criterio que `android/`), es muy probable que en la
> Mac termines regenerándola de cero — por eso todo lo que ya se dejó
> configurado a mano queda documentado acá, para no perderlo.

## Requisitos previos

- Mac con Xcode instalado (App Store)
- CocoaPods (`sudo gem install cocoapods`, o `brew install cocoapods`)
- Node.js 18+ con npm
- Cuenta de Apple Developer ($99/año) — necesaria para firmar y subir a
  App Store, no para compilar/probar en simulador

## Pasos para generar el proyecto

### 1. Clonar el repositorio e instalar dependencias
```bash
git clone https://github.com/[usuario]/puertaapuerta-main.git
cd puertaapuerta-main
npm install
```

### 2. Generar el proyecto iOS
```bash
npx cap add ios
```
Esto crea `ios/App` con el proyecto de Xcode completo y corre `pod install`
automáticamente (en Mac, con CocoaPods instalado, a diferencia de Windows).

### 3. Copiar los archivos web al proyecto iOS
```bash
npx cap sync ios
```

### 4. Abrir en Xcode
```bash
npx cap open ios
```

## Configuración manual necesaria después de `cap add ios`

Estos 3 ajustes **no** los pone Capacitor por defecto — hay que agregarlos
a mano en `ios/App/App/Info.plist` cada vez que se regenera la carpeta
desde cero (ya están aplicados en la `ios/` generada el 2026-08-11 en esta
compu, pero se pierden si se borra y se vuelve a correr `cap add ios`):

### 4.1 Permisos (usage descriptions)

El código usa `@capacitor/geolocation` y `@capacitor/camera` — iOS exige
un texto explicando por qué, o la app crashea al pedir el permiso.
Agregar dentro de `<dict>` en `Info.plist`:
```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Usamos tu ubicación para mostrarte comercios cerca tuyo y para que los cadetes puedan navegar durante la entrega.</string>
<key>NSCameraUsageDescription</key>
<string>Usamos la cámara para que puedas subir fotos de tus documentos (DNI, carnet, seguro) o de productos.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>Necesitamos acceso a tus fotos para que puedas elegir una imagen desde tu galería.</string>
<key>NSPhotoLibraryAddUsageDescription</key>
<string>Necesitamos guardar imágenes en tu galería cuando lo pidas desde la app.</string>
```
No agregar ningún permiso de ubicación "Always"/background — el GPS del
cadete es foreground-only (`navigator.geolocation.watchPosition()`), background
está explícitamente en pausa (ver CLAUDE.md §13).

### 4.2 Deep link para login con Google (OAuth nativo)

Mismo mecanismo que Android (`docs/ANDROID-BUILD.md` §6.1): Google bloquea
el login dentro del WebView embebido, así que la app abre un navegador
in-app (`@capacitor/browser`) y vuelve por un deep link
(`com.puertaapuertax.app://oauth-callback`, ver
`frontend/assets/js/auth-service.js`, `App.addListener('appUrlOpen', ...)`
— cross-platform, no hace falta tocar ese código). En iOS el deep link se
registra como Custom URL Scheme en `Info.plist`:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>com.puertaapuertax.app</string>
    </array>
  </dict>
</array>
```
El redirect `com.puertaapuertax.app://oauth-callback` ya está agregado en
**Supabase Dashboard → Authentication → URL Configuration → Redirect
URLs** (se agregó junto con el de Android, mismo scheme — no hace falta
agregar uno nuevo para iOS).

### 4.3 Push notifications (pendiente, requiere Firebase/APNs)

`capacitor.config.json` ya tiene el bloque `PushNotifications` (cross
-platform). Para que funcione en iOS falta, además de lo de Android
(proyecto Firebase — ver `docs/ANDROID-BUILD.md` §7):
- En Xcode: `Signing & Capabilities` → `+ Capability` → `Push
  Notifications` (agrega el entitlement, requiere cuenta de Apple
  Developer paga).
- Subir el certificado/key APNs a Firebase Cloud Messaging (Firebase
  Console → Project Settings → Cloud Messaging → Apple app configuration).

Explícitamente en pausa hasta que se resuelva Firebase/FCM para push
nativo (ver CLAUDE.md §13, "explícitamente en pausa") — no es exclusivo
de iOS, Android también lo tiene pendiente.

## Ícono de la app

**Pendiente:** el ícono actual en `ios/App/App/Assets.xcassets/AppIcon.appiconset/`
es el placeholder que genera Capacitor por defecto (no el logo real). No
había ninguna fuente cuadrada de suficiente resolución en el repo para
reemplazarlo sin perder calidad (`frontend/assets/img/logo-original.png`
es 241×235, `frontend/logo-512.png`/`playstore-icon.png` son 512×512 —
el ícono de iOS necesita 1024×1024). En Xcode, con el logo en buena
resolución, arrastrarlo al asset catalog `AppIcon` genera el ícono solo
(formato "single size" moderno, ya no hace falta exportar cada tamaño a
mano como en Android).

## Bundle ID / firma

`appId` en `capacitor.config.json` (`com.puertaapuertax.app`) es el mismo
para Android e iOS — Capacitor lo usa como Bundle Identifier de Xcode
automáticamente. Falta configurar el signing team (cuenta de Apple
Developer) en Xcode → `Signing & Capabilities` antes de poder buildear en
un dispositivo real o subir a TestFlight/App Store.

---

## Actualizar la app (cada vez que cambia el código web)

```bash
npx cap sync ios
```
Luego rebuild desde Xcode.
