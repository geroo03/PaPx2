/**
 * comercio.js — Puerta a Puerta Portal
 * Event delegation total. Cero handlers inline.
 */

import { supabase as sb } from './config.js';

// ─── CONSTANTES FINANCIERAS ───────────────────────────────────────────────────
// El 15% se SUMA al precio que pone el comercio para el cliente.
// El comercio recibe el 100% de su precio. PaP cobra 15% extra al cliente.
const RECARGO     = 0.15;
const RECARGO_DIV = 1 + RECARGO; // 1.15


// ─── ESTADO GLOBAL ────────────────────────────────────────────────────────────
const S = {
  cid:      null,
  uid:      null,
  comercio: null,
  view:     null,
  pedidos:      [],
  advertencias: [],
  productos:    [],
  categorias:   [],
  ratings:      [],
  realtimeChannel: null,
};

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  if (!sb || !sb.auth) { location.href = './login.html'; return; }
  // ── REAL SUPABASE INIT ─────────────────────────────────────────────────────
  const { data: { session }, error: authErr } = await sb.auth.getSession();
  if (authErr || !session) { location.href = './login.html'; return; }

  const role = session.user.user_metadata?.role;
  if (role !== 'comercio' && role !== 'admin') { location.href = '../index.html'; return; }

  S.uid = session.user.id;

  const { data: com, error: comErr } = await sb
    .from('comercios').select('*').eq('usuario_id', S.uid).single();

  if (comErr || !com) { showToast('No se encontró el comercio.', 'error'); return; }

  S.cid = com.id; S.comercio = com;
  applyComercioToUI(com);
  bindAllEvents();
  setupRealtime();
  navigate('pedidos');
}

// ─── APLICAR DATOS DEL COMERCIO AL UI ─────────────────────────────────────────
function applyComercioToUI(com) {
  setText('topbar-store-name', com.nombre);
  ['pedidos','menu','finanzas','horarios','promo','resenas','tablero'].forEach(v => {
    const el = g(v + '-crumb'); if (el) el.textContent = com.nombre;
  });
  const open = !!com.abierto_ahora;
  const dot  = g('estado-dot');
  const txt  = g('estado-texto');
  const btn  = g('btn-estado');
  if (dot) dot.className   = 'estado-dot ' + (open ? 'open' : 'closed');
  if (txt) txt.textContent = open ? 'Abierto' : 'Cerrado';
  if (btn) btn.classList.toggle('open', open);
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
function navigate(viewName) {
  if (!viewName) return;
  document.querySelectorAll('.nav-link').forEach(a =>
    a.classList.toggle('active', a.dataset.view === viewName));
  document.querySelectorAll('.view').forEach(v =>
    v.classList.toggle('active', v.dataset.view === viewName));
  S.view = viewName;
  g('sidebar')?.classList.remove('open');
  g('sidebar-overlay')?.classList.remove('show');
  ({
    tablero:       loadTablero,
    pedidos:       loadPedidos,
    menu:          loadMenu,
    finanzas:      loadFinanzas,
    horarios:      loadHorarios,
    promociones:   loadPromociones,
    resenas:       loadResenas,
    configuracion: () => {},
  })[viewName]?.();
}

// ─── EVENT DELEGATION ─────────────────────────────────────────────────────────
function bindAllEvents() {
  document.addEventListener('click',  e => {
    const t = e.target.closest('[data-action]');
    if (t) { e.preventDefault(); dispatchAction(t, e); }
  });
  document.addEventListener('change', e => {
    const t = e.target.closest('[data-action]');
    if (t) dispatchAction(t, e);
  });
  g('sidebar-overlay')?.addEventListener('click', () => {
    g('sidebar')?.classList.remove('open');
    g('sidebar-overlay')?.classList.remove('show');
  });
  g('search-pedido')?.addEventListener('input',  e => filterPedidosTable(e.target.value));
  g('search-producto')?.addEventListener('input', e => filterProductosList(e.target.value));
  g('mp-precio')?.addEventListener('input', e => {
    const base = parseFloat(e.target.value) || 0;
    const hint = g('mp-precio-cliente');
    if (hint) hint.textContent = base > 0
      ? `El cliente verá: ARS $${formatNum(Math.round(base * RECARGO_DIV))} (+15% PaP)`
      : '';
  });
  const zone      = g('upload-zone');
  const fileInput = g('input-imagen');
  if (zone) {
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) setUploadFile(file);
    });
    // Clic en cualquier parte de la zona abre el picker.
    // El guard evita el bucle: el click sintético del input burbujea aquí y se ignora.
    zone.addEventListener('click', e => {
      if (e.target === fileInput) return;
      fileInput?.click();
    });
  }
  fileInput?.addEventListener('change', e => {
    const file = e.target.files[0]; if (file) setUploadFile(file);
  });
}

function setUploadFile(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = g('upload-preview'); if (img) img.src = ev.target.result;
    g('upload-preview-wrap')?.classList.remove('hidden');
    g('upload-placeholder')?.classList.add('hidden');
  };
  reader.readAsDataURL(file);
}

