// embajador.js — dashboard del embajador
// Usa el backend API (BACKEND_URL) para todas las operaciones sensibles.
import { supabase } from './config.js';

const API  = window.BACKEND_URL ?? '';
const $    = id => document.getElementById(id);
const toast = (msg, dur = 3500) => {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.style.display = 'none', dur);
};
const fmt = n => '$' + Number(n ?? 0).toLocaleString('es-AR', { minimumFractionDigits: 2 });

let SESSION = null;
let SALDO_DISPONIBLE = 0;

// ─── INIT ─────────────────────────────────────────────────────────────────────

async function init() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = '/login.html'; return; }
  SESSION = session;

  // Verificar rol
  const { data: perfil } = await supabase.from('perfiles').select('rol').eq('usuario_id', session.user.id).maybeSingle();
  const rol = perfil?.rol ?? session.user.user_metadata?.role;
  if (rol !== 'embajador') { location.href = '/login.html'; return; }

  const nombre = session.user.user_metadata?.full_name ?? session.user.email;
  $('sub-nombre').textContent = nombre;

  bindTabs();
  bindLogout();
  bindRetiroModal();
  bindFormAlta();

  await cargarDashboard();
}

// ─── TABS ─────────────────────────────────────────────────────────────────────

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === 'tienda') {
        window.location.href = '/cliente/index.html';
        return;
      }
      document.querySelectorAll('.tab-btn, .tab-panel').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────

function bindLogout() {
  $('btn-logout')?.addEventListener('click', async () => {
    await supabase.auth.signOut();
    localStorage.clear();
    location.href = '/login.html';
  });
}

// ─── CARGA DEL DASHBOARD ──────────────────────────────────────────────────────

