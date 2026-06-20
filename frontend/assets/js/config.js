// ─── config.js — Shim UMD ────────────────────────────────────────────────────
// NO importa desde la CDN ESM para evitar la cadena de sub-módulos (auth-js,
// realtime-js, tslib, iceberg-js…) que causa 404 en servidores locales.
// El cliente real lo provee el bundle UMD cargado en cada HTML mediante:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.43.4/dist/umd/supabase.js">
// y luego: window.sb = window.supabase.createClient(URL, KEY)


// ─── COORDENADAS DE SUPABASE ──────────────────────────────────────────────────
export const SUPA_URL = (typeof window !== 'undefined' && window.SUPABASE_URL)     ? window.SUPABASE_URL     : '';
export const SUPA_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) ? window.SUPABASE_ANON_KEY : '';

// ─── CLIENTE SUPABASE ─────────────────────────────────────────────────────────
// Lee window.sb (inicializado por el guard de sesión del HTML).
// Si no existe aún, lo crea desde el UMD global window.supabase.createClient.
function _resolveClient() {
  if (typeof window === 'undefined') return null;
  if (window.sb) return window.sb;
  const factory = window.supabase && window.supabase.createClient;
  if (factory && SUPA_URL && SUPA_KEY) {
    window.sb = factory(SUPA_URL, SUPA_KEY);
    return window.sb;
  }
  console.warn('[PaP config] Cliente Supabase no disponible aún. Asegurate de cargar el UMD bundle antes de este módulo.');
  return null;
}

export const supabase = _resolveClient();

// Log de validación (no arroja, solo informa)
(function validateSupabaseConfig(){
  try{
    const ok = !!(supabase && SUPA_URL && SUPA_URL.indexOf('supabase.co') !== -1);
    if (typeof window !== 'undefined') window.SUPABASE_CONFIG_OK = ok;
    if (!ok) console.warn('[PaP] Supabase client no inicializado correctamente. Verificá env.js y el UMD bundle.');
  }catch(e){ /* no-op */ }
})();

