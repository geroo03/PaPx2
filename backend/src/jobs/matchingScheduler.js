/**
 * matchingScheduler.js
 *
 * Automatiza lo que antes dependía de que alguien tocara un botón:
 *   - Expira ofertas vencidas (antes quedaban 'pendiente' para siempre).
 *   - Despacha cadetes cuando el pedido está por quedar listo (antes se
 *     avisaba siempre inmediatamente al aceptar, sin importar el tiempo de
 *     preparación real).
 *   - Re-difunde automáticamente si nadie acepta (antes el comercio tenía
 *     que apretar "Buscar cadete" de nuevo a mano), ensanchando el radio
 *     una vez antes de rendirse y avisarle al comercio.
 *
 * Corre dentro del propio proceso Node de Railway (persistente, no
 * serverless) — no requiere infraestructura de colas/cron nueva.
 */

import { supabaseAdmin } from '../lib/supabaseClient.js';
import { ejecutarDifusion, obtenerConfigZona } from '../controllers/pedidoController.js';
import { notificarComercioSinCadetes } from '../controllers/pushController.js';
import { refrescarCacheClima } from '../lib/climaService.js';

const MATCHING_TICK_MS   = 15_000;      // cadencia de los jobs de matching
const CLIMA_REFRESH_MS   = 15 * 60_000; // cadencia del refresco de clima

let corriendoMatching = false;
let corriendoClima    = false;

// ── Job 1: expirar ofertas vencidas ─────────────────────────────────────────
async function jobExpirarOfertas() {
  const { data: pendientes } = await supabaseAdmin
    .from('ofertas_cadetes')
    .select('id, created_at, oferta_timeout_seg')
    .eq('estado', 'pendiente');

  if (!pendientes?.length) return;

  const ahora = Date.now();
  const vencidas = pendientes.filter(o => {
    const timeoutMs = (o.oferta_timeout_seg ?? 20) * 1000;
    return ahora - new Date(o.created_at).getTime() > timeoutMs;
  });

  if (!vencidas.length) return;

  await supabaseAdmin
    .from('ofertas_cadetes')
    .update({ estado: 'rechazada' })
    .in('id', vencidas.map(o => o.id));

  console.log(`[matchingScheduler] Expiradas ${vencidas.length} oferta(s) vencida(s).`);
}

// ── Job 2: despacho inicial diferido según tiempo de preparación ───────────
async function jobDespachoInicial() {
  const { data: pedidos } = await supabaseAdmin
    .from('pedidos')
    .select('id, comercio_id, listo_estimado_at, comercios(ciudad)')
    .eq('estado', 'preparando')
    .is('cadete_id', null)
    .is('ultima_difusion_at', null)
    .not('listo_estimado_at', 'is', null)
    .limit(50);

  if (!pedidos?.length) return;

  const ahora = Date.now();
  for (const p of pedidos) {
    try {
      const config = await obtenerConfigZona(p.comercios?.ciudad);
      const anticipacionMs = (config.anticipacion_difusion_min ?? 8) * 60_000;
      const listoEn = new Date(p.listo_estimado_at).getTime();

      if (ahora >= listoEn - anticipacionMs) {
        const r = await ejecutarDifusion({ pedidoId: p.id, comercioId: p.comercio_id, origen: 'auto-inicial' });
        console.log(`[matchingScheduler] Despacho inicial pedido ${p.id}: difundido=${r.difundido}`);
      }
    } catch (e) {
      console.error(`[matchingScheduler] Error en despacho inicial (pedido ${p.id}):`, e?.message ?? e);
    }
  }
}

// ── Job 3: re-difusión automática si nadie aceptó ──────────────────────────
async function jobRedifusionAutomatica() {
  const { data: pedidos } = await supabaseAdmin
    .from('pedidos')
    .select('id, comercio_id, difusion_intentos, ultima_difusion_at, comercios(ciudad, usuario_id)')
    .eq('estado', 'preparando')
    .is('cadete_id', null)
    .eq('difusion_agotada', false)
    .not('ultima_difusion_at', 'is', null)
    .limit(50);

  if (!pedidos?.length) return;

  const ahora = Date.now();
  for (const p of pedidos) {
    try {
      const config = await obtenerConfigZona(p.comercios?.ciudad);
      const intervaloMs  = (config.redifusion_intervalo_seg ?? 45) * 1000;
      const maxIntentos  = config.redifusion_max_intentos ?? 5;
      const desdeUltima  = ahora - new Date(p.ultima_difusion_at).getTime();

      if (desdeUltima < intervaloMs) continue;

      if (p.difusion_intentos < maxIntentos) {
        const r = await ejecutarDifusion({ pedidoId: p.id, comercioId: p.comercio_id, origen: 'auto-redifusion' });
        console.log(`[matchingScheduler] Re-difusión pedido ${p.id} (intento ${p.difusion_intentos + 1}/${maxIntentos}): difundido=${r.difundido}`);
      } else if (p.difusion_intentos === maxIntentos) {
        // Último intento antes de rendirse: radio ampliado.
        const r = await ejecutarDifusion({ pedidoId: p.id, comercioId: p.comercio_id, origen: 'auto-redifusion-ampliada' });
        console.log(`[matchingScheduler] Re-difusión con radio ampliado, pedido ${p.id}: difundido=${r.difundido}`);
      } else {
        // Ya se hizo el intento ampliado y sigue sin nadie — avisar al comercio.
        await supabaseAdmin.from('pedidos').update({ difusion_agotada: true }).eq('id', p.id);
        if (p.comercios?.usuario_id) {
          notificarComercioSinCadetes(p.comercios.usuario_id).catch(() => {});
        }
        console.log(`[matchingScheduler] Pedido ${p.id}: difusión agotada, se avisó al comercio.`);
      }
    } catch (e) {
      console.error(`[matchingScheduler] Error en re-difusión (pedido ${p.id}):`, e?.message ?? e);
    }
  }
}

async function tickMatching() {
  if (corriendoMatching) return; // no solapar ticks si uno tarda más de 15s
  corriendoMatching = true;
  try {
    await jobExpirarOfertas();
    await jobDespachoInicial();
    await jobRedifusionAutomatica();
  } catch (e) {
    console.error('[matchingScheduler] Error inesperado en tick de matching:', e?.message ?? e);
  } finally {
    corriendoMatching = false;
  }
}

async function tickClima() {
  if (corriendoClima) return;
  corriendoClima = true;
  try {
    await refrescarCacheClima();
  } catch (e) {
    console.error('[matchingScheduler] Error refrescando caché de clima:', e?.message ?? e);
  } finally {
    corriendoClima = false;
  }
}

/** Arranca los 2 intervalos. Llamar una sola vez desde server.js. */
export function iniciarSchedulerMatching() {
  if (!supabaseAdmin) {
    console.warn('[matchingScheduler] supabaseAdmin no inicializado — scheduler NO arrancado.');
    return;
  }
  setInterval(tickMatching, MATCHING_TICK_MS);
  setInterval(tickClima, CLIMA_REFRESH_MS);
  console.log(`[matchingScheduler] Arrancado — matching cada ${MATCHING_TICK_MS / 1000}s, clima cada ${CLIMA_REFRESH_MS / 60_000}min.`);
}
