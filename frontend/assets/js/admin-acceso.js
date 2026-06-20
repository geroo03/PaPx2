/**
 * admin-acceso.js — Puerta a Puerta — Login del panel de administracion
 */

import { supabase as sb } from './config.js';

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function showErr(msg) {
  const e = document.getElementById('err');
  const o = document.getElementById('ok');
  if (e) { e.textContent = msg; e.style.display = 'block'; }
  if (o) o.style.display = 'none';
}

function showOk(msg) {
  const e = document.getElementById('err');
  const o = document.getElementById('ok');
  if (o) { o.textContent = msg; o.style.display = 'block'; }
  if (e) e.style.display = 'none';
}

function setBtn(btn, loading) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Verificando...' : 'Ingresar';
}

// ─── HANDLER PRINCIPAL ────────────────────────────────────────────────────────
async function login() {
  const email = (document.getElementById('email')?.value || '').trim();
  const pass  = (document.getElementById('pass')?.value  || '');
  const btn   = document.getElementById('btn');

  if (!email || !pass) { showErr('Completá todos los campos.'); return; }
  setBtn(btn, true);

  try {
    const res = await sb.auth.signInWithPassword({ email, password: pass });

    if (res.error) {
      const msg = res.error?.message || '';
      if (res.error?.status === 400 || res.error?.status === 401 || /invalid|credential|incorrect/i.test(msg)) {
        showErr('Email o contraseña incorrectos.');
      } else {
        showErr('Error de autenticación: ' + (msg || 'revisá la conexión.'));
      }
      setBtn(btn, false);
      return;
    }

    const user = res.data?.session?.user || null;
    const role = user?.user_metadata?.role || null;

    if (role === 'admin') {
      try {
        sessionStorage.setItem('pap_rol', 'admin');
        sessionStorage.setItem('pap_uid', user.id);
      } catch (_) {}
      showOk('✅ Acceso concedido. Redirigiendo...');
      setTimeout(() => { window.location.href = 'admin.html'; }, 1000);
      return;
    }

    try { await sb.auth.signOut(); } catch (_) {}
    showErr('No tenés permisos de administrador.');
    setBtn(btn, false);

  } catch (e) {
    const msg = e?.message || '';
    if (e instanceof TypeError || /Failed to fetch|NetworkError/i.test(msg)) {
      showErr('Error de conexión. Revisá la red y la configuración de Supabase.');
    } else {
      showErr('Error al autenticar. Por favor, intentá de nuevo.');
    }
    setBtn(btn, false);
  }
}

// ─── BIND ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn')?.addEventListener('click', login);
  document.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
});

// ─── CHECK SESIÓN EXISTENTE ───────────────────────────────────────────────────
(async function checkSession() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.user?.user_metadata?.role === 'admin') {
      window.location.href = 'admin.html';
    }
  } catch (_) {}
})();
