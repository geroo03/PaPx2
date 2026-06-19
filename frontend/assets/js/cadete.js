import { ICONS } from './icons.js';

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// activeTripState: 0=idle | 1=yendo_al_local | 2=en_camino_al_cliente | 3=finalizado
// ═══════════════════════════════════════════════════════════════════════════════
let disp          = true;
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
  document.getElementById('disp-dot').className = 'disp-dot' + (disp ? ' on' : '');
  document.getElementById('disp-lbl').textContent = disp ? 'Disponible' : 'Inactivo';
  toast(disp ? '✅ Estás disponible' : '⏸️ Pausaste los viajes');

  // GPS: activar cuando disponible, pausar cuando inactivo
  if (disp) iniciarReporteGPS();
  else      detenerReporteGPS();

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
      const { lat, lng } = payload.new ?? {};
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
            ${ICONS.pin ?? '📍'} Entregás en: ${o.cliente_direccion ?? o.direccion_entrega ?? '—'}
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
              ✅ Aceptar viaje · $${Number(gan).toLocaleString('es-AR')}
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
      toast('⏱ Oferta expirada — esperando nuevos viajes');
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
          <span style="font-size:18px;">📍</span>
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
            🔐 Código de Retiro
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
          ${ICONS.pin ?? '📍'} Ver ruta al Local
        </a>
      </div>`;

    document.body.insertAdjacentHTML('beforeend', alertBtnHtml);
    document.getElementById('viaje-alert-btn')?.addEventListener('click', () => {
      if (confirm('¿Reportar un problema con este viaje al administrador?')) toast('Reporte enviado.');
    });
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
          <span style="font-size:18px;">🏁</span>
          <div>
            <div style="font-size:11px;color:#9CA3AF;">Distancia al cliente (en vivo)</div>
            <div id="km-al-cliente" style="font-size:16px;font-weight:800;color:#34D399;">—</div>
          </div>
        </div>

        <!-- Código de entrega: el cliente te lo muestra al llegar -->
        <div style="background:rgba(52,211,153,0.08);border:1px solid rgba(52,211,153,0.25);
                    border-radius:10px;padding:14px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#6EE7B7;margin-bottom:8px;">
            🔐 Código de Entrega
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
          ${ICONS.pin ?? '📍'} Ver ruta de Entrega
        </a>

        <!-- No-show: cliente no aparece -->
        <div id="noshow-wrap" style="margin-top:12px;">
          <button onclick="iniciarTimerNoShow()"
            style="width:100%;padding:12px;border-radius:10px;background:transparent;
                   border:1px solid rgba(220,38,38,0.3);color:#F87171;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;">
            ⏱ El cliente no aparece
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
      toast(`${ICONS.confetti ?? '🎉'} ¡Viaje completado! Ganaste $${Number(ganFinal).toLocaleString('es-AR')}`, 3500);
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
      if (btn) { btn.disabled = false; btn.textContent = `✅ Aceptar viaje · $${oferta.ganancia_estimada ?? '—'}`; }
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

function calcularGananciaLocal(distanciaKm) {
  const base = cadeteVehiculo === 'moto' ? 1800 : 1200;
  return Math.round((base + distanciaKm * 250) / 50) * 50;
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
  cadeteVehiculo = tipo;
  actualizarSelectorVehiculo();
  renderViajes();

  // Persistir en la DB
  if (cadeteUserId) {
    try {
      await sb.from('cadetes').update({ vehiculo: tipo }).eq('auth_uid', cadeteUserId);
      toast(tipo === 'moto' ? '🏍️ Vehículo: Moto · Base $1.800' : '🚲 Vehículo: Bici · Base $1.200');
    } catch { toast('Error guardando vehículo'); }
  }
}

function actualizarStats() {
  const hoy   = ofertasPendientes.filter(o => {
    const d = new Date(o.created_at), n = new Date();
    return d.getDate() === n.getDate() && d.getMonth() === n.getMonth();
  });
  const earn = hoy.reduce((acc, o) => acc + (o.ganancia_estimada ?? 0), 0);

  document.getElementById('s-hoy')?.textContent  != null && (document.getElementById('s-hoy').textContent = hoy.length);
  document.getElementById('s-earn')?.textContent != null && (document.getElementById('s-earn').textContent = earn > 0 ? `$${earn.toLocaleString('es-AR')}` : '$0');
  document.getElementById('earn-sem')?.textContent != null && (document.getElementById('earn-sem').textContent = `$${(ofertasPendientes.reduce((a,o)=>a+(o.ganancia_estimada??0),0)).toLocaleString('es-AR')}`);
  document.getElementById('eg-viajes')?.textContent != null && (document.getElementById('eg-viajes').textContent = ofertasPendientes.length);
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
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [784, 659, 784, 880].forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.15);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.15);
    });
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
  agregarMsgIACadete('bot', '¡Hola! Soy tu asistente de ruta 🤖\n\nPuedo ayudarte con:\n• Cómo funciona el sistema de pagos\n• Qué hacer si hay un problema en la entrega\n• Cómo mejorar tu rating\n• Dudas sobre la app\n\n¿En qué te ayudo?');
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
      const vehiculo         = document.getElementById('cd-vehiculo')?.value.trim()     ?? '';
      const color            = document.getElementById('cd-color')?.value.trim()        ?? '';
      const patente          = document.getElementById('cd-patente')?.value.trim()      ?? '';
      const antecedentes     = document.getElementById('cd-antecedentes')?.value === 'true';

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
        { auth_uid: user.id, nombre, fecha_nacimiento, email, vehiculo, color, patente, antecedentes, antecedentes_path },
        { onConflict: 'auth_uid' },
      );
      if (dbErr) throw new Error('Error guardando en BD: ' + dbErr.message);

      msg.textContent = '✅ Datos guardados correctamente.';
      msg.style.color = '#00C853';
      document.getElementById('perf-nombre')?.textContent != null && (document.getElementById('perf-nombre').textContent = nombre);

    } catch (err) {
      msg.textContent = '❌ ' + err.message;
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
    document.getElementById('cd-nombre')?.value != null       && (document.getElementById('cd-nombre').value = data.nombre || '');
    document.getElementById('cd-fecha')?.value != null        && (document.getElementById('cd-fecha').value = data.fecha_nacimiento || '');
    document.getElementById('cd-email')?.value != null        && (document.getElementById('cd-email').value = data.email || '');
    document.getElementById('cd-vehiculo')?.value != null     && (document.getElementById('cd-vehiculo').value = data.vehiculo || '');
    document.getElementById('cd-color')?.value != null        && (document.getElementById('cd-color').value = data.color || '');
    document.getElementById('cd-patente')?.value != null      && (document.getElementById('cd-patente').value = data.patente || '');
    if (data.antecedentes) {
      document.getElementById('cd-antecedentes') && (document.getElementById('cd-antecedentes').value = 'true');
      document.getElementById('cd-ant-upload')   && (document.getElementById('cd-ant-upload').style.display = 'block');
    }

    // Setear vehículo global para cálculo de tarifa
    const veh = (data.vehiculo ?? '').toLowerCase();
    cadeteVehiculo = (veh === 'moto') ? 'moto' : 'bici';
    actualizarSelectorVehiculo();
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
  if (bici) { bici.style.borderColor = tipo === 'bici' ? '#FF6B35' : '#333'; bici.style.background = tipo === 'bici' ? '#1a0d08' : '#1a1a1a'; bici.style.color = tipo === 'bici' ? '#FF6B35' : '#888'; }
  if (moto) { moto.style.borderColor = tipo === 'moto' ? '#FF6B35' : '#333'; moto.style.background = tipo === 'moto' ? '#1a0d08' : '#1a1a1a'; moto.style.color = tipo === 'moto' ? '#FF6B35' : '#888'; }
}

async function verificarOnboarding() {
  if (!cadeteUserId) return;
  try {
    const { data } = await sb.from('cadetes').select('nombre, cvu, foto_dni_url, vehiculo, onboarding_completo').eq('auth_uid', cadeteUserId).maybeSingle();
    if (data?.onboarding_completo) return;
    document.getElementById('onboarding-overlay').style.display = 'block';
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

      // Generar código de referido único
      const miCodigo = generarCodigoReferido(cadeteUserId);
      const referidoPor = (document.getElementById('ob-referido')?.value ?? '').trim().toUpperCase() || null;

      // Actualizar cadetes
      const { error: dbErr } = await sb.from('cadetes').upsert({
        auth_uid: cadeteUserId,
        nombre,
        cvu,
        vehiculo: _obVehiculo,
        foto_dni_url: dniPath,
        onboarding_completo: true,
        codigo_referido: miCodigo,
        referido_por: referidoPor,
        email: (await sb.auth.getUser()).data?.user?.email ?? '',
      }, { onConflict: 'auth_uid' });
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
        }
      } catch {}

      cadeteVehiculo = _obVehiculo;
      document.getElementById('onboarding-overlay').style.display = 'none';
      actualizarSelectorVehiculo();
      toast('🎉 ¡Perfil completo! Ya podés recibir viajes');

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
      container.innerHTML = '<div class="empty"><div class="big">📋</div><p>Todavía no hiciste viajes.</p></div>';
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
  return 'PAP-' + uid.slice(0, 4).toUpperCase();
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
  } catch {}
}

function copiarCodigo() {
  const el = document.getElementById('mi-codigo-referido');
  if (!el || el.textContent === '—') return;
  navigator.clipboard.writeText(el.textContent).then(() => {
    toast('📋 Código copiado: ' + el.textContent);
  }).catch(() => {
    toast(el.textContent);
  });
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
      toast('⏰ Se cumplieron los 10 minutos. Podés cancelar la entrega.');
    }
  }, 500);
}

async function cancelarPorNoShow() {
  if (!activeTrip) return;
  try {
    await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id: activeTrip.id ?? activeTrip.pedido_id,
      nuevo_estado: 'entregado',
      codigo_entrega: '0000',
    });
  } catch {}
  // Forzar finalización local
  activeTripState = 3;
  if (_noShowTimer) { clearInterval(_noShowTimer); _noShowTimer = null; }
  removeAlertBtn();
  renderViajes();
  toast('Entrega marcada como no-show. Contactá soporte si es necesario.');
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
  if (window._cadete_redirecting) return;
  try {
    const { data: { session } } = await sb.auth.getSession();
    const user = session?.user ?? null;
    const role = user?.user_metadata?.role ?? user?.raw_user_meta_data?.role ?? null;

    if (!session || role !== 'cadete') {
      window._cadete_redirecting = true;
      try { await sb.auth.signOut(); } catch {}
      try { alert('Acceso restringido a Cadetes'); } catch {}
      window.location.replace('../cliente/login-usuario.html');
      return;
    }

    cadeteUserId = user.id;

    // Verificar si necesita completar onboarding antes de operar
    await verificarOnboarding();
    bindOnboardingForm();
    bindVehiculoSelect();
    cargarCodigoReferido();

    await cargarOfertas();
    iniciarRealtimeCadete();

    // Arrancar GPS si el cadete está disponible
    if (disp) iniciarReporteGPS();

  } catch (e) {
    console.warn('cadete guard check failed', e);
    if (!window._cadete_redirecting) {
      window._cadete_redirecting = true;
      try { await sb.auth.signOut(); } catch {}
      window.location.replace('../cliente/login-usuario.html');
    }
  }
})();

// Refresco periódico de ofertas (backup si Realtime falla)
setInterval(cargarOfertas, 30000);

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
  toast,
});
