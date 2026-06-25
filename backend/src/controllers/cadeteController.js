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


/**
 * GET /api/cadete/efectivo
 * Devuelve deuda_efectivo, limite_efectivo y liquidaciones recientes.
 */
export async function getEfectivo(req, res) {
  const cadeteId = req.user.id;

  const rolCadete = await resolveRol(cadeteId, req.user.user_metadata);
  if (rolCadete !== 'cadete') {
    return res.status(403).json({ error: 'Solo cadetes' });
  }

  const [{ data: cadete }, { data: liquidaciones }] = await Promise.all([
    supabaseAdmin.from('cadetes').select('deuda_efectivo, limite_efectivo').eq('auth_uid', cadeteId).single(),
    supabaseAdmin.from('liquidaciones').select('*').eq('cadete_id', cadeteId).order('created_at', { ascending: false }).limit(20),
  ]);

  if (!cadete) return res.status(404).json({ error: 'Cadete no encontrado' });

  return res.json({
    deuda_efectivo:  Number(cadete.deuda_efectivo ?? 0),
    limite_efectivo: Number(cadete.limite_efectivo ?? 15000),
    liquidaciones:   liquidaciones ?? [],
  });
}


/**
 * POST /api/cadete/solicitar-liquidacion
 * El cadete solicita devolver efectivo acumulado.
 * Body: { monto, metodo? }
 */
export async function solicitarLiquidacion(req, res) {
  const cadeteId = req.user.id;
  const { monto, metodo } = req.body ?? {};

  const rolCadete = await resolveRol(cadeteId, req.user.user_metadata);
  if (rolCadete !== 'cadete') {
    return res.status(403).json({ error: 'Solo cadetes' });
  }

  const montoNum = Number(monto);
  if (!montoNum || montoNum <= 0) {
    return res.status(400).json({ error: 'Monto inválido' });
  }

  const { data: cadete } = await supabaseAdmin
    .from('cadetes').select('deuda_efectivo').eq('auth_uid', cadeteId).single();

  if (!cadete || montoNum > Number(cadete.deuda_efectivo ?? 0)) {
    return res.status(400).json({ error: 'El monto excede la deuda actual' });
  }

  const { data: liq, error } = await supabaseAdmin
    .from('liquidaciones')
    .insert({
      cadete_id: cadeteId,
      monto:     montoNum,
      metodo:    metodo || 'transferencia',
    })
    .select()
    .single();

  if (error) {
    console.error('[Liquidacion] Error:', error.message);
    return res.status(500).json({ error: 'Error creando liquidación' });
  }

  return res.json({ ok: true, liquidacion: liq });
}


/**
 * POST /api/cadete/validar-referido
 * Valida un código de referido e inserta en referidos_cadete.
 * Body: { codigo }
 */
export async function validarReferido(req, res) {
  const cadeteId = req.user.id;
  const { codigo } = req.body ?? {};

  if (!codigo || typeof codigo !== 'string') {
    return res.status(400).json({ error: 'Código requerido' });
  }

  const codigoUpper = codigo.trim().toUpperCase();

  const { data: referente } = await supabaseAdmin
    .from('cadetes')
    .select('auth_uid, nombre')
    .eq('codigo_referido', codigoUpper)
    .single();

  if (!referente) {
    return res.status(404).json({ error: 'Código de referido no encontrado' });
  }

  if (referente.auth_uid === cadeteId) {
    return res.status(400).json({ error: 'No podés usar tu propio código' });
  }

  const { data: yaUsado } = await supabaseAdmin
    .from('referidos_cadete')
    .select('id')
    .eq('referido_id', cadeteId)
    .maybeSingle();

  if (yaUsado) {
    return res.status(409).json({ error: 'Ya usaste un código de referido' });
  }

  const { error } = await supabaseAdmin
    .from('referidos_cadete')
    .insert({
      referente_id: referente.auth_uid,
      referido_id:  cadeteId,
      codigo_usado: codigoUpper,
      bonificacion: 500,
    });

  if (error) {
    console.error('[Referido] Error:', error.message);
    return res.status(500).json({ error: 'Error registrando referido' });
  }

  await supabaseAdmin
    .from('cadetes')
    .update({ referido_por: codigoUpper })
    .eq('auth_uid', cadeteId);

  return res.json({
    ok: true,
    referente_nombre: referente.nombre,
    bonificacion: 500,
  });
}