function dispatchAction(t, originalEvent) {
  const action = t.dataset.action;
  const id     = t.dataset.id;
  switch (action) {
    case 'nav':                  navigate(t.dataset.view); break;
    case 'toggle-sidebar':       toggleSidebar(); break;
    case 'toggle-estado':        toggleEstado(); break;
    case 'logout':               logout(); break;
    case 'date-filter':          setDateFilter(t.dataset.period); break;
    case 'aceptar-pedido':       aceptarPedido(id); break;
    case 'rechazar-pedido':      rechazarPedido(id); break;
    case 'marcar-listo':         marcarListo(id); break;
    case 'toggle-row':           togglePedidoRow(id); break;
    case 'open-modal-producto':  openModalProducto(); break;
    case 'save-producto':        saveProducto(); break;
    case 'close-modal':          closeAllModals(); break;
    case 'trigger-upload':
      // Guard: el click sintético del input burbujea hacia upload-zone y re-dispara
      // esta acción. Si el origen ES el input, cortamos el bucle.
      if (originalEvent?.target?.id !== 'input-imagen') g('input-imagen')?.click();
      break;
    case 'select-categoria':     selectCategoria(id); break;
    case 'toggle-producto':      toggleProducto(t, id); break;
    case 'menu-subtab':          switchMenuSubTab(t.dataset.tab); break;
    case 'edit-producto':        openModalProducto(id); break;
    case 'agregar-seccion':      openModalCategoria(); break;
    case 'save-categoria':       saveCategoria(); break;
    case 'close-modal-categoria':closeModalCategoria(); break;
    case 'agregar-cierre':       openModalCierre(); break;
    case 'save-cierre':          saveCierre(); break;
    case 'close-modal-cierre':   closeModalCierre(); break;
    case 'promo-tab':            switchPromoTab(t.dataset.tab); break;
    case 'pausar-promo':         pausarPromo(id); break;
    case 'eliminar-promo':       eliminarPromo(id); break;
    case 'finanzas-tab':         switchFinanzasTab(t.dataset.tab); break;
    case 'fin-filter':           setFinFilter(t.dataset.period); break;
    case 'config-seccion':       handleConfigSeccion(t.dataset.sec); break;
  }
}

// ─── SIDEBAR & ESTADO ─────────────────────────────────────────────────────────
function toggleSidebar() {
  g('sidebar')?.classList.toggle('open');
  g('sidebar-overlay')?.classList.toggle('show');
}

async function toggleEstado() {
  const nuevo = !S.comercio.abierto_ahora;
  const { error } = await sb.from('comercios').update({ abierto_ahora: nuevo }).eq('id', S.cid);
  if (error) { showToast('Error al cambiar estado', 'error'); return; }
  S.comercio.abierto_ahora = nuevo;
  applyComercioToUI(S.comercio);
  showToast(nuevo ? '✓ Local marcado como Abierto' : 'Local marcado como Cerrado');
}

async function logout() {
  await sb.auth.signOut();
  location.href = './login.html';
}

// ─── VIEW: TABLERO ────────────────────────────────────────────────────────────
async function loadTablero() {
  setText('tablero-nombre', S.comercio?.nombre);

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const [{ data: pedHoy }, { data: productos }] = await Promise.all([
    sb.from('pedidos').select('total,estado').eq('comercio_id', S.cid).gte('created_at', hoy.toISOString()),
    sb.from('productos').select('id,disponible').eq('comercio_id', S.cid),
  ]);
  const facturacion = (pedHoy||[]).filter(p => p.estado === 'entregado')
    .reduce((a, p) => a + (p.total||0), 0);
  setText('dash-pedidos-hoy', (pedHoy||[]).length);
  setText('dash-facturacion', formatARS(facturacion));
  setText('dash-productos',   (productos||[]).filter(p => p.disponible).length);
  setText('dash-deuda',       formatARS(S.comercio?.deuda||0));
}

// ─── VIEW: PEDIDOS ────────────────────────────────────────────────────────────
let pedidosDias = 7;

async function loadPedidos() {
  showLoading('pedidos-loading'); hideEl('pedidos-empty'); hideTableBody('tabla-pedidos');

  const desde = new Date(); desde.setDate(desde.getDate() - pedidosDias);
  const [{ data: peds, error: pErr }, { data: advs }] = await Promise.all([
    sb.from('pedidos')
      .select('id,numero,comercio_id,cadete_id,cliente_id,estado,productos,total,direccion_entrega,created_at,codigo_retiro,propina_cadete,distancia_estimada,pago_cadete')
      .eq('comercio_id', S.cid).gte('created_at', desde.toISOString()).order('created_at', { ascending: false }),
    sb.from('advertencias_comercio').select('id,pedido_id,motivo,created_at').eq('comercio_id', String(S.cid)),
  ]);

  // 4d: Cargar perfiles de cadetes asignados (batch seguro, gracefully degrades si RLS no lo permite aún)
  S.cadetesMap = {};
  try {
    const cadeteIds = [...new Set((peds||[]).filter(p=>p.cadete_id).map(p=>p.cadete_id))];
    if (cadeteIds.length) {
      const { data: perfs } = await sb.from('perfiles').select('id,nombre,apellido,vehiculo,color,avatar_url').in('id', cadeteIds);
      (perfs||[]).forEach(pf => { S.cadetesMap[pf.id] = pf; });
    }
  } catch { /* RLS puede no permitirlo todavía — se muestra sin info de cadete */ }
  hideLoading('pedidos-loading'); showTableBody('tabla-pedidos');
  if (pErr) { showToast('Error al cargar pedidos', 'error'); return; }
  // Normalizo a forma interna para que los renders funcionen con la misma estructura
  S.pedidos = (peds || []).map(p => ({
    ...p,
    subtotal: p.total,
    items: Array.isArray(p.productos) ? p.productos : [],
  }));
  S.advertencias = advs || [];
  const advMap = {};
  S.advertencias.forEach(a => { if (!advMap[a.pedido_id]) advMap[a.pedido_id] = []; advMap[a.pedido_id].push(a); });
  renderPedidosTable(S.pedidos, advMap, S.cadetesMap || {});
  updateNavBadge();
}

