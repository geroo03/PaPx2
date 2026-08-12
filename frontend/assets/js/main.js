// assets/js/main.js
// Usa el cliente Supabase ya inicializado por el UMD bundle en el HTML.
// NO importa config.js ni api.js para evitar la cadena de sub-módulos ESM de la CDN.
import { sanitizeHTML, formatARS } from './ui.js';
import { state } from './state.js';
import { ICONS } from './icons.js';
import { registrarPush } from './push.js';

// window.sb es inicializado en el session guard del HTML antes de que este script corra.
const supabase = window.sb;

// ─── STATUS BAR NATIVA (Capacitor / Android-iOS) ─────────────────────────────
// Android 15+ (API 35) fuerza edge-to-edge: el WebView dibuja detrás de la
// barra de estado por defecto. capacitor.config.json ya deja overlaysWebView
// en true (no hay forma de optar por lo viejo de todos modos) — esto solo
// ajusta el color de los íconos (hora/batería) para que tengan contraste
// contra el fondo oscuro de la app. El padding real que evita que el
// contenido quede tapado lo pone el CSS (--safe-top, ver safe-area.css).
if (window.Capacitor?.isNativePlatform?.()) {
  const { StatusBar, Style } = window.Capacitor.Plugins;
  StatusBar?.setStyle?.({ style: Style?.Dark ?? 'DARK' }).catch(() => {});
}

// Globales para scripts clásicos (cliente.js los lee en el evento 'load')
window.ICONS        = ICONS;
window.sanitizeHTML = sanitizeHTML;
window.formatARS    = formatARS;

// Inicializar estado guardado en LocalStorage (Offline Persistence)
state.init();
window.state = state; // EXPOSE STATE GLOBALLY FOR LEGACY SCRIPTS

// ==========================================
// ORQUESTADOR GLOBAL PARA EL HTML (Transición gradual)
// Conectamos las funciones a window para que los onclick="" del HTML funcionen
// NO INTENTAMOS ROMPER TODO AÚN, solo lo enlazamos al nuevo estado modular
// ==========================================

// Helper: build a resilient absolute URL from a project-relative path.
// Siempre resuelve desde el origen del servidor (raíz), NO desde el directorio
// de la página actual. Esto evita que páginas en subdirectorios (/admin/, /cadete/)
// generen rutas incorrectas como /admin/cliente/index.html.
export function buildUrl(relativePath){
  if(!relativePath) relativePath = '';
  if(relativePath.startsWith('/')) relativePath = relativePath.slice(1);

  if(relativePath === '' || relativePath === '.' || relativePath.toLowerCase() === 'index.html'){
    relativePath = 'cliente/index.html';
  }

  return window.location.origin + '/' + relativePath;
}
window.buildUrl = buildUrl;

// ==========================================
// LISTENERS GLOBALES
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[PaP] Inicializando modulos V2 de Puerta a Puerta X...');

  // Guard: supabase puede ser null en modo bypass de prueba (no bloquear)
  if (!supabase) { console.warn('[PaP] supabase no disponible — modo bypass activo'); return; }

  // Manejar la recuperación de sesión para Auth en toda la app
  const { data: { session } } = await supabase.auth.getSession();
  state.user = session?.user || null;

  // Registrar push notifications si hay sesión activa
  if (session?.user) registrarPush().catch(() => {});
});


