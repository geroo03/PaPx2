/**
 * climaService.js
 *
 * Detección automática de clima adverso para la tarifa clima. Reemplaza el
 * toggle manual del cadete (que se mantiene como override, ver cadete.js)
 * como fuente principal — se calcula UNA VEZ por tanda de difusión, no por
 * cadete individual, y se cachea por grilla geográfica (no por
 * comercios.ciudad, que es texto libre y poco confiable) para no pegarle a
 * wttr.in en cada pedido.
 */

import { supabaseAdmin } from './supabaseClient.js';
import { esClimaAdverso } from './climaUtils.js';

const CACHE_TTL_MIN  = 20;   // después de esto, se considera vieja y se refresca
const FETCH_TIMEOUT_MS = 3000;

function redondearGrilla(lat, lng) {
  return {
    gridLat: Math.round(Number(lat) * 10) / 10,
    gridLng: Math.round(Number(lng) * 10) / 10,
  };
}

async function obtenerClimaLive(lat, lng) {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`https://wttr.in/${lat},${lng}?format=j1`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;

    const data = await res.json();
    const cc   = data?.current_condition?.[0];
    if (!cc) return null;

    return {
      weatherCode:  Number(cc.weatherCode ?? 0),
      precipMM:     Number(cc.precipMM ?? 0),
      temperaturaC: Number(cc.temp_C ?? 0),
      descripcion:  (cc.lang_es?.[0]?.value ?? cc.weatherDesc?.[0]?.value ?? '').toLowerCase(),
    };
  } catch (err) {
    console.warn('[climaService] obtenerClimaLive falló:', err?.message ?? err);
    return null;
  }
}

async function upsertCache(gridLat, gridLng, clima, adverso) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('clima_cache').upsert({
      grid_lat:       gridLat,
      grid_lng:       gridLng,
      clima_adverso:  adverso,
      weather_code:   clima.weatherCode,
      precip_mm:      clima.precipMM,
      temperatura_c:  clima.temperaturaC,
      descripcion:    clima.descripcion,
      actualizado_at: new Date().toISOString(),
    }, { onConflict: 'grid_lat,grid_lng' });
  } catch (err) {
    console.warn('[climaService] Error guardando clima_cache:', err?.message ?? err);
  }
}

/**
 * Cache-first — es la que se llama en el hot path de ejecutarDifusion, así
 * que siempre debe responder rápido. Si no hay caché reciente hace un fetch
 * live puntual (con timeout corto) y actualiza la caché para la próxima.
 * Si wttr.in falla, devuelve `false` (nunca bloquea ni rompe la difusión).
 */
export async function esClimaAdversoParaUbicacion(lat, lng) {
  if (lat == null || lng == null || !supabaseAdmin) return false;

  const { gridLat, gridLng } = redondearGrilla(lat, lng);

  try {
    const { data } = await supabaseAdmin
      .from('clima_cache')
      .select('clima_adverso, actualizado_at')
      .eq('grid_lat', gridLat).eq('grid_lng', gridLng)
      .maybeSingle();

    if (data) {
      const edadMin = (Date.now() - new Date(data.actualizado_at).getTime()) / 60_000;
      if (edadMin < CACHE_TTL_MIN) return !!data.clima_adverso;
    }
  } catch (err) {
    console.warn('[climaService] Error leyendo clima_cache:', err?.message ?? err);
  }

  const clima = await obtenerClimaLive(gridLat, gridLng);
  if (!clima) return false;

  const adverso = esClimaAdverso(clima.weatherCode, clima.precipMM);
  upsertCache(gridLat, gridLng, clima, adverso).catch(() => {});
  return adverso;
}

/**
 * Refresca la caché para todas las grillas donde hay comercios activos.
 * Pensada para correr periódicamente desde matchingScheduler.js (cada
 * ~15 min), NO desde el hot path de difusión.
 */
export async function refrescarCacheClima() {
  if (!supabaseAdmin) return;

  try {
    const { data: comercios } = await supabaseAdmin
      .from('comercios')
      .select('lat,lng')
      .eq('activo', true)
      .not('lat', 'is', null)
      .not('lng', 'is', null);

    if (!comercios?.length) return;

    const grillas = new Map();
    for (const c of comercios) {
      const { gridLat, gridLng } = redondearGrilla(c.lat, c.lng);
      grillas.set(`${gridLat},${gridLng}`, { gridLat, gridLng });
    }

    for (const { gridLat, gridLng } of grillas.values()) {
      const clima = await obtenerClimaLive(gridLat, gridLng);
      if (!clima) continue;
      const adverso = esClimaAdverso(clima.weatherCode, clima.precipMM);
      await upsertCache(gridLat, gridLng, clima, adverso);
    }
  } catch (err) {
    console.error('[climaService] refrescarCacheClima falló:', err?.message ?? err);
  }
}