function renderPedidosTable(pedidos, advMap = {}, cadetesMap = {}) {
  const tbody = g('tbody-pedidos'); const empty = g('pedidos-empty');
  if (!tbody) return;
  if (!pedidos.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  tbody.innerHTML = pedidos.map(p => {
    const base      = p.subtotal ?? p.total ?? 0;
    const ingresos  = Math.round(base);
    const advsCount = (advMap[p.id] || []).length;
    const fecha     = new Date(p.created_at);
    const fechaStr  = fecha.toLocaleDateString('es-AR', { weekday:'long', day:'numeric', month:'long' });
    const horaStr   = fecha.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' });
    const numRef    = p.numero ? `#${p.numero}` : `#${p.id.slice(0,6).toUpperCase()}`;
    const cadetePerfil = p.cadete_id ? (cadetesMap[p.cadete_id] || null) : null;
    return `
      <tr class="pedido-row" data-pedido-id="${p.id}" data-action="toggle-row" data-id="${p.id}">
        <td><span class="badge badge-${p.estado}">${estadoLabel(p.estado)}</span></td>
        <td>
          <div class="pedido-num">${numRef}</div>
          <div class="pedido-fecha">${fechaStr}, ${horaStr}</div>
          ${cadetePerfil ? `<div style="font-size:11px;color:#666;margin-top:2px;">${esc([cadetePerfil.nombre,cadetePerfil.apellido].filter(Boolean).join(' ')||'Cadete asignado')}</div>` : ''}
        </td>
        <td>${advsCount > 0
          ? `<span class="badge badge-cancelado" title="${(advMap[p.id]||[]).map(a=>a.motivo).join(', ')}">${advsCount} aviso${advsCount>1?'s':''}</span>`
          : '<span class="text-tertiary">—</span>'}</td>
        <td class="text-right fw-medium">${formatARS(base)}</td>
        <td class="text-right fw-semibold text-success" title="total ÷ 1.15 = ingreso neto del comercio">
          ${formatARS(ingresos)}
        </td>
        <td>${accionesPedido(p)}</td>
      </tr>
      <tr class="hidden" id="detail-${p.id}">
        <td colspan="6"><div class="row-detail-content">${detallePedido(p, advMap[p.id]||[], cadetesMap)}</div></td>
      </tr>`;
  }).join('');
}

function estadoLabel(estado) {
  return { nuevo:'NUEVO', preparando:'EN COCINA', listo:'LISTO', en_camino:'EN CAMINO', entregado:'REALIZADO', cancelado:'CANCELADO' }[estado] ?? estado.toUpperCase();
}

function accionesPedido(p) {
  if (p.estado === 'nuevo') return `
    <div class="pedido-actions">
      <button class="btn btn-success btn-sm" data-action="aceptar-pedido" data-id="${p.id}">Aceptar</button>
      <button class="btn btn-danger  btn-sm" data-action="rechazar-pedido" data-id="${p.id}">Rechazar</button>
    </div>`;
  if (p.estado === 'preparando') return `
    <button class="btn btn-outline btn-sm" data-action="marcar-listo" data-id="${p.id}">✓ Marcar listo</button>`;
  return '';
}

function detallePedido(p, advs, cadetesMap = {}) {
  // Soporta p.items y p.productos (normalizado a p.items en loadPedidos)
  const items = Array.isArray(p.items) ? p.items
              : Array.isArray(p.productos) ? p.productos
              : [];
  const filas = items.length
    ? items.map(it => {
        const nombre   = esc(it.nombre || '—');
        const cantidad = it.cantidad || 1;
        const precio   = it.precio_cliente_snapshot || it.precio || 0;
        return `<div class="detail-item"><span>${cantidad}× ${nombre}</span><span>${formatARS(precio * cantidad)}</span></div>`;
      }).join('')
    : '<div class="detail-item text-tertiary">Sin detalle de ítems</div>';
  const advsHTML = advs.length
    ? `<div style="margin-top:8px;padding:8px;background:var(--color-warning-bg);border-radius:6px;font-size:13px"><strong>Avisos:</strong> ${advs.map(a=>esc(a.motivo)).join(' · ')}</div>`
    : '';

  // 4d: Bloque de identidad del cadete
  const cadetePerfil = p.cadete_id ? (cadetesMap[p.cadete_id] || null) : null;
  const cadeteHTML = p.cadete_id ? `
    <div style="margin-top:10px;padding:10px;background:#f0f9ff;border-radius:8px;border:1px solid #bae6fd;">
      <div style="font-size:11px;font-weight:700;color:#0369a1;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px;">Repartidor asignado</div>
      ${cadetePerfil ? `
        <div style="display:flex;align-items:center;gap:10px;">
          ${cadetePerfil.avatar_url
            ? `<img src="${esc(cadetePerfil.avatar_url)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;flex-shrink:0;" />`
            : `<div style="width:36px;height:36px;border-radius:50%;background:#0369a1;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:14px;flex-shrink:0;">${esc((cadetePerfil.nombre||'C').charAt(0).toUpperCase())}</div>`}
          <div>
            <div style="font-size:13px;font-weight:700;">${esc([cadetePerfil.nombre,cadetePerfil.apellido].filter(Boolean).join(' ')||'—')}</div>
            ${cadetePerfil.vehiculo ? `<div style="font-size:11px;color:#666;">${esc([cadetePerfil.vehiculo,cadetePerfil.color].filter(Boolean).join(' · '))}</div>` : ''}
          </div>
        </div>` : `<div style="font-size:12px;color:#666;">ID: ${p.cadete_id.slice(0,8)}…</div>`}
      ${p.codigo_retiro ? `
        <div style="margin-top:8px;padding:8px 12px;background:#fff;border-radius:6px;border:1px dashed #f59e0b;">
          <div style="font-size:11px;color:#92400e;font-weight:700;">Codigo de Retiro (deciselo al cadete)</div>
          <div style="font-size:22px;font-weight:800;letter-spacing:8px;color:#92400e;margin-top:4px;">${esc(p.codigo_retiro)}</div>
        </div>` : ''}
      ${p.distancia_estimada ? `<div style="font-size:11px;color:#666;margin-top:6px;">Distancia: ${p.distancia_estimada} km · Ganancia cadete: ${p.pago_cadete ? formatARS(p.pago_cadete) : '—'}</div>` : ''}
    </div>` : '';

  // 4c: Propina
  const propinaHTML = p.propina_cadete > 0
    ? `<span>Propina cadete: ${formatARS(p.propina_cadete)}</span>`
    : '';

  return `<div class="pedido-detail">
    <div class="detail-items">${filas}</div>
    <div class="detail-meta">
      ${p.tipo_delivery ? `<span>Entrega: ${p.tipo_delivery === 'app' ? 'Cadete PaP' : 'Cadete propio'}</span>` : ''}
      ${p.metodo_pago   ? `<span>Pago: ${esc(p.metodo_pago)}</span>` : ''}
      ${p.direccion_entrega ? `<span>Dir: ${esc(p.direccion_entrega)}</span>` : ''}
      ${p.costo_envio   ? `<span>Envío: ${formatARS(p.costo_envio)}</span>` : ''}
      ${propinaHTML}
      <span><strong>Total: ${formatARS(p.total ?? p.subtotal ?? 0)}</strong></span>
    </div>${cadeteHTML}${advsHTML}</div>`;
}

function togglePedidoRow(id) { g('detail-' + id)?.classList.toggle('hidden'); }
function filterPedidosTable(query) {
  const q = (query||'').toLowerCase();
  document.querySelectorAll('#tbody-pedidos .pedido-row').forEach(tr => {
    const num  = tr.querySelector('.pedido-num')?.textContent.toLowerCase() || '';
    const show = num.includes(q);
    tr.style.display = show ? '' : 'none';
    const dr = g('detail-' + tr.dataset.pedidoId); if (dr) dr.style.display = show ? '' : 'none';
  });
}

function setDateFilter(period) {
  pedidosDias = parseInt(period, 10);
  document.querySelectorAll('.date-pill[data-action="date-filter"]').forEach(p =>
    p.classList.toggle('active', p.dataset.period === period));
  setText('pedidos-period-title', { '7':'Los últimos 7 días', '30':'Los últimos 30 días', '180':'Los últimos 6 meses' }[period] || '');
  loadPedidos();
}

async function aceptarPedido(id) {
  const { error } = await sb.from('pedidos').update({ estado: 'preparando' }).eq('id', id).eq('comercio_id', S.cid);
  if (error) { showToast('Error al aceptar: ' + error.message, 'error'); return; }

  // Difundir oferta a cadetes cercanos (fire & forget — no bloquea la UI)
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session?.access_token) {
      const base = (typeof window !== 'undefined' && window.BACKEND_URL) ? window.BACKEND_URL : '';
      fetch(`${base}/api/pedidos/difundir`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ pedidoId: id, comercioId: S.cid }),
      })
        .then(r => r.json())
        .then(json => {
          if (json.difundido > 0) showToast(`Buscando cadetes — ${json.difundido} notificado(s)`, 'info');
        })
        .catch(e => console.warn('[PaP] No se pudo difundir a cadetes:', e.message));
    }
  } catch (e) {
    console.warn('[PaP] Error al obtener sesión para difundir:', e.message);
  }

  showToast('Pedido enviado a cocina ✓'); loadPedidos();
}

