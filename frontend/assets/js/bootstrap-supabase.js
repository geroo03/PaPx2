// bootstrap-supabase.js — inicializa window.sb, una sola vez, para páginas
// que lo necesitan de forma sincrónica antes de que corra su primer
// <script type="module"> (los módulos se difieren hasta después de que el
// documento termine de parsearse, así que un <script> clásico como este
// tiene que ser el que cree window.sb primero).
//
// Antes de esta consolidación (2026-08-11) esto estaba copiado y pegado,
// casi idéntico, en 4 páginas (admin-acceso.html, comercio.html,
// embajador/dashboard.html, cliente/index.html) — cada una con su propia
// variante del mismo guard.
//
// Cargar SIEMPRE después de env.js (necesita window.SUPABASE_URL/ANON_KEY)
// y del SDK de Supabase (necesita window.supabase.createClient).
(function () {
  if (window.sb) return; // ya inicializado por otro script (ej: config.js)
  var url = window.SUPABASE_URL || '';
  var key = window.SUPABASE_ANON_KEY || '';
  if (url && key && window.supabase && window.supabase.createClient) {
    window.sb = window.supabase.createClient(url, key);
  }
})();
