# Guía de Build — Android (Capacitor)

## Requisitos previos

- Node.js 18+ con npm
- Android Studio (instalado y con SDK configurado)
- Java 17+
- Git

## Pasos para generar el APK

### 1. Clonar el repositorio
```bash
git clone https://github.com/[usuario]/puertaapuerta-main.git
cd puertaapuerta-main
```

### 2. Instalar dependencias de Capacitor
```bash
npm install
```

### 3. Generar el proyecto Android
```bash
npx cap add android
```
Esto crea la carpeta `android/` con el proyecto Android Studio completo.

### 4. Copiar los archivos web al proyecto Android
```bash
npx cap sync android
```

### 5. Abrir en Android Studio
```bash
npx cap open android
```

### 6. Permisos adicionales en AndroidManifest.xml

Después de `cap add android`, abrir:
`android/app/src/main/AndroidManifest.xml`

Y agregar dentro de `<manifest>`, antes de `<application>`:
```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

### 7. Configurar Firebase (Push Notifications)

1. Ir a [Firebase Console](https://console.firebase.google.com)
2. Crear proyecto "Puerta a Puerta X"
3. Agregar app Android con package name: `com.puertaapuertax.app`
4. Descargar `google-services.json`
5. Copiar a `android/app/google-services.json`
6. En `android/build.gradle` agregar en `dependencies`:
   ```
   classpath 'com.google.gms:google-services:4.4.0'
   ```
7. En `android/app/build.gradle` agregar al final:
   ```
   apply plugin: 'com.google.gms.google-services'
   ```

### 8. Buildear APK (debug para pruebas)

En Android Studio:
- `Build` → `Build Bundle(s) / APK(s)` → `Build APK(s)`
- El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`

O desde terminal:
```bash
cd android
./gradlew assembleDebug
```

### 9. Buildear APK firmado (para distribución / Play Store)

En Android Studio:
- `Build` → `Generate Signed Bundle / APK`
- Crear keystore o usar uno existente
- Seleccionar `release`

---

## Actualizar la app (cada vez que cambia el código web)

```bash
npx cap sync android
```
Luego rebuild desde Android Studio.

---

## Iconos de la app

Reemplazar los íconos por defecto en:
- `android/app/src/main/res/mipmap-*/ic_launcher.png`

Tamaños necesarios:
| Carpeta | Tamaño |
|---------|--------|
| mipmap-mdpi | 48x48 |
| mipmap-hdpi | 72x72 |
| mipmap-xhdpi | 96x96 |
| mipmap-xxhdpi | 144x144 |
| mipmap-xxxhdpi | 192x192 |

Generador de íconos: https://romannurik.github.io/AndroidAssetStudio/icons-launcher.html

---

## Splash screen

Reemplazar `android/app/src/main/res/drawable/splash.png` con la imagen de splash (recomendado: 2732x2732 px con el logo centrado).