async function rechazarPedido(id) {
  const { error } = await sb.from('pedidos').update({ estado:'cancelado' }).eq('id', id).eq('comercio_id', S.cid);
  if (error) { showToast('Error al rechazar: ' + error.message, 'error'); return; }
  showToast('Pedido rechazado'); loadPedidos();
}

async function marcarListo(id) {
  const { error } = await sb.from('pedidos').update({ estado:'listo' }).eq('id', id).eq('comercio_id', S.cid);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Pedido listo para despachar ✓'); loadPedidos();
}

function updateNavBadge() {
  const nuevos  = S.pedidos.filter(p => p.estado === 'nuevo').length;
  const badge   = g('badge-nuevos-nav');
  if (!badge) return;
  badge.textContent = nuevos;
  badge.classList.toggle('hidden', nuevos === 0);
}

// ─── VIEW: MENÚ ───────────────────────────────────────────────────────────────
let catSelId = null;

async function loadMenu() {
  g('categorias-list') && (g('categorias-list').innerHTML = '<div class="loading-state"><div class="spinner"></div></div>');

  const [{ data: cats }, { data: prods }] = await Promise.all([
    sb.from('categorias_producto').select('id,comercio_id,nombre').eq('comercio_id', S.cid).order('nombre'),
    sb.from('productos').select('id,comercio_id,categoria_id,nombre,descripcion,precio,precio_base,imagen_url,disponible')
      .eq('comercio_id', S.cid).order('nombre'),
  ]);
  S.categorias = cats||[]; S.productos = prods||[];
  renderCategorias();
  selectCategoria(catSelId || S.categorias[0]?.id || null);
}

