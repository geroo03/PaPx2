// Frontend login module that uses backend REST API at /api/auth/login
// No direct Supabase client used here to avoid leaking keys in the browser

let currentTab = 'login';
let rolSeleccionado = null;
let autoIndex = 0;

/* Clean login module: no mocks, no renderCard. Connects to backend API */

const $ = id => document.getElementById(id);

function showError(message) {
  const el = $('msg-error');
  if (el) { el.textContent = message; el.classList.remove('is-hidden'); }
}

function clearError() {
  const el = $('msg-error'); if (el) el.classList.add('is-hidden');
}

async function handleLoginSubmit(e) {
  e && e.preventDefault();
  clearError();

  const email = (document.getElementById('input-email')?.value || '').trim();
  const password = (document.getElementById('input-pass')?.value || '');
  const btn = document.getElementById('btn-submit');

  if (!email || !password) { showError('Completa email y contraseña'); return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Ingresando...'; }

  try {
    const resp = await fetch(`${window.BACKEND_URL || 'http://localhost:3000'}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const payload = await resp.json().catch(() => null);
    if (!resp.ok) {
      const message = payload?.error || `Error: ${resp.status}`;
      showError(message);
      return;
    }

    // payload should contain { user, session }
    const user = payload?.user || {};
    const session = payload?.session || {};

    // store token safely
    const token = session?.access_token || session?.token || null;
    if (token) localStorage.setItem('access_token', token);

    // safe read of role
    const role = (user && user.user_metadata && user.user_metadata.role) ? user.user_metadata.role : 'cliente';

    // Prefer global buildUrl helper if present (it maps root/index to cliente/index.html)
    const safeBuildUrl = (relativePath) => {
      if(window.buildUrl) return window.buildUrl(relativePath);
      // fallback local implementation
      if(!relativePath) relativePath = '';
      if(relativePath.startsWith('/')) relativePath = relativePath.slice(1);
      if(relativePath === '' || relativePath.toLowerCase() === 'index.html') relativePath = 'cliente/index.html';
      const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
      return new URL(relativePath, base).toString();
    };

    // redirect by role (resilient)
    if (role === 'comercio') window.location.href = safeBuildUrl('comercio/comercio.html');
    else if (role === 'cadete') window.location.href = safeBuildUrl('cadete/cadete.html');
    else window.location.href = safeBuildUrl('cliente/index.html');

  } catch (err) {
    showError(err?.message || 'Error de conexión');
  } finally {
    if ($('btn-submit')) { $('btn-submit').disabled = false; $('btn-submit').textContent = 'Ingresar'; }
  }
}

function attachListeners() {
  // Attach submit handler to the form element
  const form = document.getElementById('loginForm');
  if (form) form.addEventListener('submit', handleLoginSubmit);

  // Keep Enter key behaviour handled naturally by form submit; no per-input handlers required
}

// initialize
document.addEventListener('DOMContentLoaded', () => {
  attachListeners();
  // hide previous error, if any
  clearError();
});

export { handleLoginSubmit };