async function cargarDashboard() {
  try {
    const res = await authFetch(`${API}/api/embajadores/dashboard`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { billetera, comisiones, patrocinios, retiros } = await res.json();

    renderBilletera(billetera);
    renderRetiros(retiros);
    renderComisiones(comisiones);
    renderPatrocinios(patrocinios);
  } catch (err) {
    console.error('[Dashboard] Error:', err.message);
    toast('Error cargando el dashboard. Revisá la consola.');
  }
}

// ─── BILLETERA ────────────────────────────────────────────────────────────────

function renderBilletera(b) {
  SALDO_DISPONIBLE = Number(b?.saldo_disponible ?? 0);
  $('saldo-disponible').textContent = fmt(b?.saldo_disponible ?? 0);
  $('saldo-acumulado').textContent  = fmt(b?.saldo_acumulado  ?? 0);
  $('saldo-retirado').textContent   = fmt(b?.saldo_retirado   ?? 0);
}

// ─── RETIROS ──────────────────────────────────────────────────────────────────

function renderRetiros(retiros) {
  const el = $('lista-retiros');
  if (!retiros?.length) { el.innerHTML = '<div class="empty">Sin solicitudes de retiro.</div>'; return; }
  el.innerHTML = retiros.map(r => `
    <div class="retiro-row">
      <div>
        <strong>${fmt(r.monto)}</strong>
        <div style="font-size:12px;color:#888;margin-top:2px">${new Date(r.created_at).toLocaleDateString('es-AR')}</div>
        ${r.cbu_alias ? `<div style="font-size:12px;color:#666">${sanitize(r.cbu_alias)}</div>` : ''}
      </div>
      <span class="badge ${sanitize(r.estado)}">${sanitize(r.estado)}</span>
    </div>
  `).join('');
}

// ─── COMISIONES ───────────────────────────────────────────────────────────────

function renderComisiones(comisiones) {
  const el = $('lista-comisiones');
  if (!comisiones?.length) { el.innerHTML = '<div class="empty">Aún no tenés comisiones registradas.</div>'; return; }
  el.innerHTML = comisiones.map(c => {
    const pct   = c.tasa_aplicada >= 0.05 ? '5%' : '2%';
    const meses = c.meses_activo;
    return `
      <div class="hist-row">
        <div>
          <div style="font-weight:600">${fmt(c.monto_pedido)} venta</div>
          <div style="font-size:12px;color:#888">${new Date(c.created_at).toLocaleDateString('es-AR')} · ${meses} mes${meses !== 1 ? 'es' : ''} activo</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="tasa">${pct}</span>
          <span class="monto-com">${fmt(c.monto_comision)}</span>
        </div>
      </div>
    `;
  }).join('');
}

// ─── PATROCINIOS / COMERCIOS ──────────────────────────────────────────────────

function renderPatrocinios(patrocinios) {
  const el = $('lista-comercios');
  if (!patrocinios?.length) { el.innerHTML = '<div class="empty">No registraste comercios aún.</div>'; return; }
  el.innerHTML = patrocinios.map(p => {
    const c         = p.comercios ?? {};
    const inicio    = new Date(p.fecha_inicio);
    const mesesActivo = Math.floor((Date.now() - inicio) / (1000 * 60 * 60 * 24 * 30));
    const tasa      = mesesActivo < 6 ? '5%' : '2%';
    const estado    = sanitize(c.estado_registro ?? '—');
    return `
      <div class="card item" style="padding:14px 0;border-bottom:1px solid #f0f0f0">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:700">${sanitize(c.nombre ?? '—')}</div>
            <div style="font-size:12px;color:#888">${sanitize(c.direccion ?? '')} · ${sanitize(c.categoria ?? '')}</div>
            <div style="font-size:12px;color:#666;margin-top:4px">
              Desde ${inicio.toLocaleDateString('es-AR')} · ${mesesActivo} mes${mesesActivo !== 1 ? 'es' : ''} activo
            </div>
          </div>
          <div style="text-align:right">
            <span class="tasa">${tasa}</span>
            <div style="font-size:12px;margin-top:4px" class="badge ${estado}">${estado}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── MODAL RETIRO ─────────────────────────────────────────────────────────────

function bindRetiroModal() {
  $('btn-solicitar-retiro').addEventListener('click', () => {
    $('modal-saldo-info').textContent = `Saldo disponible: ${fmt(SALDO_DISPONIBLE)}`;
    $('retiro-monto').value = '';
    $('retiro-cbu').value   = '';
    $('retiro-error').textContent = '';
    $('modal-retiro').classList.add('open');
  });

  $('btn-cancelar-retiro').addEventListener('click', () => {
    $('modal-retiro').classList.remove('open');
  });

  $('btn-confirmar-retiro').addEventListener('click', async () => {
    const monto    = Number($('retiro-monto').value);
    const cbu      = $('retiro-cbu').value.trim();
    const errEl    = $('retiro-error');

    if (!monto || monto <= 0) { errEl.textContent = 'Ingresá un monto válido.'; return; }
    if (monto > SALDO_DISPONIBLE) {
      errEl.textContent = `Insuficiente. Disponible: ${fmt(SALDO_DISPONIBLE)}`; return;
    }

    $('btn-confirmar-retiro').disabled = true;
    errEl.textContent = '';

    try {
      const res = await authFetch(`${API}/api/embajadores/solicitar-retiro`, {
        method: 'POST',
        body:   JSON.stringify({ monto, cbu_alias: cbu || null }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        errEl.textContent = json.error ?? `Error ${res.status}`;
        return;
      }
      $('modal-retiro').classList.remove('open');
      toast(`Retiro de ${fmt(monto)} solicitado. Revisaremos tu solicitud en breve.`);
      await cargarDashboard();
    } catch (err) {
      errEl.textContent = 'Error de red. Intentá nuevamente.';
    } finally {
      $('btn-confirmar-retiro').disabled = false;
    }
  });
}

// ─── FORM ALTA COMERCIO ───────────────────────────────────────────────────────

function bindFormAlta() {
  $('form-alta').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn    = $('btn-alta');
    const msgEl  = $('alta-msg');
    const nombre    = $('c-nombre').value.trim();
    const direccion = $('c-direccion').value.trim();
    const rubro     = $('c-rubro').value.trim();
    const telefono  = $('c-tel').value.trim();
    const email     = $('c-email').value.trim();

    if (!nombre || !direccion || !rubro) { toast('Completá los campos obligatorios.'); return; }

    btn.disabled    = true;
    btn.textContent = 'Registrando...';
    msgEl.textContent = '';

    try {
      const res = await authFetch(`${API}/api/embajadores/comercios`, {
        method: 'POST',
        body:   JSON.stringify({ nombre, direccion, rubro, telefono: telefono || null, email: email || null }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        toast('Error: ' + (json.error ?? res.status));
        return;
      }
      msgEl.textContent = `"${json.comercio?.nombre}" registrado. Estado: pendiente de aprobación.`;
      $('form-alta').reset();
      await cargarDashboard();
    } catch (err) {
      toast('Error de red al registrar el comercio.');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Registrar Comercio';
    }
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function authFetch(url, opts = {}) {
  return fetch(url, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${SESSION.access_token}`,
      ...(opts.headers ?? {}),
    },
  });
}

function sanitize(str) {
  return String(str ?? '').replace(/[<>"'&]/g, c => ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":"&#39;", '&':'&amp;' }[c]));
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
init();