function renderCategorias() {
  const cont = g('categorias-list'); if (!cont) return;
  if (!S.categorias.length) {
    cont.innerHTML = '<div class="empty-state" style="padding:16px"><p>Sin secciones.</p></div>'; return;
  }
  cont.innerHTML = S.categorias.map(cat => {
    const count = S.productos.filter(p => p.categoria_id === cat.id).length;
    return `<div class="categoria-item ${cat.id === catSelId ? 'active' : ''}" data-action="select-categoria" data-id="${cat.id}">
      <span class="cat-name">${esc(cat.nombre)}</span>
      <span class="cat-badge">${count}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></span>
    </div>`;
  }).join('');
}

function selectCategoria(id) {
  catSelId = id; renderCategorias();
  renderProductos(S.productos.filter(p => p.categoria_id === id), id);
}

function renderProductos(prods, catId) {
  const cont = g('productos-list'); const catH = g('cat-header-nombre');
  if (!cont) return;
  const cat = S.categorias.find(c => c.id === catId);
  if (catH) catH.textContent = cat?.nombre || 'Productos';
  if (!prods.length) {
    cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon"></div><p>Sin productos en esta sección.</p></div>'; return;
  }
  cont.innerHTML = prods.map(p => {
    const precioBase = (p.precio_base ?? p.precio) || 0;
    return `<div class="product-row" data-product-id="${p.id}">
      <div class="product-thumb">${p.imagen_url ? `<img src="${esc(p.imagen_url)}" alt="${esc(p.nombre)}" loading="lazy">` : '<div class="thumb-placeholder"></div>'}</div>
      <div class="product-info">
        <div class="product-name">${esc(p.nombre)}</div>
        <div class="product-desc">${esc(p.descripcion || '')}</div>
        <button class="btn-link-red" data-action="open-promo" data-id="${p.id}" style="margin-top:4px">Crear promoción</button>
      </div>
      <div class="product-controls">
        <label class="pap-toggle" title="${p.disponible ? 'Pausar' : 'Activar'}">
          <input type="checkbox" ${p.disponible ? 'checked' : ''} data-action="toggle-producto" data-id="${p.id}">
          <span class="toggle-slider"></span>
        </label>
        <div class="product-price">${formatARS(precioBase)}</div>
      </div>
    </div>`;
  }).join('');
}

function filterProductosList(query) {
  const q = (query||'').toLowerCase();
  document.querySelectorAll('.product-row').forEach(row => {
    const name = row.querySelector('.product-name')?.textContent.toLowerCase() || '';
    row.style.display = name.includes(q) ? '' : 'none';
  });
}
function switchMenuSubTab(tab) {
  document.querySelectorAll('.pap-tab[data-action="menu-subtab"]').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
}

// ─── MODAL PRODUCTO ───────────────────────────────────────────────────────────
function openModalProducto(prodId = null) {
  clearModalProducto();
  const sel = g('mp-categoria');
  if (sel) sel.innerHTML = '<option value="">Seleccionar categoría...</option>' +
    S.categorias.map(c => `<option value="${c.id}"${c.id === catSelId ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
  if (prodId) {
    const prod = S.productos.find(p => p.id === prodId);
    if (prod) {
      setVal('mp-nombre', prod.nombre); setVal('mp-desc', prod.descripcion||''); setVal('mp-precio', prod.precio_base ?? prod.precio);
      if (sel) sel.value = prod.categoria_id||'';
      const btn = g('mp-save'); if (btn) btn.dataset.editId = prodId;
      setText('modal-producto-title', 'Editar producto');
    }
  } else { setText('modal-producto-title', 'Agregar producto'); }
  g('modal-overlay-producto')?.classList.remove('hidden');
  g('mp-nombre')?.focus();
}

function clearModalProducto() {
  ['mp-nombre','mp-desc','mp-precio'].forEach(id => setVal(id,''));
  setText('mp-precio-cliente','');
  const btn = g('mp-save'); if (btn) delete btn.dataset.editId;
  g('upload-preview-wrap')?.classList.add('hidden');
  g('upload-placeholder')?.classList.remove('hidden');
  const inp = g('input-imagen'); if (inp) inp.value = '';
}

function closeAllModals() {
  document.querySelectorAll('.modal-overlay').forEach(m => m.classList.add('hidden'));
  clearModalProducto();
}

async function saveProducto() {
  const nombre    = (g('mp-nombre')?.value||'').trim();
  const desc      = (g('mp-desc')?.value||'').trim();
  const precioRaw = parseFloat((g('mp-precio')?.value||'').replace(/[^0-9.]/g,''))||0;
  const catId     = g('mp-categoria')?.value||'';
  const editId    = g('mp-save')?.dataset.editId;
  if (!nombre)    { showToast('El nombre es obligatorio',  'warning'); return; }
  if (!precioRaw) { showToast('Ingresá un precio válido',  'warning'); return; }
  if (!catId)     { showToast('Seleccioná una categoría',  'warning'); return; }

  // Subir imagen a Supabase Storage si el usuario seleccionó una
  let imagen_url = null;
  const imgFile = g('input-imagen')?.files[0];
  if (imgFile) {
    const ext  = imgFile.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${S.cid}/${Date.now()}.${ext}`;
    showToast('Subiendo imagen...', 'info');
    const { error: uploadErr } = await sb.storage
      .from('productos')
      .upload(path, imgFile, { upsert: true, contentType: imgFile.type });
    if (uploadErr) {
      showToast('Error al subir imagen: ' + uploadErr.message, 'error');
      return;
    }
    const { data: urlData } = sb.storage.from('productos').getPublicUrl(path);
    imagen_url = urlData?.publicUrl ?? null;
  }

  const payload = {
    nombre, descripcion: desc, precio_base: precioRaw,
    categoria_id: catId, comercio_id: S.cid, disponible: true,
    ...(imagen_url ? { imagen_url } : {}),
  };
  const { error } = editId
    ? await sb.from('productos').update(payload).eq('id', editId)
    : await sb.from('productos').insert(payload);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast(editId ? 'Producto actualizado ✓' : 'Producto agregado ✓');
  closeAllModals(); await loadMenu();
}

