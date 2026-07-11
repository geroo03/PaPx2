import { ICONS } from './icons.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// activeTripState: 0=idle | 1=yendo_al_local | 2=en_camino_al_cliente | 3=finalizado
// ═══════════════════════════════════════════════════════════════════════════════
let disp          = sessionStorage.getItem('cadete_disp') !== 'false';
let ofertasPendientes = [];   // ofertas_cadetes con estado 'pendiente'
const OFERTA_TIMEOUT_MS = 20000;
const _ofertaTimers = new Map(); // pedido_id → timeoutId
let activeTrip    = null;     // oferta activa completa
let activeTripState = 0;
let kmChannel     = null;     // canal Realtime para live KM
let cadeteUserId  = null;     // auth UID del cadete autenticado

window._cadete_activeTripState = () => ({ activeTripState, activeTrip });

// ═══════════════════════════════════════════════════════════════════════════════
// HAVERSINE — espejo del backend para cálculo live en el cliente
// ═══════════════════════════════════════════════════════════════════════════════
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// API HELPER — todas las llamadas al backend usan el JWT de la sesión activa
// ═══════════════════════════════════════════════════════════════════════════════
async function apiPost(path, body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session?.access_token) throw new Error('Sin sesión activa');
  const base = (typeof window !== 'undefined' && window.BACKEND_URL) ? window.BACKEND_URL : '';
  const res  = await fetch(`${base}${path}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err  = new Error(json.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.code   = json.error;
    throw err;
  }
  return json;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GPS REPORTER — envía la posición del cadete al backend cada ~10 segundos
// El cliente la ve en tiempo real vía Supabase Realtime (tabla ubicacion_cadetes)
// ═══════════════════════════════════════════════════════════════════════════════
let gpsWatchId   = null;
let gpsLastSent  = 0;
const GPS_SEND_INTERVAL = 10000; // ms entre envíos al backend

function iniciarReporteGPS() {
  if (gpsWatchId !== null) return;
  if (!navigator.geolocation) {
    console.warn('[GPS] Geolocalización no disponible en este navegador');
    return;
  }

  gpsWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const now = Date.now();
      if (now - gpsLastSent < GPS_SEND_INTERVAL) return;
      gpsLastSent = now;

      const pedidoId = activeTrip?.id ?? activeTrip?.pedido_id ?? null;

      try {
        await apiPost('/api/cadete/actualizar-ubicacion', {
          lat:       pos.coords.latitude,
          lng:       pos.coords.longitude,
          pedido_id: pedidoId,
        });
      } catch (err) {
        // Silencioso: si falla un envío, el siguiente lo reintenta
        console.warn('[GPS] Error reportando ubicación:', err.message);
      }
    },
    (err) => {
      console.warn('[GPS] Error de geolocalización:', err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
  console.log('[GPS] Reporte de ubicación iniciado');
}

function detenerReporteGPS() {
  if (gpsWatchId !== null) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    console.log('[GPS] Reporte de ubicación detenido');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function toast(m, d = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = m;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), d);
}

function stab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  document.getElementById('tab-' + tab)?.classList.add('active');
  document.getElementById('sec-' + tab)?.classList.add('active');
  // Highlight bottom nav
  const navMap = { v: 0, h: 1, g: 2, p: 3 };
  document.querySelectorAll('.nav .ni').forEach((ni, i) => ni.classList.toggle('active', i === navMap[tab]));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function removeAlertBtn() {
  document.getElementById('viaje-alert-btn')?.remove();
}

function mapsTo(addr) {
  return 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOGGLE DISPONIBILIDAD
// ═══════════════════════════════════════════════════════════════════════════════
function togDisp() {
  disp = !disp;
  sessionStorage.setItem('cadete_disp', disp ? 'true' : 'false');
  document.getElementById('disp-dot').className = 'disp-dot' + (disp ? ' on' : '');
  document.getElementById('disp-lbl').textContent = disp ? 'Disponible' : 'Inactivo';
  toast(disp ? 'Disponible' : 'Pausaste los viajes');

  if (disp) iniciarReporteGPS();
  else      detenerReporteGPS();

  // Persistir en DB para que el admin y el matching lo vean
  if (cadeteUserId) {
    sb.from('cadetes').update({ disponible: disp, activo: disp }).eq('auth_uid', cadeteUserId)
      .then(({ error }) => {
        if (error) {
          console.error('[togDisp] Error al actualizar disponibilidad en DB:', error.message);
          toast('Error al guardar disponibilidad. Verificá tu conexión.', 3000);
        }
      });
  }

  renderViajes();
}

// ═══════════════════════════════════════════════════════════════════════════════
// LIVE KM — suscripción Realtime a ubicacion_cadetes para el viaje activo
// Recalcula Haversine en cada UPDATE y actualiza el badge en pantalla.
// ═══════════════════════════════════════════════════════════════════════════════
function suscribirKmCadete(pedidoId, targetLat, targetLng, elementId) {
  if (kmChannel) { sb.removeChannel(kmChannel); kmChannel = null; }
  if (!pedidoId || targetLat == null || targetLng == null) return;

  kmChannel = sb
    .channel(`km-cadete-${pedidoId}`)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'ubicacion_cadetes',
      filter: `pedido_id=eq.${pedidoId}`,
    }, payload => {
      const { latitud: lat, longitud: lng } = payload.new ?? {};
      if (lat == null || lng == null) return;
      const el = document.getElementById(elementId);
      if (el) el.textContent = fmtKm(haversineKm(lat, lng, targetLat, targetLng));
    })
    .subscribe();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CARGAR OFERTAS — lee de 'ofertas_cadetes' en lugar de todos los pedidos.
// Cada cadete solo ve las ofertas que le llegaron a él.
// ═══════════════════════════════════════════════════════════════════════════════
async function cargarOfertas() {
  if (!cadeteUserId) return;
  try {
    const { data } = await sb
      .from('ofertas_cadetes')
      .select(`
        id,
        pedido_id,
        comercio_nombre,
        comercio_direccion,
        comercio_lat,
        comercio_lng,
        cliente_direccion,
        distancia_km,
        ganancia_estimada,
        estado,
        pedidos (
          id, numero, estado, total, metodo_pago, direccion_entrega, created_at,
          comercios ( nombre, direccion, telefono )
        )
      `)
      .eq('cadete_id', cadeteUserId)
      .eq('estado', 'pendiente')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .order('distancia_km', { ascending: true });

    const prevMap = new Map(ofertasPendientes.map(o => [o.pedido_id, o]));
    ofertasPendientes = (data ?? []).map(o => {
      const prev = prevMap.get(o.pedido_id);
      return {
        ...o,
        ofertaId:     o.id,
        id:           o.pedido_id,
        ...(o.pedidos ?? {}),
        comercio_lat: o.comercio_lat,
        comercio_lng: o.comercio_lng,
        _shownAt:     prev?._shownAt ?? Date.now(),
      };
    });
  } catch {
    ofertasPendientes = [];
  }
  renderViajes();
  actualizarStats();
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════════════════════════
function renderViajes() {
  const container = document.getElementById('viajes-container');
  if (!container) return;

  if (!disp) {
    container.innerHTML = `
      <div class="no-disp">
        <div class="big">${ICONS.warn}</div>
        <h3>Estás inactivo</h3>
        <p>Activarte para recibir viajes.</p>
        <button class="btn-activar" onclick="togDisp()">Activarme ahora</button>
      </div>`;
    return;
  }

  if (activeTrip) {
    renderTripActivo(container);
    return;
  }

  // Lista de ofertas disponibles
  const badge = document.getElementById('bn');
  if (badge) {
    badge.style.display = ofertasPendientes.length ? 'inline-flex' : 'none';
    badge.textContent   = ofertasPendientes.length;
  }

  if (!ofertasPendientes.length) {
    container.innerHTML = `
      <div class="empty">
        <div class="big">${ICONS.scooter}</div>
        <p>No hay viajes disponibles.<br/>Cuando lleguen aparecen acá.</p>
      </div>`;
    return;
  }

  // Limpiar timers de ofertas que ya no existen
  const currentIds = new Set(ofertasPendientes.map(o => o.pedido_id));
  for (const [pid, tid] of _ofertaTimers) {
    if (!currentIds.has(pid)) { clearTimeout(tid); _ofertaTimers.delete(pid); }
  }

  container.innerHTML = ofertasPendientes.map(o => {
    const hr  = new Date(o.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const gan = o.ganancia_estimada ?? calcularGananciaLocal(o.distancia_km ?? 0);
    const elapsed = Date.now() - (o._shownAt ?? Date.now());
    const remaining = Math.max(0, OFERTA_TIMEOUT_MS - elapsed);
    const remainingSec = (remaining / 1000).toFixed(1);
    return `
      <div class="viaje-card oferta" style="background:#0F1720;padding:0;border-radius:12px;color:#fff;margin-bottom:12px;overflow:hidden;position:relative;">
        <div id="bar-${o.pedido_id}" style="
          height:3px;width:100%;background:linear-gradient(90deg,#FF6B35,#E55A27);
          animation:ofertaCountdown ${remainingSec}s linear forwards;
        "></div>
        <div style="padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
            <div>
              <div style="font-size:14px;font-weight:800;">${o.comercio_nombre ?? o.comercios?.nombre ?? 'Comercio'}</div>
              <div style="font-size:12px;color:#9CA3AF;margin-top:3px;">${o.comercio_direccion ?? o.comercios?.direccion ?? ''}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:13px;color:#FF6B35;font-weight:700;">$${Number(gan).toLocaleString('es-AR')}</div>
              <div style="font-size:11px;color:#6B7280;margin-top:2px;">${o.distancia_km ?? '—'} km · ${hr}</div>
            </div>
          </div>
          <div style="font-size:12px;color:#9CA3AF;margin-bottom:12px;">
            ${ICONS.pin} Entregás en: ${o.cliente_direccion ?? o.direccion_entrega ?? '—'}
          </div>
          <div style="display:flex;gap:10px;">
            <button
              id="btn-rechazar-${o.pedido_id}"
              onclick="rechazarOferta('${o.pedido_id}')"
              style="flex:1;padding:13px;border-radius:10px;background:transparent;border:1px solid rgba(255,255,255,0.1);color:#9CA3AF;font-weight:700;">
              Rechazar
            </button>
            <button
              id="btn-aceptar-${o.pedido_id}"
              onclick="aceptarViaje('${o.pedido_id}')"
              style="flex:2;padding:13px;border-radius:10px;background:linear-gradient(135deg,#FF6B35,#E55A27);color:#fff;border:none;font-weight:800;">
              ${ICONS.check} Aceptar viaje · $${Number(gan).toLocaleString('es-AR')}
            </button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Programar auto-rechazo para cada oferta
  ofertasPendientes.forEach(o => {
    if (_ofertaTimers.has(o.pedido_id)) return;
    const elapsed = Date.now() - (o._shownAt ?? Date.now());
    const remaining = Math.max(0, OFERTA_TIMEOUT_MS - elapsed);
    if (remaining <= 0) { rechazarOferta(o.pedido_id); return; }
    _ofertaTimers.set(o.pedido_id, setTimeout(() => {
      _ofertaTimers.delete(o.pedido_id);
      rechazarOferta(o.pedido_id);
      toast('Oferta expirada — esperando nuevos viajes');
    }, remaining));
  });
}

function renderTripActivo(container) {
  const v              = activeTrip;
  const hr             = new Date(v.created_at ?? Date.now()).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const gan            = v.ganancia_estimada ?? calcularGananciaLocal(v.distancia_km ?? 0);
  const comercioNombre = v.comercio_nombre ?? v.comercios?.nombre ?? 'Comercio';
  const comercioDirec  = v.comercio_direccion ?? v.comercios?.direccion ?? '';
  const comercioTel    = v.comercios?.telefono ?? '';
  const clienteDirec   = v.cliente_direccion ?? v.direccion_entrega ?? '';
  const clienteTel     = v.cliente_telefono ?? '';
  const metPago        = v.metodo_pago ?? 'Efectivo';
  const total          = v.total ?? 0;

  const alertBtnHtml = `
    <button id="viaje-alert-btn"
      style="position:fixed;right:18px;bottom:140px;z-index:1400;width:54px;height:54px;
             border-radius:999px;background:#fff;border:1px solid rgba(0,0,0,.06);
             display:flex;align-items:center;justify-content:center;font-size:20px;
             box-shadow:0 10px 30px rgba(0,0,0,.12);">
      ${ICONS.warn}
    </button>`;

  // ── Estado 1: yendo al local ──────────────────────────────────────────────
  if (activeTripState === 1) {
    container.innerHTML = `
      <div class="viaje-card nuevo"
        style="background:linear-gradient(180deg,#0F1720,#0B1220);padding:16px;border-radius:12px;color:#fff;">

        <!-- Header con nombre del comercio y ganancia -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:13px;font-weight:800;">${comercioNombre}</div>
            <div style="font-size:12px;color:#cfcfcf;margin-top:3px;">${comercioDirec}</div>
            ${comercioTel ? `<div style="font-size:12px;color:#9CA3AF;margin-top:2px;">Tel: ${comercioTel}</div>` : ''}
          </div>
          <div style="text-align:right;">
            <div style="font-size:14px;font-weight:800;color:#4ADE80;">$${Number(gan).toLocaleString('es-AR')}</div>
            <div style="font-size:11px;color:#6B7280;margin-top:2px;">${hr}</div>
          </div>
        </div>

        <!-- Badge de distancia en vivo al comercio -->
        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);
                    border-radius:8px;padding:8px 12px;margin-bottom:14px;">
          <span style="font-size:18px;">${ICONS.pin}</span>
          <div>
            <div style="font-size:11px;color:#9CA3AF;">Distancia al local (en vivo)</div>
            <div id="km-al-local" style="font-size:16px;font-weight:800;color:#60A5FA;">
              ${v.distancia_km != null ? fmtKm(v.distancia_km) : '—'}
            </div>
          </div>
        </div>

        <!-- Código de retiro: el comercio te lo da cuando llegás -->
        <div style="background:rgba(255,165,0,0.08);border:1px solid rgba(255,165,0,0.25);
                    border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#FCD34D;margin-bottom:8px;">
            Codigo de Retiro
          </div>
          <div style="font-size:11px;color:#9CA3AF;margin-bottom:10px;">
            El comercio te dará un código de 4 dígitos al llegar. Ingresalo acá para confirmar el retiro.
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <input
              id="input-codigo-retiro"
              type="number"
              inputmode="numeric"
              maxlength="4"
              placeholder="0000"
              oninput="this.value=this.value.slice(0,4);validarInputCodigo('btn-confirmar-retiro','input-codigo-retiro')"
              style="width:90px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
                     background:rgba(255,255,255,0.05);color:#fff;font-size:20px;font-weight:800;
                     text-align:center;letter-spacing:6px;"
            />
            <button
              id="btn-confirmar-retiro"
              onclick="confirmarRetiro()"
              disabled
              style="flex:1;padding:11px;border-radius:8px;
                     background:linear-gradient(135deg,#F59E0B,#D97706);
                     color:#fff;border:none;font-weight:800;opacity:0.5;cursor:not-allowed;">
              Confirmar Retiro
            </button>
          </div>
          <div id="err-retiro" style="display:none;font-size:11px;color:#F87171;">
            Código incorrecto. Pedíselo de nuevo al comercio.
          </div>
        </div>

        <!-- Botón de navegación al local -->
        <a class="btn-o" href="${mapsTo(comercioDirec)}" target="_blank"
          style="display:flex;align-items:center;justify-content:center;gap:6px;
                 padding:13px;border-radius:10px;background:transparent;
                 border:1px solid rgba(255,255,255,0.1);color:#fff;text-decoration:none;font-weight:700;">
          ${ICONS.pin} Ver ruta al Local
        </a>
        ${renderChatCadete(v.id ?? v.pedido_id)}
      </div>`;

    document.body.insertAdjacentHTML('beforeend', alertBtnHtml);
    document.getElementById('viaje-alert-btn')?.addEventListener('click', () => {
      if (confirm('¿Reportar un problema con este viaje al administrador?')) toast('Reporte enviado.');
    });
    initChatCadete(v.id ?? v.pedido_id);
    return;
  }

  // ── Estado 2: en camino al cliente ────────────────────────────────────────
  if (activeTripState === 2) {
    container.innerHTML = `
      <div class="viaje-card activo"
        style="background:linear-gradient(180deg,#081018,#061018);padding:16px;border-radius:12px;color:#fff;">

        <!-- Header con datos del cliente -->
        <div style="margin-bottom:10px;">
          <div style="font-size:13px;font-weight:800;">Entregás a: ${clienteDirec}</div>
          ${clienteTel ? `<div style="font-size:12px;color:#9CA3AF;margin-top:3px;">Tel: ${clienteTel}</div>` : ''}
          <div style="font-size:12px;color:#9CA3AF;margin-top:3px;">
            Pago: ${metPago}${metPago === 'Efectivo' ? ` · $${Number(total).toLocaleString('es-AR')}` : ''}
          </div>
        </div>

        <!-- Badge de distancia en vivo al cliente -->
        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);
                    border-radius:8px;padding:8px 12px;margin-bottom:14px;">
          <span style="font-size:18px;"></span>
          <div>
            <div style="font-size:11px;color:#9CA3AF;">Distancia al cliente (en vivo)</div>
            <div id="km-al-cliente" style="font-size:16px;font-weight:800;color:#34D399;">—</div>
          </div>
        </div>

        <!-- Código de entrega: el cliente te lo muestra al llegar -->
        <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);
                    border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#6EE7B7;margin-bottom:8px;">
            Codigo de Entrega
          </div>
          <div style="font-size:11px;color:#9CA3AF;margin-bottom:10px;">
            El cliente te mostrará un código de 4 dígitos en su celular. Ingresalo para confirmar la entrega.
          </div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
            <input
              id="input-codigo-entrega"
              type="number"
              inputmode="numeric"
              maxlength="4"
              placeholder="0000"
              oninput="this.value=this.value.slice(0,4);validarInputCodigo('btn-confirmar-entrega','input-codigo-entrega')"
              style="width:90px;padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);
                     background:rgba(255,255,255,0.05);color:#fff;font-size:20px;font-weight:800;
                     text-align:center;letter-spacing:6px;"
            />
            <button
              id="btn-confirmar-entrega"
              onclick="confirmarEntrega()"
              disabled
              style="flex:1;padding:11px;border-radius:8px;
                     background:linear-gradient(135deg,#10B981,#059669);
                     color:#fff;border:none;font-weight:800;opacity:0.5;cursor:not-allowed;">
              Confirmar Entrega
            </button>
          </div>
          <div id="err-entrega" style="display:none;font-size:11px;color:#F87171;">
            Código incorrecto. Pedíselo de nuevo al cliente.
          </div>
        </div>

        <!-- Botón de navegación al cliente -->
        <a class="btn-o" href="${mapsTo(clienteDirec)}" target="_blank"
          style="display:flex;align-items:center;justify-content:center;gap:6px;
                 padding:13px;border-radius:10px;background:transparent;
                 border:1px solid rgba(255,255,255,0.1);color:#fff;text-decoration:none;font-weight:700;">
          ${ICONS.pin} Ver ruta de Entrega
        </a>
        ${renderChatCadete(v.id ?? v.pedido_id)}

        <!-- No-show: cliente no aparece -->
        <div id="noshow-wrap" style="margin-top:12px;">
          <button onclick="iniciarTimerNoShow()"
            style="width:100%;padding:12px;border-radius:10px;background:transparent;
                   border:1px solid rgba(220,38,38,0.3);color:#F87171;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;">
            El cliente no aparece
          </button>
        </div>
        <div id="noshow-timer" style="display:none;margin-top:12px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);border-radius:10px;padding:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-size:12px;font-weight:700;color:#F87171;">Esperando al cliente...</div>
            <div id="noshow-countdown" style="font-size:20px;font-weight:900;color:#F87171;font-variant-numeric:tabular-nums;">10:00</div>
          </div>
          <div style="height:4px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;">
            <div id="noshow-bar" style="height:100%;width:100%;background:linear-gradient(90deg,#EF4444,#DC2626);border-radius:4px;transition:width 0.5s linear;"></div>
          </div>
          <button id="noshow-cancel-btn" onclick="cancelarPorNoShow()" disabled
            style="width:100%;margin-top:12px;padding:12px;border-radius:10px;background:#DC2626;color:#fff;border:none;
                   font-weight:800;cursor:pointer;font-family:inherit;font-size:14px;opacity:0.4;">
            Cancelar entrega (habilitado en 0:00)
          </button>
        </div>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', alertBtnHtml);
    document.getElementById('viaje-alert-btn')?.addEventListener('click', () => {
      if (confirm('¿Reportar un problema con este viaje al administrador?')) toast('Reporte enviado.');
    });
    initChatCadete(v.id ?? v.pedido_id);
    return;
  }

  // ── Estado 3: finalizado ─────────────────────────────────────────────────
  if (activeTripState === 3) {
    const ganFinal = activeTrip.ganancia_estimada ?? calcularGananciaLocal(activeTrip.distancia_km ?? 0);
    container.innerHTML = `
      <div class="empty">
        <div class="big">${ICONS.check}</div>
        <p>Viaje finalizado con éxito.<br/>¡Gracias!</p>
      </div>`;
    setTimeout(() => {
      activeTrip = null;
      activeTripState = 0;
      if (kmChannel) { sb.removeChannel(kmChannel); kmChannel = null; }
      actualizarStats();
      renderViajes();
      toast(`${ICONS.confetti} ¡Viaje completado! Ganaste $${Number(ganFinal).toLocaleString('es-AR')}`, 3500);
    }, 1200);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDAR INPUT DE CÓDIGO — habilita el botón cuando se ingresaron 4 dígitos
// ═══════════════════════════════════════════════════════════════════════════════
function validarInputCodigo(btnId, inputId) {
  const val = document.getElementById(inputId)?.value ?? '';
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const valido = /^\d{4}$/.test(val);
  btn.disabled       = !valido;
  btn.style.opacity  = valido ? '1' : '0.5';
  btn.style.cursor   = valido ? 'pointer' : 'not-allowed';
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACEPTAR VIAJE — llama al backend con anti-colisión, maneja 409
// ═══════════════════════════════════════════════════════════════════════════════
async function aceptarViaje(pedidoId) {
  const oferta = ofertasPendientes.find(o => o.pedido_id === pedidoId || o.id === pedidoId);
  if (!oferta) return;

  const btn = document.getElementById(`btn-aceptar-${pedidoId}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Aceptando...'; }

  try {
    // Limpiar timer de esta oferta
    if (_ofertaTimers.has(pedidoId)) { clearTimeout(_ofertaTimers.get(pedidoId)); _ofertaTimers.delete(pedidoId); }

    await apiPost('/api/pedidos/aceptar', {
      pedidoId:  pedidoId,
      cadeteId:  cadeteUserId,
      ofertaId:  oferta.ofertaId,
    });

    activeTrip      = { ...oferta, id: pedidoId };
    activeTripState = 1;
    ofertasPendientes = ofertasPendientes.filter(o => o.pedido_id !== pedidoId && o.id !== pedidoId);

    // Iniciar live KM hacia el comercio
    suscribirKmCadete(pedidoId, oferta.comercio_lat, oferta.comercio_lng, 'km-al-local');

    renderViajes();
    toast(`${ICONS.check} ¡Viaje aceptado! Andá a retirar al local`, 3000);
    sonarViaje();

  } catch (err) {
    if (err.status === 409) {
      toast(`${ICONS.warn} Este viaje ya fue tomado por otro cadete`, 3000);
      ofertasPendientes = ofertasPendientes.filter(o => o.pedido_id !== pedidoId && o.id !== pedidoId);
      renderViajes();
    } else {
      toast(`${ICONS.warn} Error al aceptar el viaje. Intentá de nuevo.`, 3000);
      if (btn) { btn.disabled = false; btn.textContent = `Aceptar viaje · $${oferta.ganancia_estimada ?? '—'}`; }
    }
  }
}

function rechazarOferta(pedidoId) {
  if (_ofertaTimers.has(pedidoId)) { clearTimeout(_ofertaTimers.get(pedidoId)); _ofertaTimers.delete(pedidoId); }
  ofertasPendientes = ofertasPendientes.filter(o => o.pedido_id !== pedidoId && o.id !== pedidoId);
  renderViajes();
  toast(`${ICONS.warn} Viaje rechazado`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMAR RETIRO (Estado 1 → 2) — envía codigo_retiro al backend
// La validación del código se implementa en Fase 4. En esta fase la UI ya
// está lista y el campo viaja en el body para cuando el backend lo consuma.
// ═══════════════════════════════════════════════════════════════════════════════
async function confirmarRetiro() {
  if (!activeTrip) return;
  const codigo = document.getElementById('input-codigo-retiro')?.value?.trim() ?? '';
  if (!/^\d{4}$/.test(codigo)) {
    toast(`${ICONS.warn} Ingresá el código de 4 dígitos del comercio`, 2500);
    return;
  }

  const btn = document.getElementById('btn-confirmar-retiro');
  if (btn) { btn.disabled = true; btn.textContent = 'Confirmando...'; }

  try {
    await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id:     activeTrip.id ?? activeTrip.pedido_id,
      nuevo_estado:  'en_camino',
      codigo_retiro: codigo,  // validado en Fase 4
    });

    activeTripState = 2;

    // Redirigir live KM hacia el cliente cuando haya coordenadas disponibles
    if (activeTrip.cliente_lat && activeTrip.cliente_lng) {
      suscribirKmCadete(
        activeTrip.id ?? activeTrip.pedido_id,
        activeTrip.cliente_lat,
        activeTrip.cliente_lng,
        'km-al-cliente',
      );
    }

    removeAlertBtn();
    renderViajes();
    toast(`${ICONS.check} Retiro confirmado · En camino al cliente`, 2500);

  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Retiro'; }
    const errEl = document.getElementById('err-retiro');
    if (err.status === 403) {
      if (errEl) errEl.style.display = 'block';
      toast(`${ICONS.close} Código de retiro incorrecto`, 2500);
    } else {
      toast(`${ICONS.warn} Error al confirmar retiro. Intentá de nuevo.`, 2500);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIRMAR ENTREGA (Estado 2 → 3) — envía codigo_entrega al backend
// ═══════════════════════════════════════════════════════════════════════════════
async function confirmarEntrega() {
  if (!activeTrip) return;
  const codigo = document.getElementById('input-codigo-entrega')?.value?.trim() ?? '';
  if (!/^\d{4}$/.test(codigo)) {
    toast(`${ICONS.warn} Ingresá el código de 4 dígitos del cliente`, 2500);
    return;
  }

  const btn = document.getElementById('btn-confirmar-entrega');
  if (btn) { btn.disabled = true; btn.textContent = 'Entregando...'; }

  try {
    await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id:      activeTrip.id ?? activeTrip.pedido_id,
      nuevo_estado:   'entregado',
      codigo_entrega: codigo,  // validado en Fase 4
    });

    activeTripState = 3;
    removeAlertBtn();
    renderViajes();

  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Confirmar Entrega'; }
    const errEl = document.getElementById('err-entrega');
    if (err.status === 403) {
      if (errEl) errEl.style.display = 'block';
      toast(`${ICONS.close} Código de entrega incorrecto`, 2500);
    } else {
      toast(`${ICONS.warn} Error al confirmar entrega. Intentá de nuevo.`, 2500);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════════
let cadeteVehiculo = 'bici'; // se actualiza desde el perfil del cadete
let cadeteClima    = false;  // tarifa clima +20%, se guarda en cadetes.tarifa_clima

function calcularGananciaLocal(distanciaKm) {
  const base = cadeteVehiculo === 'moto' ? 1800 : 1200;
  return Math.round((base + distanciaKm * 250) / 50) * 50;
}

function actualizarToggleClima() {
  const btn = document.getElementById('btn-clima-toggle');
  const dot = document.getElementById('clima-dot');
  const lbl = document.getElementById('clima-lbl');
  if (!btn) return;
  if (cadeteClima) {
    btn.style.background = 'rgba(99,102,241,.25)';
    btn.style.color      = '#A5B4FC';
    dot.style.background = '#A5B4FC';
    lbl.textContent      = '+20% activo';
  } else {
    btn.style.background = 'rgba(255,255,255,0.08)';
    btn.style.color      = '#9CA3AF';
    dot.style.background = '#4B5563';
    lbl.textContent      = 'Normal';
  }
}

async function togClima() {
  cadeteClima = !cadeteClima;
  actualizarToggleClima();
  toast(cadeteClima ? '🌧️ Tarifa clima +20% activa' : 'Tarifa clima desactivada');
  if (cadeteUserId) {
    try {
      await sb.from('cadetes').update({ tarifa_clima: cadeteClima }).eq('auth_uid', cadeteUserId);
    } catch { toast('Error guardando configuración'); }
  }
}

function actualizarSelectorVehiculo() {
  const el = document.getElementById('vehiculo-selector');
  if (!el) return;
  el.querySelectorAll('.veh-opt').forEach(btn => {
    const v = btn.dataset.vehiculo;
    const activo = v === cadeteVehiculo;
    btn.style.background = activo ? '#FF6B35' : 'rgba(255,255,255,0.08)';
    btn.style.color = activo ? '#fff' : '#9CA3AF';
  });
  const baseEl = document.getElementById('tarifa-base-display');
  if (baseEl) baseEl.textContent = cadeteVehiculo === 'moto' ? '$1.800' : '$1.200';
}

async function cambiarVehiculo(tipo) {
  if (tipo !== 'moto' && tipo !== 'bici') return;
  if (tipo === cadeteVehiculo) return;

  const desde = cadeteVehiculo === 'moto' ? 'Moto' : 'Bici';
  const hacia = tipo === 'moto' ? 'Moto' : 'Bici';
  if (!confirm(`Cambiar de ${desde} a ${hacia}?\n\nBase ${desde}: $${cadeteVehiculo === 'moto' ? '1.800' : '1.200'}\nBase ${hacia}: $${tipo === 'moto' ? '1.800' : '1.200'}`)) return;

  cadeteVehiculo = tipo;
  actualizarSelectorVehiculo();
  bindVehiculoSelect();
  renderViajes();

  if (cadeteUserId) {
    try {
      await sb.from('cadetes').update({ vehiculo: tipo }).eq('auth_uid', cadeteUserId);
      toast(tipo === 'moto' ? 'Vehiculo: Moto - Base $1.800' : 'Vehiculo: Bici - Base $1.200');
      if (tipo === 'moto') {
        toast('Completa patente, carnet y seguro en tu perfil');
      }
    } catch { toast('Error guardando vehiculo'); }
  }
}

async function actualizarStats() {
  if (!cadeteUserId) return;
  try {
    const hoy    = new Date(); hoy.setHours(0, 0, 0, 0);
    const semana = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [hoyRes, semRes] = await Promise.all([
      sb.from('pedidos').select('pago_cadete').eq('cadete_id', cadeteUserId).eq('estado', 'entregado').gte('created_at', hoy.toISOString()),
      sb.from('pedidos').select('pago_cadete').eq('cadete_id', cadeteUserId).eq('estado', 'entregado').gte('created_at', semana.toISOString()),
    ]);
    const viajesHoy = hoyRes.data ?? [];
    const viajesSem = semRes.data ?? [];
    const earnHoy   = viajesHoy.reduce((a, p) => a + Number(p.pago_cadete ?? 0), 0);
    const earnSem   = viajesSem.reduce((a, p) => a + Number(p.pago_cadete ?? 0), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('s-hoy',    viajesHoy.length);
    set('s-earn',   earnHoy > 0 ? `$${earnHoy.toLocaleString('es-AR')}` : '$0');
    set('earn-sem', `$${earnSem.toLocaleString('es-AR')}`);
    set('eg-viajes', viajesSem.length);
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// REALTIME — ofertas nuevas para este cadete
// ═══════════════════════════════════════════════════════════════════════════════
function iniciarRealtimeCadete() {
  if (!cadeteUserId) return;
  try {
    sb.channel('ofertas-cadete-' + cadeteUserId)
      .on('postgres_changes', {
        event:  'INSERT',
        schema: 'public',
        table:  'ofertas_cadetes',
        filter: `cadete_id=eq.${cadeteUserId}`,
      }, () => {
        sonarViaje();
        toast(`${ICONS.scooter} ¡Nuevo viaje disponible!`, 4000);
        cargarOfertas();
      })
      .subscribe();
  } catch {}
}

function sonarViaje() {
  try {
    const ctx   = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [784, 659, 784, 880];
    const noteStep = 0.12, noteDur = 0.15;
    const seqLen = notes.length * noteStep; // 0.48s
    const seqGap = 0.10;                   // gap between repeats
    const reps   = 5;                      // 5 × (0.48 + 0.10) = 2.9s ≈ 3s
    for (let r = 0; r < reps; r++) {
      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const t = ctx.currentTime + r * (seqLen + seqGap) + i * noteStep;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + noteDur);
        osc.start(t);
        osc.stop(t + noteDur);
      });
    }
  } catch {}
}


// ═══════════════════════════════════════════════════════════════════════════════
// ASISTENTE IA
// ═══════════════════════════════════════════════════════════════════════════════
let iaHistorialCadete = [];
let iaIniciadoCadete  = false;

function iniciarAsistenteCadete() {
  if (iaIniciadoCadete) return;
  iaIniciadoCadete = true;
  agregarMsgIACadete('bot', '¡Hola! Soy tu asistente de ruta\n\nPuedo ayudarte con:\n• Cómo funciona el sistema de pagos\n• Qué hacer si hay un problema en la entrega\n• Cómo mejorar tu rating\n• Dudas sobre la app\n\n¿En qué te ayudo?');
}

function agregarMsgIACadete(de, texto) {
  const cont = document.getElementById('ia-msgs');
  if (!cont) return;
  const esBot    = de === 'bot';
  const textoHtml = texto.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
  const div      = document.createElement('div');
  div.style.cssText = `display:flex;justify-content:${esBot ? 'flex-start' : 'flex-end'};`;
  div.innerHTML = esBot
    ? `<div style="max-width:85%;background:#1a1a1a;color:#fff;border-radius:4px 14px 14px 14px;padding:10px 14px;font-size:13px;line-height:1.6;">${textoHtml}</div>`
    : `<div style="max-width:85%;background:#FF6B35;color:#fff;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:13px;line-height:1.5;">${textoHtml}</div>`;
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
}

function preguntaRapidaCadete(pregunta) {
  const input = document.getElementById('ia-input');
  if (input) { input.value = pregunta; enviarIACadete(); }
}

async function enviarIACadete() {
  const input = document.getElementById('ia-input');
  const btn   = document.getElementById('ia-btn');
  if (!input?.value.trim()) return;
  const texto = input.value.trim();
  input.value = '';
  if (btn) btn.disabled = true;
  agregarMsgIACadete('usuario', texto);
  iaHistorialCadete.push({ role: 'user', content: texto });

  const cont   = document.getElementById('ia-msgs');
  const typing = document.createElement('div');
  typing.id = 'ia-typing';
  typing.style.cssText = 'display:flex;justify-content:flex-start;';
  typing.innerHTML = '<div style="background:#1a1a1a;border-radius:4px 14px 14px 14px;padding:10px 16px;"><div style="display:flex;gap:4px;height:16px;align-items:center;"><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s .2s infinite;"></div><div style="width:6px;height:6px;border-radius:50%;background:#555;animation:bounce 1.2s .4s infinite;"></div></div></div>';
  cont?.appendChild(typing);
  if (cont) cont.scrollTop = cont.scrollHeight;

  try {
    const supabaseUrl = (typeof window !== 'undefined' && window.SUPABASE_URL) ? window.SUPABASE_URL : '';
    const anonKey     = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) ? window.SUPABASE_ANON_KEY : '';
    const res  = await fetch(`${supabaseUrl}/functions/v1/asistente`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
      body:    JSON.stringify({ messages: iaHistorialCadete, rol: 'cadete' }),
    });
    const data = await res.json();
    const respuesta = data.respuesta || 'No pude procesar tu consulta.';
    document.getElementById('ia-typing')?.remove();
    agregarMsgIACadete('bot', respuesta);
    iaHistorialCadete.push({ role: 'assistant', content: respuesta });
  } catch {
    document.getElementById('ia-typing')?.remove();
    agregarMsgIACadete('bot', 'Error de conexión. Intentá de nuevo.');
  }
  if (btn) btn.disabled = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONEXIÓN MERCADOPAGO CADETE
// ═══════════════════════════════════════════════════════════════════════════════
function conectarMPCadete() {
  const CLIENT_ID    = window.MP_CLIENT_ID || '';
  const REDIRECT_URI = encodeURIComponent(`${window.FRONTEND_URL || ''}/cadete/oauth-callback-cadete.html`);
  if (!CLIENT_ID) { toast('MP_CLIENT_ID no configurado en env.js'); return; }
  window.location.href = `https://auth.mercadopago.com.ar/authorization?client_id=${CLIENT_ID}&response_type=code&platform_id=mp&redirect_uri=${REDIRECT_URI}&state=cadete`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GUARDAR DATOS DEL CADETE
// ═══════════════════════════════════════════════════════════════════════════════
const checkForm = document.getElementById('cadete-form');
if (checkForm) {
  checkForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('cd-btn-save');
    const msg = document.getElementById('cd-msg');
    btn.textContent = 'Guardando...';
    btn.disabled    = true;
    msg.textContent = '';

    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error('No estás conectado.');

      const nombre           = document.getElementById('cd-nombre')?.value.trim()       ?? '';
      const fecha_nacimiento = document.getElementById('cd-fecha')?.value               || null;
      const email            = document.getElementById('cd-email')?.value.trim()        ?? '';
      const telefono         = document.getElementById('cd-telefono')?.value.trim()     ?? '';
      const cvu              = document.getElementById('cd-cvu')?.value.trim()          ?? '';
      const vehiculo         = document.getElementById('cd-vehiculo')?.value.trim()     ?? '';
      const color            = document.getElementById('cd-color')?.value.trim()        ?? '';
      const patente          = document.getElementById('cd-patente')?.value.trim()      ?? '';
      const antecedentes     = false;

      let antecedentes_path = null;
      if (antecedentes) {
        const file = document.getElementById('cd-pdf')?.files?.[0];
        if (!file)                        throw new Error('Debés adjuntar el PDF.');
        if (file.type !== 'application/pdf') throw new Error('El archivo debe ser un PDF.');
        if (file.size > 5 * 1024 * 1024)  throw new Error('Máx 5MB permitido.');
        const filePath = `${user.id}/antecedentes/${Date.now()}_${file.name}`;
        const { error: upErr } = await sb.storage
          .from('cadetes-antecedentes')
          .upload(filePath, file, { cacheControl: '3600', upsert: false });
        if (upErr) throw new Error('Error subiendo PDF: ' + upErr.message);
        antecedentes_path = filePath;
      }

      const { error: dbErr } = await sb.from('cadetes').upsert(
        { auth_uid: user.id, nombre, fecha_nacimiento, email, telefono, cvu, vehiculo, color, patente, activo: true },
        { onConflict: 'auth_uid' },
      );
      if (dbErr) throw new Error('Error guardando en BD: ' + dbErr.message);

      msg.textContent = 'Datos guardados correctamente.';
      msg.style.color = '#00C853';
      document.getElementById('perf-nombre')?.textContent != null && (document.getElementById('perf-nombre').textContent = nombre);

    } catch (err) {
      msg.textContent = err.message;
      msg.style.color = '#FF5252';
    } finally {
      btn.textContent = 'Guardar mis datos';
      btn.disabled    = false;
    }
  });

  sb.auth.getUser().then(async ({ data: { user } }) => {
    if (!user) return;
    const { data } = await sb.from('cadetes').select('*').eq('auth_uid', user.id).single();
    if (!data) return;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('cd-nombre', data.nombre);
    setVal('cd-fecha', data.fecha_nacimiento);
    setVal('cd-email', data.email);
    setVal('cd-telefono', data.telefono);
    setVal('cd-cvu', data.cvu);
    setVal('cd-vehiculo', data.vehiculo);
    setVal('cd-color', data.color);
    setVal('cd-patente', data.patente);

    // Setear vehículo global para cálculo de tarifa
    const veh = (data.vehiculo ?? '').toLowerCase();
    cadeteVehiculo = (veh === 'moto') ? 'moto' : 'bici';
    actualizarSelectorVehiculo();
    cadeteClima = !!data.tarifa_clima;
    actualizarToggleClima();

    // Actualizar header con nombre real de la tabla cadetes
    if (data.nombre) {
      const h = document.getElementById('cad-nombre');
      if (h) h.textContent = data.nombre;
      const p = document.getElementById('perf-nombre');
      if (p) p.textContent = data.nombre;
      const av = document.getElementById('perf-av');
      if (av) av.textContent = data.nombre.slice(0, 2).toUpperCase();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ONBOARDING — datos obligatorios para empezar a recibir viajes
// ═══════════════════════════════════════════════════════════════════════════════
let _obVehiculo = 'bici';

function obSelVeh(tipo) {
  _obVehiculo = tipo;
  const bici = document.getElementById('ob-bici');
  const moto = document.getElementById('ob-moto');
  const motoFields = document.getElementById('ob-moto-fields');
  if (bici) { bici.style.borderColor = tipo === 'bici' ? '#FF6B35' : '#333'; bici.style.background = tipo === 'bici' ? '#1a0d08' : '#1a1a1a'; bici.style.color = tipo === 'bici' ? '#FF6B35' : '#888'; }
  if (moto) { moto.style.borderColor = tipo === 'moto' ? '#FF6B35' : '#333'; moto.style.background = tipo === 'moto' ? '#1a0d08' : '#1a1a1a'; moto.style.color = tipo === 'moto' ? '#FF6B35' : '#888'; }
  if (motoFields) motoFields.style.display = tipo === 'moto' ? 'flex' : 'none';
}

async function verificarOnboarding() {
  if (!cadeteUserId) return;
  const overlay = document.getElementById('onboarding-overlay');
  // Mostrar el formulario de inmediato (optimista) en vez de esperar el round-trip
  // de red para decidir si mostrarlo — eso causaba el retraso visible al cargar
  // el panel. Se omite solo si ya sabemos (cache local) que completó el onboarding,
  // para no generar un flash en cadetes ya onboardeados.
  const yaCompletoCache = localStorage.getItem('pap_onboarding_completo') === 'true';
  if (overlay && !yaCompletoCache) overlay.style.display = 'block';
  try {
    const { data } = await sb.from('cadetes').select('nombre, cvu, foto_dni_url, vehiculo, onboarding_completo').eq('auth_uid', cadeteUserId).maybeSingle();
    if (data?.onboarding_completo) {
      localStorage.setItem('pap_onboarding_completo', 'true');
      if (overlay) overlay.style.display = 'none';
    } else {
      localStorage.removeItem('pap_onboarding_completo');
      if (overlay) overlay.style.display = 'block';
    }
  } catch { }
}

function bindOnboardingForm() {
  const form = document.getElementById('onboarding-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('ob-btn');
    const errEl = document.getElementById('ob-err');
    const nombre = document.getElementById('ob-nombre')?.value.trim();
    const cvu    = document.getElementById('ob-cvu')?.value.trim();
    const dniFile = document.getElementById('ob-dni')?.files?.[0];

    if (!nombre) { errEl.textContent = 'Ingresá tu nombre completo.'; errEl.style.display = 'block'; return; }
    if (!dniFile) { errEl.textContent = 'Subí la foto de tu DNI.'; errEl.style.display = 'block'; return; }
    if (!cvu) { errEl.textContent = 'Ingresá tu CVU o alias.'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = 'Guardando...'; errEl.style.display = 'none';

    try {
      // Subir foto DNI a Storage
      const dniPath = `${cadeteUserId}/dni/${Date.now()}_${dniFile.name}`;
      const { error: upErr } = await sb.storage.from('cadetes-antecedentes').upload(dniPath, dniFile, { cacheControl: '3600', upsert: true });
      if (upErr) throw new Error('Error subiendo DNI: ' + upErr.message);

      // Si es moto: subir carnet y seguro
      let carnetPath = null, seguroPath = null, patente = null;
      if (_obVehiculo === 'moto') {
        patente = (document.getElementById('ob-patente')?.value ?? '').trim().toUpperCase();
        if (!patente) throw new Error('La patente es obligatoria para moto.');

        const carnetFile = document.getElementById('ob-carnet')?.files?.[0];
        if (carnetFile) {
          carnetPath = `${cadeteUserId}/carnet/${Date.now()}_${carnetFile.name}`;
          await sb.storage.from('cadetes-antecedentes').upload(carnetPath, carnetFile, { cacheControl: '3600', upsert: true });
        }

        const seguroFile = document.getElementById('ob-seguro')?.files?.[0];
        if (seguroFile) {
          seguroPath = `${cadeteUserId}/seguro/${Date.now()}_${seguroFile.name}`;
          await sb.storage.from('cadetes-antecedentes').upload(seguroPath, seguroFile, { cacheControl: '3600', upsert: true });
        }
      }

      // Generar código de referido único
      const miCodigo = generarCodigoReferido(cadeteUserId);
      const referidoPor = (document.getElementById('ob-referido')?.value ?? '').trim().toUpperCase() || null;

      // Actualizar cadetes
      const upsertData = {
        auth_uid: cadeteUserId,
        nombre,
        cvu,
        vehiculo: _obVehiculo,
        foto_dni_url: dniPath,
        onboarding_completo: true,
        codigo_referido: miCodigo,
        referido_por: referidoPor,
        email: (await sb.auth.getUser()).data?.user?.email ?? '',
      };
      if (patente) upsertData.patente = patente;
      if (carnetPath) upsertData.carnet_url = carnetPath;
      if (seguroPath) upsertData.seguro_url = seguroPath;

      const { error: dbErr } = await sb.from('cadetes').upsert(upsertData, { onConflict: 'auth_uid' });
      if (dbErr) throw new Error(dbErr.message);

      // Asignar rol cadete en backend
      try {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.access_token) {
          const base = window.BACKEND_URL ?? '';
          await fetch(`${base}/api/auth/set-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
            body: JSON.stringify({ role: 'cadete' }),
          });

          // Validar referido via backend (si ingresó uno)
          if (referidoPor) {
            try {
              const refRes = await fetch(`${base}/api/cadete/validar-referido`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                body: JSON.stringify({ codigo: referidoPor }),
              });
              const refData = await refRes.json();
              if (refRes.ok && refData.referente_nombre) {
                toast(`Referido por ${refData.referente_nombre} — bonificacion de $${refData.bonificacion}`, 4000);
              }
            } catch {}
          }
        }
      } catch {}

      cadeteVehiculo = _obVehiculo;
      localStorage.setItem('pap_onboarding_completo', 'true');
      document.getElementById('onboarding-overlay').style.display = 'none';
      actualizarSelectorVehiculo();
      toast(`${ICONS.confetti} ¡Perfil completo! Ya podes recibir viajes`);

    } catch (err) {
      errEl.textContent = err.message; errEl.style.display = 'block';
    } finally {
      btn.disabled = false; btn.textContent = 'Empezar a repartir →';
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORIAL DE VIAJES — pedidos entregados por este cadete
// ═══════════════════════════════════════════════════════════════════════════════
async function cargarHistorial() {
  const container = document.getElementById('historial-container');
  if (!container || !cadeteUserId) return;
  container.innerHTML = '<div class="empty"><p>Cargando...</p></div>';
  try {
    const { data, error } = await sb
      .from('pedidos')
      .select('id, numero, total, estado, pago_cadete, distancia_estimada, direccion_entrega, created_at, comercios(nombre)')
      .eq('cadete_id', cadeteUserId)
      .in('estado', ['entregado', 'en_camino', 'en_preparacion'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    if (!data?.length) {
      container.innerHTML = '<div class="empty"><div class="big"></div><p>Todavía no hiciste viajes.</p></div>';
      document.getElementById('hist-total-viajes').textContent = '0 viajes';
      return;
    }

    document.getElementById('hist-total-viajes').textContent = `${data.length} viaje${data.length > 1 ? 's' : ''}`;

    const estadoBadge = {
      entregado: { bg: '#DCFCE7', color: '#16A34A', txt: 'Entregado' },
      en_camino: { bg: '#FEF9C3', color: '#A16207', txt: 'En camino' },
      en_preparacion: { bg: '#DBEAFE', color: '#2563EB', txt: 'Preparando' },
    };

    container.innerHTML = data.map(p => {
      const fecha = new Date(p.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
      const hora  = new Date(p.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      const badge = estadoBadge[p.estado] ?? estadoBadge.entregado;
      const gan   = p.pago_cadete ?? '—';
      const dist  = p.distancia_estimada ? `${p.distancia_estimada} km` : '';
      return `
        <div style="background:#fff;border-radius:12px;padding:14px;margin-bottom:8px;border:1px solid #f0f0f0;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div style="font-size:14px;font-weight:700;color:#111;">${p.comercios?.nombre ?? 'Comercio'}</div>
              <div style="font-size:12px;color:#888;margin-top:3px;">${p.direccion_entrega ?? ''}</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${badge.bg};color:${badge.color};">${badge.txt}</span>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
            <div style="font-size:12px;color:#888;">${fecha} · ${hora}${dist ? ' · ' + dist : ''}</div>
            <div style="font-size:15px;font-weight:800;color:#FF6B35;">$${Number(gan).toLocaleString('es-AR')}</div>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty"><p>Error cargando historial.</p></div>';
    console.error('[Historial]', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUBIDA DE DOCUMENTOS (DNI, Seguro, Carnet)
// ═══════════════════════════════════════════════════════════════════════════════
function previsualizarDNI(input) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('dni-img');
    const preview = document.getElementById('dni-preview');
    if (img) img.src = e.target.result;
    if (preview) preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
  subirDocumento(input, 'dni');
}

async function subirDocumento(input, tipo) {
  const file = input.files?.[0];
  if (!file || !cadeteUserId) return;
  const statusEl = document.getElementById(`${tipo}-status`);
  if (statusEl) { statusEl.textContent = 'Subiendo...'; statusEl.style.color = '#888'; }

  try {
    const path = `${cadeteUserId}/${tipo}/${Date.now()}_${file.name}`;
    const { error } = await sb.storage.from('cadetes-antecedentes').upload(path, file, { cacheControl: '3600', upsert: true });
    if (error) throw error;

    const campo = tipo === 'dni' ? 'foto_dni_url' : tipo === 'seguro' ? 'seguro_url' : 'carnet_url';
    await sb.from('cadetes').update({ [campo]: path }).eq('auth_uid', cadeteUserId);

    if (statusEl) { statusEl.textContent = '✓ Subido correctamente'; statusEl.style.color = '#4ADE80'; }
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#ff6b6b'; }
  }
}

// Show/hide moto-specific fields (patente, carnet, seguro)
function bindVehiculoSelect() {
  const sel = document.getElementById('cd-vehiculo');
  if (!sel) return;
  const toggle = () => {
    const isMoto = sel.value === 'moto';
    const motoFields = document.getElementById('moto-fields');
    const motoLegal  = document.getElementById('moto-legal');
    if (motoFields) motoFields.style.display = isMoto ? 'flex' : 'none';
    if (motoLegal)  motoLegal.style.display  = isMoto ? 'block' : 'none';
  };
  sel.addEventListener('change', toggle);
  toggle();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CÓDIGO DE REFERIDO — cada cadete tiene un código único para invitar otros
// ═══════════════════════════════════════════════════════════════════════════════
function generarCodigoReferido(uid) {
  // Usa 8 chars del UUID (~4 mil millones de combinaciones, evita colisiones)
  return 'PAP-' + uid.replace(/-/g, '').slice(0, 8).toUpperCase();
}

async function cargarCodigoReferido() {
  if (!cadeteUserId) return;
  try {
    const { data } = await sb.from('cadetes').select('codigo_referido').eq('auth_uid', cadeteUserId).maybeSingle();
    let codigo = data?.codigo_referido;
    if (!codigo) {
      codigo = generarCodigoReferido(cadeteUserId);
      await sb.from('cadetes').update({ codigo_referido: codigo }).eq('auth_uid', cadeteUserId);
    }
    const el = document.getElementById('mi-codigo-referido');
    if (el) el.textContent = codigo;

    // Contar referidos
    const { count } = await sb.from('referidos_cadete').select('id', { count: 'exact', head: true }).eq('referente_id', cadeteUserId);
    if (count > 0) {
      const countEl = document.getElementById('referidos-count');
      const numEl   = document.getElementById('referidos-num');
      if (countEl) countEl.style.display = 'block';
      if (numEl) numEl.textContent = count;
    }
  } catch {}
}

function copiarCodigo() {
  const el = document.getElementById('mi-codigo-referido');
  if (!el || el.textContent === '—') return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    toast('Codigo copiado: ' + el.textContent);
  }).catch(() => {
    toast(el.textContent);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// EFECTIVO ACUMULADO — barra de progreso + liquidaciones
// ═══════════════════════════════════════════════════════════════════════════════
async function cargarEfectivo() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.access_token) return;
    const base = window.BACKEND_URL || '';
    const r = await fetch(`${base}/api/cadete/efectivo`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = r.ok ? await r.json() : null;
    if (!data) return;

    const deuda  = data.deuda_efectivo ?? 0;
    const limite = data.limite_efectivo ?? 15000;
    const pct    = limite > 0 ? Math.min(100, (deuda / limite) * 100) : 0;

    const card = document.getElementById('efectivo-card');
    if (card) card.style.display = 'block';

    const bar = document.getElementById('efect-bar');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.style.background = pct > 80
        ? 'linear-gradient(90deg,#EF4444,#DC2626)'
        : pct > 50
          ? 'linear-gradient(90deg,#F59E0B,#D97706)'
          : 'linear-gradient(90deg,#22C55E,#16A34A)';
    }

    const ratioEl = document.getElementById('efect-ratio');
    if (ratioEl) ratioEl.textContent = `$${deuda.toLocaleString('es-AR')} / $${limite.toLocaleString('es-AR')}`;

    const deudaEl = document.getElementById('efect-deuda');
    if (deudaEl) deudaEl.textContent = `$${deuda.toLocaleString('es-AR')}`;

    // Historial de liquidaciones
    if (data.liquidaciones?.length) {
      const histEl = document.getElementById('liq-historial');
      const listaEl = document.getElementById('liq-lista');
      if (histEl) histEl.style.display = 'block';
      if (listaEl) {
        const estadoColor = { pendiente: '#F59E0B', confirmada: '#22C55E', rechazada: '#EF4444' };
        listaEl.innerHTML = data.liquidaciones.map(l => {
          const fecha = new Date(l.created_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
          const color = estadoColor[l.estado] || '#888';
          return `<div style="background:#fff;border-radius:10px;padding:12px;margin-bottom:6px;border:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:14px;font-weight:700;">$${Number(l.monto).toLocaleString('es-AR')}</div>
              <div style="font-size:11px;color:#888;">${fecha} · ${l.metodo}</div>
            </div>
            <span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${color}22;color:${color};">${l.estado}</span>
          </div>`;
        }).join('');
      }
    }
  } catch {}
}

function abrirLiquidacion() {
  const modal = document.getElementById('liq-modal');
  if (modal) modal.style.display = 'flex';
}

function cerrarLiquidacion() {
  const modal = document.getElementById('liq-modal');
  if (modal) modal.style.display = 'none';
  const errEl = document.getElementById('liq-err');
  if (errEl) errEl.style.display = 'none';
}

async function enviarLiquidacion() {
  const monto  = document.getElementById('liq-monto')?.value;
  const metodo = document.getElementById('liq-metodo')?.value || 'transferencia';
  const btn    = document.getElementById('liq-btn');
  const errEl  = document.getElementById('liq-err');

  if (!monto || Number(monto) <= 0) {
    if (errEl) { errEl.textContent = 'Ingresa un monto valido'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
  if (errEl) errEl.style.display = 'none';

  try {
    await apiPost('/api/cadete/solicitar-liquidacion', { monto: Number(monto), metodo });
    cerrarLiquidacion();
    toast('Liquidacion solicitada. Un admin la va a confirmar.');
    cargarEfectivo();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message || 'Error al solicitar'; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Enviar'; }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIMER 10 MIN — cliente no aparece al momento de la entrega
// ═══════════════════════════════════════════════════════════════════════════════
let _noShowTimer = null;
let _noShowStart = null;
const NO_SHOW_MS = 10 * 60 * 1000;

function iniciarTimerNoShow() {
  _noShowStart = Date.now();
  const btnWrap = document.getElementById('noshow-wrap');
  if (btnWrap) btnWrap.style.display = 'none';
  const timerWrap = document.getElementById('noshow-timer');
  if (timerWrap) timerWrap.style.display = 'block';

  if (_noShowTimer) clearInterval(_noShowTimer);
  _noShowTimer = setInterval(() => {
    const elapsed = Date.now() - _noShowStart;
    const remaining = Math.max(0, NO_SHOW_MS - elapsed);
    const min = Math.floor(remaining / 60000);
    const sec = Math.floor((remaining % 60000) / 1000);
    const timerEl = document.getElementById('noshow-countdown');
    if (timerEl) timerEl.textContent = `${min}:${String(sec).padStart(2, '0')}`;

    // Barra de progreso: de 100% a 0%
    const barEl = document.getElementById('noshow-bar');
    if (barEl) barEl.style.width = `${(remaining / NO_SHOW_MS) * 100}%`;

    if (remaining <= 0) {
      clearInterval(_noShowTimer);
      _noShowTimer = null;
      const cancelBtn = document.getElementById('noshow-cancel-btn');
      if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.style.opacity = '1'; }
      toast('Se cumplieron los 10 minutos. Podés cancelar la entrega.');
    }
  }, 500);
}

async function cancelarPorNoShow() {
  if (!activeTrip) return;
  const pedidoId = activeTrip.id ?? activeTrip.pedido_id;
  try {
    await apiPost('/api/pedidos/no-show', { pedido_id: pedidoId });
  } catch (e) {
    console.error('[NoShow] Error al reportar no-show:', e.message);
    toast('Error al registrar el no-show. El pedido fue cancelado localmente, contactá soporte.', 4000);
  }
  activeTrip = null;
  activeTripState = 3;
  if (_noShowTimer) { clearInterval(_noShowTimer); _noShowTimer = null; }
  removeAlertBtn();
  renderViajes();
  toast('Pedido cancelado por no-show.', 3000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SOLICITAR PERMISOS DE NOTIFICACIÓN
// ═══════════════════════════════════════════════════════════════════════════════
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROLE GUARD + BOOT
// ═══════════════════════════════════════════════════════════════════════════════
;(async function guardCadete() {
  if (window._cadete_redirecting || window._cadeteGuardDone) return;
  window._cadeteGuardDone = true;

  // Fase 1: autenticación y rol. Solo esta fase puede expulsar al usuario
  // (cerrar sesión + redirigir). Un error de boot del panel (fase 2) NO debe
  // desloguear a un cadete recién autenticado — antes un catch-all compartido
  // hacía exactamente eso, deshaciendo el fix de rol si cualquier función de
  // init posterior fallaba.
  let user, role;
  try {
    console.log('[cadete-guard] verificando sesión...');
    // getSession() usa el cache local — instantáneo, sin round-trip de red
    const { data: { session }, error } = await sb.auth.getSession();
    user = session?.user ?? null;

    // Fallback de red: justo después de volver de un OAuth (registro con Google)
    // el cache local puede no haberse persistido todavía. getUser() valida contra
    // el server, evita expulsar al cadete recién registrado a login por error.
    if (!error && !user) {
      console.log('[cadete-guard] sin sesión en cache, probando getUser() (red)...');
      const { data: { user: netUser } } = await sb.auth.getUser();
      user = netUser ?? null;
    }

    if (error || !user) {
      console.warn('[cadete-guard] sin usuario autenticado — redirigiendo a login cliente', { error });
      window._cadete_redirecting = true;
      try { await sb.auth.signOut(); } catch {}
      window.location.replace('../cliente/login-usuario.html');
      return;
    }

    console.log('[cadete-guard] usuario detectado', user.id, 'metadata.role=', user.user_metadata?.role);

    // Verificar rol desde user_metadata (sin extra DB call si ya está seteado)
    role = user.user_metadata?.role ?? null;
    if (!role || role !== 'cadete') {
      try {
        const { data: perfil } = await sb.from('perfiles').select('rol').eq('usuario_id', user.id).maybeSingle();
        if (perfil?.rol) role = perfil.rol;
        console.log('[cadete-guard] rol desde perfiles:', role);
      } catch (e) {
        console.warn('[cadete-guard] error consultando perfiles.rol', e);
      }
    }

    // Si hay pap_pending_role=cadete activo el usuario viene de un registro vía
    // Google OAuth. El trigger de la DB le asignó 'cliente' por defecto; hay que
    // corregirlo llamando set-role ANTES de validar el rol. NUNCA cerrar sesión
    // mientras este flag esté activo — si set-role falla se muestra un reintento.
    if (role !== 'cadete' && localStorage.getItem('pap_pending_role') === 'cadete') {
      console.log('[cadete-guard] pap_pending_role=cadete — llamando set-role...');
      try {
        const { data: { session: s2 } } = await sb.auth.getSession();
        const token = s2?.access_token;
        if (token) {
          const base = window.BACKEND_URL ?? '';
          const resp = await fetch(`${base}/api/auth/set-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ role: 'cadete' }),
          });
          console.log('[cadete-guard] set-role status:', resp.status);
          if (resp.ok) {
            localStorage.removeItem('pap_pending_role');
            role = 'cadete';
          } else {
            // Falló pero NO cerrar sesión — mostrar reintento
            document.body.style.cssText = 'margin:0;background:#0d0d0d;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;';
            document.body.innerHTML = '<div style="text-align:center;padding:32px;color:#fff"><div style="font-size:48px;margin-bottom:16px;">⚠️</div><h2 style="margin:0 0 8px">Registrando tu cuenta...</h2><p style="color:#888;margin:0 0 24px">Hubo un error al asignar el rol de cadete.<br>Tu sesión sigue activa.</p><button onclick="location.reload()" style="background:#FF6B35;color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;">Reintentar</button></div>';
            return;
          }
        }
      } catch (e) {
        console.warn('[cadete-guard] set-role network error', e);
        document.body.style.cssText = 'margin:0;background:#0d0d0d;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;';
        document.body.innerHTML = '<div style="text-align:center;padding:32px;color:#fff"><div style="font-size:48px;margin-bottom:16px;">📡</div><h2 style="margin:0 0 8px">Sin conexión</h2><p style="color:#888;margin:0 0 24px">Verificá tu red e intentá de nuevo.<br>Tu sesión sigue activa.</p><button onclick="location.reload()" style="background:#FF6B35;color:#fff;border:none;border-radius:12px;padding:14px 28px;font-size:16px;font-weight:700;cursor:pointer;">Reintentar</button></div>';
        return;
      }
    }

    if (role && role !== 'cadete') {
      console.warn('[cadete-guard] rol final no es cadete:', role, '— redirigiendo a /login.html');
      window._cadete_redirecting = true;
      try { await sb.auth.signOut(); } catch {}
      window.location.replace('/login.html');
      return;
    }

    console.log('[cadete-guard] autenticación OK, rol=cadete. Iniciando panel...');
  } catch (e) {
    console.warn('cadete auth guard failed', e);
    window._cadete_redirecting = true;
    try { await sb.auth.signOut(); } catch {}
    window.location.replace('../cliente/login-usuario.html');
    return;
  }

  // Fase 2: boot del panel. Errores acá se loguean pero NO desloguean al cadete.
  cadeteUserId = user.id;
  try {
    mostrarTutorial();
    bindOnboardingForm();
    bindVehiculoSelect();

    // Paralelizar llamadas independientes de init
    await Promise.all([
      verificarOnboarding(),
      cargarOfertas(),
    ]);
    cargarCodigoReferido();
    cargarEfectivo();
    iniciarRealtimeCadete();
    verificarAlertasCadete();

    // Sincronizar UI del toggle con el estado guardado
    document.getElementById('disp-dot').className = 'disp-dot' + (disp ? ' on' : '');
    document.getElementById('disp-lbl').textContent = disp ? 'Disponible' : 'Inactivo';

    // Sincronizar cadetes.disponible en DB con el estado de la UI al bootear.
    // togDisp() solo escribe en DB cuando el usuario toca el switch — un cadete
    // recién onboardeado arranca con el switch en "Disponible" visualmente pero
    // nunca tocó el botón, así que la DB se queda en false (default de tabla) y
    // el matching de difundirPedido() lo excluye en silencio. Sin este sync, un
    // cadete nuevo nunca recibe ofertas hasta que apaga y prende el switch.
    sb.from('cadetes').update({ disponible: disp, activo: disp }).eq('auth_uid', cadeteUserId).then(() => {});

    // Arrancar GPS si el cadete está disponible
    if (disp) iniciarReporteGPS();
  } catch (e) {
    console.error('cadete panel boot failed (sesión válida, no se cierra sesión)', e);
  }
})();

// Refresco periódico de ofertas (backup si Realtime falla)
setInterval(cargarOfertas, 30000);

// ═══════════════════════════════════════════════════════════════════════════════
// TUTORIAL — slideshow de 4 pantallas para cadetes nuevos
// ═══════════════════════════════════════════════════════════════════════════════
let _tutorialSlide = 0;

function mostrarTutorial() {
  if (localStorage.getItem('pap_tutorial_visto') === 'true') return;
  const overlay = document.getElementById('tutorial-overlay');
  if (overlay) overlay.style.display = 'block';
}

function siguienteSlideTutorial() {
  _tutorialSlide++;
  if (_tutorialSlide >= 4) { cerrarTutorial(); return; }
  const slides = document.getElementById('tutorial-slides');
  if (slides) slides.style.transform = `translateX(-${_tutorialSlide * 100}%)`;
  const dots = document.querySelectorAll('#tutorial-dots .t-dot');
  dots.forEach((d, i) => { d.style.background = i === _tutorialSlide ? '#fff' : 'rgba(255,255,255,.3)'; });
  if (_tutorialSlide === 3) {
    const btn = document.getElementById('tutorial-next');
    if (btn) btn.textContent = 'Empezar';
  }
}

function cerrarTutorial() {
  localStorage.setItem('pap_tutorial_visto', 'true');
  const overlay = document.getElementById('tutorial-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAT DEL PEDIDO — cadete ↔ cliente/comercio
// ═══════════════════════════════════════════════════════════════════════════════
let _chatCadeteChannel = null;

function renderChatCadete(pedidoId) {
  if (!pedidoId) return '';
  return `
    <div style="margin-top:12px;border:1px solid rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;">
      <div onclick="toggleChatCadete()" style="padding:10px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;background:rgba(255,255,255,0.03);">
        ${ICONS.chat}
        <span style="font-size:12px;font-weight:700;flex:1;">Chat del pedido</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
      </div>
      <div id="chat-cad-body" style="display:none;">
        <div id="chat-cad-msgs" style="height:160px;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:5px;background:rgba(0,0,0,0.2);"></div>
        <div style="padding:8px;display:flex;gap:6px;">
          <input id="chat-cad-input" placeholder="Escribi..." style="flex:1;border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:7px 12px;font-size:12px;outline:none;background:rgba(255,255,255,0.05);color:#fff;font-family:inherit;" onkeydown="if(event.key==='Enter')enviarMsgCadete()"/>
          <button onclick="enviarMsgCadete()" style="width:30px;height:30px;border-radius:50%;background:#FF6B35;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>
        </div>
      </div>
    </div>`;
}

async function initChatCadete(pedidoId) {
  if (!pedidoId) return;
  if (_chatCadeteChannel) { try { sb.removeChannel(_chatCadeteChannel); } catch {} }

  const { data } = await sb.from('mensajes_pedido').select('*').eq('pedido_id', pedidoId).order('creado_at', { ascending: true }).limit(100);
  const container = document.getElementById('chat-cad-msgs');
  if (container) { container.innerHTML = ''; (data || []).forEach(m => appendMsgCadete(m)); }

  _chatCadeteChannel = sb.channel('chat-cad-rt-' + pedidoId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'mensajes_pedido', filter: `pedido_id=eq.${pedidoId}` },
      payload => { appendMsgCadete(payload.new); })
    .subscribe();
}

function appendMsgCadete(msg) {
  const container = document.getElementById('chat-cad-msgs');
  if (!container) return;
  const esMio = msg.rol_remitente === 'cadete';
  const rolLabel = { cliente: 'Cliente', comercio: 'Comercio', cadete: 'Vos', admin: 'Admin' }[msg.rol_remitente] || msg.rol_remitente;
  const hora = new Date(msg.creado_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.style.cssText = `display:flex;justify-content:${esMio ? 'flex-end' : 'flex-start'};`;
  div.innerHTML = `<div style="max-width:80%;padding:7px 10px;border-radius:${esMio ? '10px 10px 4px 10px' : '4px 10px 10px 10px'};background:${esMio ? '#FF6B35' : 'rgba(255,255,255,0.1)'};color:#fff;font-size:12px;line-height:1.4;">
    ${!esMio ? `<div style="font-size:9px;font-weight:700;margin-bottom:1px;opacity:.7;">${rolLabel}</div>` : ''}
    ${msg.mensaje}
    <div style="font-size:8px;opacity:.5;text-align:right;margin-top:1px;">${hora}</div>
  </div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function toggleChatCadete() {
  const body = document.getElementById('chat-cad-body');
  if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
}

async function enviarMsgCadete() {
  const input = document.getElementById('chat-cad-input');
  if (!input || !input.value.trim() || !activeTrip) return;
  const texto = input.value.trim(); input.value = '';
  const pedidoId = activeTrip.id ?? activeTrip.pedido_id;
  await sb.from('mensajes_pedido').insert({
    pedido_id: pedidoId,
    remitente_id: cadeteUserId,
    rol_remitente: 'cadete',
    mensaje: texto,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ALERTAS DE COMPLETITUD — banners de lo que falta configurar
// ═══════════════════════════════════════════════════════════════════════════════
async function verificarAlertasCadete() {
  if (!cadeteUserId) return;
  const container = document.getElementById('alertas-cadete');
  if (!container) return;

  try {
    const { data: cad } = await sb.from('cadetes')
      .select('nombre, cvu, foto_dni_url, vehiculo, onboarding_completo, patente, seguro_url, carnet_url')
      .eq('auth_uid', cadeteUserId).maybeSingle();

    if (!cad || !cad.onboarding_completo) return;

    const alertas = [];

    if (!cad.cvu) {
      alertas.push({
        color: '#DC2626', bg: '#FEF2F2', border: '#FECACA',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#DC2626" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
        text: 'No tenes CVU/alias cargado. Sin eso no podemos pagarte los viajes.',
        btn: 'Completar', onclick: "stab('p')",
      });
    }

    if (!cad.foto_dni_url) {
      alertas.push({
        color: '#D97706', bg: '#FFFBEB', border: '#FDE68A',
        icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/></svg>',
        text: 'Falta la foto de tu DNI. Subila desde tu perfil.',
        btn: 'Subir DNI', onclick: "stab('p')",
      });
    }

    const veh = (cad.vehiculo || '').toLowerCase();
    if (veh === 'moto') {
      if (!cad.patente) {
        alertas.push({
          color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563EB" stroke-width="2"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
          text: 'Falta la patente de tu moto.',
          btn: 'Completar', onclick: "stab('p')",
        });
      }
      if (!cad.seguro_url) {
        alertas.push({
          color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
          text: 'Falta el seguro del vehiculo. Subilo desde tu perfil.',
          btn: 'Subir seguro', onclick: "stab('p')",
        });
      }
    }

    if (!alertas.length) { container.innerHTML = ''; return; }

    container.innerHTML = alertas.map(a => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${a.bg};border:1px solid ${a.border};border-radius:10px;">
        <div style="flex-shrink:0;">${a.icon}</div>
        <div style="flex:1;font-size:11px;color:${a.color};font-weight:500;line-height:1.4;">${a.text}</div>
        <button onclick="${a.onclick}" style="flex-shrink:0;background:${a.color};color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit;">${a.btn}</button>
      </div>
    `).join('');
  } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS AL SCOPE GLOBAL — necesarios para onclick inline del HTML
// ═══════════════════════════════════════════════════════════════════════════════
Object.assign(window, {
  togDisp,
  stab,
  aceptarViaje,
  rechazarOferta,
  confirmarRetiro,
  confirmarEntrega,
  validarInputCodigo,
  iniciarAsistenteCadete,
  enviarIACadete,
  preguntaRapidaCadete,
  conectarMPCadete,
  cambiarVehiculo,
  cargarHistorial,
  obSelVeh,
  previsualizarDNI,
  subirDocumento,
  copiarCodigo,
  iniciarTimerNoShow,
  cancelarPorNoShow,
  siguienteSlideTutorial,
  cerrarTutorial,
  abrirLiquidacion,
  cerrarLiquidacion,
  enviarLiquidacion,
  cargarEfectivo,
  toggleChatCadete,
  enviarMsgCadete,
  toast,
});
