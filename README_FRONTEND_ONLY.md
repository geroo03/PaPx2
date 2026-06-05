Proyecto: Puerta a Puerta — Frontend-only notes

Este repositorio puede montarse y desplegarse como una app estática (solo frontend).

Qué hice (sugerido):
- La página de login de cliente está en `cliente/login-usuario.html` y usa Supabase (CDN) para auth.
- Se extrajeron estilos a `assets/css/login.css`.

Recomendaciones para pasar a solo frontend (pasos seguros):
1) Localmente: prueba la app con un servidor estático (Python o npm):

PowerShell (Python 3):
```powershell
# en la carpeta del proyecto
python -m http.server 5500
# abrir en el navegador: http://localhost:5500/cliente/login-usuario.html
```

PowerShell (si tiene Node.js instalado):
```powershell
npx serve -s . -l 5500
# o
npx http-server -p 5500
```

2) Llaves y secretos:
- No incluyas claves privadas ni Service Role en el frontend.
- La ANON key de Supabase puede permanecer en el cliente para desarrollo, pero para producción usa las variables de entorno del proveedor (Vercel/Netlify) y no la subas a git.

3) Limpieza de backend (opcional y destructiva):
- He puesto un script seguro `cleanup-backend.ps1` que copia carpetas backend a un backup con timestamp y pregunta confirmación antes de borrar.
- Revisa el backup antes de eliminar.

4) Deploy a Vercel / Netlify / GitHub Pages:
- En Vercel añade las variables: SUPABASE_URL, SUPABASE_ANON_KEY (y cualquier otra clave pública que uses) desde el panel de entorno.
- Configura la ruta de salida si es necesario; la carpeta raíz con `index.html` funciona para la mayoría.

Notas finales:
- Hay varias referencias a endpoints `../api/...` en algunos JS (por ejemplo, `cliente/pago.html`, `assets/js/*.js`) que dependen de un backend. Si no quieres backend, tendrás que reemplazarlas por integraciones frontales (p.ej. llamadas directas a APIs de terceros o a Supabase REST/Functions) o quitar esas funciones.
- Si quieres, puedo: (A) automáticamente reemplazar llamadas a `../api/` por llamadas a supabase or 3rd-party front endpoints (según el caso), o (B) only add the backup script and let you remove backend files locally. Dime cómo prefieres proceder.