async function toggleProducto(inputEl, id) {
  const disponible = inputEl.checked;
  const { error } = await sb.from('productos').update({ disponible }).eq('id', id);
  if (error) { inputEl.checked = !disponible; showToast('Error', 'error'); return; }
  const prod = S.productos.find(p => p.id === id); if (prod) prod.disponible = disponible;
  showToast(disponible ? 'Producto activado ✓' : 'Producto pausado');
}

// ─── MODAL CATEGORÍA ──────────────────────────────────────────────────────────
function openModalCategoria()  { g('modal-overlay-categoria')?.classList.remove('hidden'); g('cat-nombre')?.focus(); }
function closeModalCategoria() { g('modal-overlay-categoria')?.classList.add('hidden'); setVal('cat-nombre',''); }

async function saveCategoria() {
  const nombre = (g('cat-nombre')?.value||'').trim();
  if (!nombre) { showToast('Ingresá un nombre', 'warning'); return; }
  const { error } = await sb.from('categorias_producto').insert({ nombre, comercio_id: S.cid, orden: S.categorias.length });
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Sección creada ✓'); closeModalCategoria(); await loadMenu();
}

// ─── VIEW: FINANZAS ───────────────────────────────────────────────────────────
// FÓRMULA EXACTA: Ventas Netas = subtotal / 1.15 | Ganancia PaP = subtotal - subtotal/1.15

let finDias = 30;

async function loadFinanzas() {
  await loadFinanzasEstado();
  loadContratoData();
}

async function loadFinanzasEstado() {
  showLoading('facturas-loading'); hideEl('facturas-empty'); hideTableBody('tabla-facturas');

  const desde = new Date(); desde.setDate(desde.getDate() - finDias);
  const { data: peds } = await sb.from('pedidos')
    .select('id,total,created_at')
    .eq('comercio_id', S.cid).eq('estado', 'entregado')
    .gte('created_at', desde.toISOString()).order('created_at', { ascending: false });
  hideLoading('facturas-loading'); showTableBody('tabla-facturas');
  const data = peds||[];
  const totalSum = data.reduce((a,p) => a+(p.total||0), 0);
  setText('fin-ventas-netas',  formatARS(totalSum));
  setText('fin-servicio',      formatARS(Math.round(totalSum * RECARGO)));
  setText('fin-total-pagado',  formatARS(totalSum));
  setText('fin-total-pedidos', data.length);
  renderFacturas(data);
}

function renderFacturas(pedidos) {
  const tbody = g('tbody-facturas'); const empty = g('facturas-empty');
  if (!tbody) return;
  if (!pedidos.length) { tbody.innerHTML = ''; empty?.classList.remove('hidden'); return; }
  empty?.classList.add('hidden');
  tbody.innerHTML = pedidos.map(p => {
    const fecha   = new Date(p.created_at).toLocaleDateString('es-AR', { day:'numeric', month:'short', year:'numeric' });
    const base    = p.subtotal ?? p.total ?? 0;
    const ingreso = Math.round(base);
    const numRef  = p.numero ? `#${p.numero}` : `#${(p.id||'').slice(0,6).toUpperCase()}`;
    return `<tr>
      <td class="fw-medium">${numRef}</td>
      <td><span class="badge badge-entregado">FACTURA</span></td>
      <td>${fecha}</td><td class="text-right">1</td>
      <td class="text-right fw-semibold">${formatARS(ingreso)}</td>
      <td><button class="btn-ghost btn-sm" style="font-size:16px;padding:0 4px">↓</button></td>
    </tr>`;
  }).join('');
}

function loadContratoData() {
  const com = S.comercio;
  if (!com) return;
  const set = (id, val) => { const e = g(id); if (e) e.textContent = val||'—'; };
  set('ct-nombre',     com.nombre); set('ct-razon',    com.nombre);
  set('ct-direccion',  com.direccion||'—');
  set('ct-ciudad',     'Santiago del Estero'); set('ct-barrio', 'Santiago del Estero'); set('ct-cp','G4200');
  set('ct-email',      com.email||'—');
  set('ct-titular',    com.nombre); set('ct-cuit','—');
  set('ct-cuenta',     com.cbu_alias ? com.cbu_alias.slice(-4) : '—');
  set('ct-tipo-cuenta','CBU/Alias'); set('ct-banco', com.banco||'—');
}

function setFinFilter(period) {
  finDias = parseInt(period, 10);
  document.querySelectorAll('.date-pill[data-action="fin-filter"]').forEach(p =>
    p.classList.toggle('active', p.dataset.period === period));
  loadFinanzasEstado();
}

