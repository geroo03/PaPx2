import { supabaseAdmin } from '../lib/supabaseClient.js';
import { resolveRol }    from '../lib/roleUtils.js';

/**
 * POST /api/cadete/actualizar-ubicacion
 *
 * El app del cadete llama este endpoint periódicamente (cada 5-10 seg)
 * para reportar su posición GPS. Hace UPSERT en 'ubicacion_cadetes'.
 * Supabase Realtime propaga el cambio al mapa del cliente sin WebSockets propios.
 *
 * Body: { lat, lng, pedido_id? }
 * Requiere Bearer token del cadete (requireAuth).
 */
export async function actualizarUbicacion(req, res) {
  const { lat, lng, pedido_id } = req.body ?? {};
  const cadeteId = req.user.id;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat y lng son requeridos' });
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    isNaN(latNum) || isNaN(lngNum) ||
    latNum < -90  || latNum > 90   ||
    lngNum < -180 || lngNum > 180
  ) {
    return res.status(400).json({ error: 'Coordenadas fuera de rango válido' });
  }

  const rolCadete = await resolveRol(cadeteId, req.user.user_metadata);
  if (rolCadete !== 'cadete') {
    return res.status(403).json({ error: 'Solo cadetes pueden actualizar su ubicación' });
  }

  const upsertData = {
    cadete_id:           cadeteId,
    latitud:             latNum,
    longitud:            lngNum,
    activo:              true,
    ultima_actualizacion: new Date().toISOString(),
    ...(pedido_id && { pedido_id }),
  };

  const { error: upsertErr } = await supabaseAdmin
    .from('ubicacion_cadetes')
    .upsert(upsertData, { onConflict: 'cadete_id' });

  if (upsertErr) {
    console.error('[GPS] Error guardando ubicación:', upsertErr.message);
    return res.status(500).json({ error: 'Error guardando ubicación GPS' });
  }

  return res.json({ ok: true, gps: 'actualizado' });
}