/**
 * PATCH /api/cadete/liquidacion/:id/confirmar
 * Admin confirma la liquidación y descuenta deuda_efectivo del cadete.
 */
export async function confirmarLiquidacion(req, res) {
  const adminId = req.user.id;
  const adminRol = await resolveRol(adminId, req.user.user_metadata);
  if (adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin' });

  const { id } = req.params;

  const { data: liq, error: fetchErr } = await supabaseAdmin
    .from('liquidaciones')
    .select('id, cadete_id, monto, estado')
    .eq('id', id)
    .single();

  if (fetchErr || !liq) return res.status(404).json({ error: 'Liquidación no encontrada' });
  if (liq.estado !== 'pendiente') return res.status(400).json({ error: 'Ya fue procesada' });

  const { error: updErr } = await supabaseAdmin
    .from('liquidaciones')
    .update({ estado: 'confirmada', confirmado_at: new Date().toISOString() })
    .eq('id', id);

  if (updErr) return res.status(500).json({ error: 'Error actualizando liquidación' });

  const { data: cadete } = await supabaseAdmin
    .from('cadetes').select('deuda_efectivo').eq('auth_uid', liq.cadete_id).single();

  if (cadete) {
    const nuevaDeuda = Math.max(0, Number(cadete.deuda_efectivo ?? 0) - Number(liq.monto));
    await supabaseAdmin
      .from('cadetes')
      .update({ deuda_efectivo: nuevaDeuda })
      .eq('auth_uid', liq.cadete_id);
  }

  return res.json({ ok: true });
}


/**
 * PATCH /api/cadete/liquidacion/:id/rechazar
 * Admin rechaza la liquidación.
 */
export async function rechazarLiquidacion(req, res) {
  const adminId = req.user.id;
  const adminRol = await resolveRol(adminId, req.user.user_metadata);
  if (adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin' });

  const { id } = req.params;

  const { error } = await supabaseAdmin
    .from('liquidaciones')
    .update({ estado: 'rechazada' })
    .eq('id', id)
    .eq('estado', 'pendiente');

  if (error) return res.status(500).json({ error: 'Error rechazando liquidación' });

  return res.json({ ok: true });
}


/**
 * PATCH /api/cadete/:id/efectivo
 * Admin modifica deuda_efectivo y/o limite_efectivo de un cadete.
 * Body: { deuda_efectivo?, limite_efectivo? }
 */
export async function adminActualizarEfectivo(req, res) {
  const adminId = req.user.id;
  const adminRol = await resolveRol(adminId, req.user.user_metadata);
  if (adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin' });

  const { id: cadeteAuthUid } = req.params;
  const { deuda_efectivo, limite_efectivo } = req.body ?? {};

  const update = {};
  if (deuda_efectivo != null)  update.deuda_efectivo  = Number(deuda_efectivo);
  if (limite_efectivo != null) update.limite_efectivo = Number(limite_efectivo);

  if (!Object.keys(update).length) {
    return res.status(400).json({ error: 'Enviar deuda_efectivo y/o limite_efectivo' });
  }

  const { data, error } = await supabaseAdmin
    .from('cadetes')
    .update(update)
    .eq('auth_uid', cadeteAuthUid)
    .select('auth_uid, nombre, deuda_efectivo, limite_efectivo')
    .single();

  if (error) return res.status(500).json({ error: 'Error actualizando: ' + error.message });
  if (!data) return res.status(404).json({ error: 'Cadete no encontrado' });

  return res.json({ ok: true, cadete: data });
}


/**
 * GET /api/cadete/admin/lista
 * Admin obtiene todos los cadetes con su info de efectivo.
 */
export async function adminListaCadetes(req, res) {
  const adminId = req.user.id;
  const adminRol = await resolveRol(adminId, req.user.user_metadata);
  if (adminRol !== 'admin') return res.status(403).json({ error: 'Solo admin' });

  const { data, error } = await supabaseAdmin
    .from('cadetes')
    .select('auth_uid, nombre, email, vehiculo, disponible, deuda_efectivo, limite_efectivo, total_viajes, rating, onboarding_completo')
    .order('nombre', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });

  return res.json({ cadetes: data ?? [] });
}