function switchFinanzasTab(tab) {
  document.querySelectorAll('.fin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  g('fin-tab-estado')?.classList.toggle('active',   tab === 'estado');
  g('fin-tab-contrato')?.classList.toggle('active', tab === 'contrato');
}

// ─── VIEW: HORARIOS ───────────────────────────────────────────────────────────
// Usa columnas reales: horario_apertura (time), horario_cierre (time), dias_abierto (ARRAY)
async function loadHorarios() { renderHorarios(); }

function renderHorarios() {
  const grid = g('horarios-grid'); if (!grid) return;
  const com  = S.comercio;
  const apertura  = (com?.horario_apertura||'').slice(0,5);
  const cierre    = (com?.horario_cierre  ||'').slice(0,5);
  const diasRaw   = Array.isArray(com?.dias_abierto) ? com.dias_abierto : [];
  const diasSet   = new Set(diasRaw.map(d => String(d).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'')));
  const DIAS = [
    {key:'lunes',label:'Lunes'},{key:'martes',label:'Martes'},{key:'miercoles',label:'Miércoles'},
    {key:'jueves',label:'Jueves'},{key:'viernes',label:'Viernes'},{key:'sabado',label:'Sábado'},{key:'domingo',label:'Domingo'},
  ];
  grid.innerHTML = DIAS.map(({key,label}) => {
    const isOpen = diasSet.has(key) || diasSet.has(key.slice(0,3));
    const chips  = (isOpen && apertura && cierre)
      ? `<span class="horario-chip">${apertura} - ${cierre}</span>`
      : '<span class="horario-cerrado">Cerrado</span>';
    return `<div class="horario-row"><span class="horario-dia">${label}</span><div class="horario-turnos">${chips}</div></div>`;
  }).join('');
}

function openModalCierre() {
  const inp = g('cierre-fecha'); if (inp) inp.min = new Date().toISOString().split('T')[0];
  g('modal-overlay-cierre')?.classList.remove('hidden');
}
function closeModalCierre() { g('modal-overlay-cierre')?.classList.add('hidden'); setVal('cierre-fecha',''); setVal('cierre-motivo',''); }
function saveCierre() {
  if (!g('cierre-fecha')?.value) { showToast('Seleccioná una fecha','warning'); return; }
  showToast('Cierre especial configurado ✓'); closeModalCierre();
}

// ─── VIEW: PROMOCIONES ────────────────────────────────────────────────────────
// EJEMPLO FINANCIERO:
//   Base $1.000 → descuento 20% → base_promo $800 → cliente paga $920 (+15% PaP) → PaP gana $120

async function loadPromociones() {
  // Promociones view — real data loaded via switchPromoTab -> loadMisPromociones
}

function switchPromoTab(tab) {
  document.querySelectorAll('.promo-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.promo-tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === tab));
  if (tab === 'mis-promociones') loadMisPromociones();
}

async function loadMisPromociones() {
  const list = g('mis-promociones-list'); if (!list) return;
  list.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  const { data } = await sb.from('promociones').select('*').eq('comercio_id', S.cid).order('created_at', { ascending: false });
  if (!data?.length) { list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"></div><p>No tenés promociones creadas.</p></div>'; return; }
  list.innerHTML = `<div class="table-wrap"><table class="pap-table"><thead><tr><th>Estado</th><th>Tipo</th><th>Valor</th><th>Precio cliente</th><th>Vence</th><th></th></tr></thead>
    <tbody>${data.map(p => {
      const activa = p.activa && new Date(p.fecha_fin) > new Date();
      const descPct = parseFloat(p.valor||0)/100;
      const precioFin = Math.round(1000*(1-descPct)*RECARGO_DIV);
      return `<tr><td><span class="badge ${activa?'badge-listo':'badge-cancelado'}">${activa?'ACTIVA':'VENCIDA'}</span></td>
        <td>${promoLabel(p.tipo)}</td><td>${p.valor?p.valor+'%':'—'}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${p.valor?`Ej: $1.000 → $${formatNum(precioFin)}`:'—'}</td>
        <td>${p.fecha_fin?new Date(p.fecha_fin).toLocaleDateString('es-AR'):'—'}</td>
        <td><div class="pedido-actions">
          ${activa?`<button class="btn btn-outline btn-sm" data-action="pausar-promo" data-id="${p.id}">Pausar</button>`:''}
          <button class="btn btn-danger btn-sm" data-action="eliminar-promo" data-id="${p.id}">Eliminar</button>
        </div></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function promoLabel(tipo) {
  return { descuento_porcentaje:'Descuento %', envio_gratis:'Envío gratis', '2x1':'2×1' }[tipo] ?? tipo;
}

async function pausarPromo(id) {
  const { error } = await sb.from('promociones').update({ activa: false }).eq('id', id);
  if (error) { showToast('Error', 'error'); return; }
  showToast('Promoción pausada'); loadMisPromociones();
}

async function eliminarPromo(id) {
  const { error } = await sb.from('promociones').delete().eq('id', id);
  if (error) { showToast('Error', 'error'); return; }
  showToast('Promoción eliminada'); loadMisPromociones();
}

// ─── VIEW: RESEÑAS ────────────────────────────────────────────────────────────
// Tabla 'ratings' — columnas reales: puntaje_comercio, puntaje_cadete, comentario
async function loadResenas() {
  const list = g('resenas-list');
  if (list) list.innerHTML = '<div class="loading-state"><div class="spinner"></div></div>';

  const { data, error } = await sb.from('ratings')
    .select('id,pedido_id,comercio_id,puntaje_comercio,puntaje_cadete,comentario,created_at')
    .eq('comercio_id', S.cid).order('created_at', { ascending: false });
  if (error) { showToast('Error al cargar reseñas', 'error'); return; }
  S.ratings = data||[];
  renderResumenResenas(S.ratings); renderListaResenas(S.ratings);
}

function renderResumenResenas(ratings) {
  if (!ratings.length) {
    setText('resenas-avg','—'); setText('resenas-count','Sin reseñas aún');
    for (let i=1;i<=5;i++) { const b=g('bar-'+i); if(b) b.style.width='0%'; } return;
  }
  const validos = ratings.filter(r => r.puntaje_comercio != null);
  const avg = validos.reduce((a,r) => a+r.puntaje_comercio, 0) / (validos.length||1);
  setText('resenas-avg',   avg.toFixed(1));
  setText('resenas-count', ratings.length + ' reseña' + (ratings.length !== 1 ? 's' : ''));
  for (let i=1;i<=5;i++) {
    const count = validos.filter(r => r.puntaje_comercio === i).length;
    const pct   = validos.length ? Math.round(count/validos.length*100) : 0;
    const bar = g('bar-'+i); const cnt = g('bar-count-'+i);
    if (bar) bar.style.width = pct+'%'; if (cnt) cnt.textContent = count;
  }
}

function renderListaResenas(ratings) {
  const list = g('resenas-list'); if (!list) return;
  if (!ratings.length) { list.innerHTML = '<div class="empty-state"><div class="empty-state-icon"></div><p>Aún no tenés reseñas.</p></div>'; return; }
  const starFilter = parseInt(g('resenas-stars-filter')?.value||'0', 10);
  const filtered   = starFilter ? ratings.filter(r => r.puntaje_comercio === starFilter) : ratings;
  if (!filtered.length) { list.innerHTML = '<div class="empty-state"><p>Sin reseñas para este filtro.</p></div>'; return; }
  list.innerHTML = filtered.map(r => {
    const fecha = new Date(r.created_at);
    const pts   = r.puntaje_comercio || 0;
    const estrs = '★'.repeat(pts) + '☆'.repeat(5-pts);
    const ordenId = r.pedido_id?.slice(0,8).toUpperCase() ?? '—';
    return `<div class="resena-card">
      <div class="resena-head">
        <div>
          <div class="resena-orden">Orden ${ordenId}</div>
          <div class="resena-fecha">${fecha.toLocaleDateString('es-AR')} ${fecha.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
        <div class="resena-stars">${estrs}</div>
      </div>
      ${r.puntaje_cadete != null ? `<div style="font-size:12px;color:var(--text-tertiary);margin-bottom:4px">Cadete: ${'★'.repeat(r.puntaje_cadete)}${'☆'.repeat(5-r.puntaje_cadete)}</div>` : ''}
      ${r.comentario ? `<p class="resena-comentario">${esc(r.comentario)}</p>` : ''}
      <button class="btn btn-outline btn-sm" data-action="ver-orden" data-id="${r.pedido_id}">Ver orden</button>
    </div>`;
  }).join('');
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
function handleConfigSeccion(sec) {
  showToast({ local:'Administración del Local — próximamente', usuarios:'Administración de Usuarios — próximamente', procesamiento:'Permiso procesamiento — próximamente', portada:'Foto de portada — próximamente' }[sec] || 'Próximamente', 'info');
}

// ─── REALTIME ────────────────────────────────────────────────────────────────
function setupRealtime() {
  S.realtimeChannel?.unsubscribe();
  S.realtimeChannel = sb
    .channel('comercio-pedidos-' + S.cid)
    .on('postgres_changes', { event:'*', schema:'public', table:'pedidos', filter:`comercio_id=eq.${S.cid}` },
        payload => handleRealtimePedido(payload))
    .subscribe(status => {
      if (status === 'SUBSCRIBED') console.log('[PaP Realtime] canal activo:', S.cid);
    });
  window.addEventListener('beforeunload', () => S.realtimeChannel?.unsubscribe());
}

function handleRealtimePedido(payload) {
  const { eventType, new: newRow } = payload;
  if (eventType === 'INSERT' && newRow?.estado === 'nuevo') {
    playBeep(); showToast('¡Nuevo pedido recibido!', 'success');
    bumpBadge('badge-nuevos-nav');
  }
  if (S.view === 'pedidos') loadPedidos();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine'; osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.4);
  } catch (_) {}
}

function bumpBadge(id) {
  const b = g(id); if (!b) return;
  b.textContent = (parseInt(b.textContent,10)||0)+1; b.classList.remove('hidden');
}

// ─── UI UTILITIES ─────────────────────────────────────────────────────────────
function showLoading(id)    { g(id)?.classList.remove('hidden'); }
function hideLoading(id)    { g(id)?.classList.add('hidden'); }
function hideEl(id)         { g(id)?.classList.add('hidden'); }
function hideTableBody(id)  { const t = g(id); if (t) t.style.visibility = 'hidden'; }
function showTableBody(id)  { const t = g(id); if (t) t.style.visibility = ''; }

let _toastTimer;
function showToast(msg, type = 'success') {
  const toast = g('toast'); if (!toast) return;
  toast.textContent = msg; toast.className = `toast toast-${type}`;
  toast.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toast.classList.add('hidden'), 3500);
}

// ─── GENERIC HELPERS ──────────────────────────────────────────────────────────
const g       = id  => document.getElementById(id);
const setText = (id,val) => { const e=g(id); if(e) e.textContent = String(val??'—'); };
const setVal  = (id,val) => { const e=g(id); if(e) e.value = val??''; };
const esc     = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function formatNum(n) { return (n||0).toLocaleString('es-AR',{minimumFractionDigits:0,maximumFractionDigits:0}); }
function formatARS(n) { return '$ '+(n||0).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
