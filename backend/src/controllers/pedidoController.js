/**
 * pedidoController.js
 *
 * Lógica de negocio del recurso pedidos.
 * Opera con supabaseAdmin (service_role) para bypassear RLS en todas las
 * escrituras del servidor.
 *
 * Esquema de DB relevante:
 *   perfiles        → id (PK = auth.uid), rol, nombre, apellido, vehiculo, color
 *   pedidos         → id, cliente_id, cadete_id, estado, codigo_retiro,
 *                     codigo_entrega, distancia_estimada, pago_cadete
 *   ofertas_cadetes → id, pedido_id, cadete_id, comercio_nombre, comercio_lat,
 *                     comercio_lng, cliente_direccion, distancia_km,
 *                     ganancia_estimada, distancia_estimada, pago_cadete, estado
 *   comercios       → id, nombre, direccion, lat, lng
 *   cadetes         → auth_uid, disponible, activo
 *   ubicacion_cadetes → cadete_id, latitud, longitud, ultima_actualizacion
 */

import crypto from 'node:crypto';
import { supabaseAdmin }            from '../lib/supabaseClient.js';
import { registrarComisionSiAplica } from './embajadorController.js';
import { notificarCadeteNuevoViaje, notificarClienteEstado, notificarComercioNuevoPedido } from './pushController.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Genera un código numérico de 4 dígitos como string con ceros a la izquierda.
 * Ejemplos: "0432", "9999", "0001"
 *
 * crypto.randomInt(min, max) es CSPRNG (Cryptographically Secure Pseudo-Random
 * Number Generator) — a diferencia de Math.random(), no es predecible.
 * Rango [0, 10000) → 0 a 9999 → siempre 4 dígitos con padStart.
 */
function generarCodigo4Digitos() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// ─── Controller ───────────────────────────────────────────────────────────────

/**
 * POST /api/pedidos/aceptar
 *
 * Un cadete acepta un viaje disponible. Ejecuta 3 pasos atómicos:
 *   1. Captura la tarifa inmutable desde ofertas_cadetes
 *   2. Genera los códigos de confirmación server-side
 *   3. Actualiza pedidos con anti-collision (cadete_id IS NULL)
 *
 * Body esperado:
 *   { pedidoId: string, cadeteId: string, ofertaId: string }
 *
 * req.user es inyectado por authMiddleware y contiene el usuario autenticado.
 */
export async function aceptarPedido(req, res) {

  // ── Validación de inputs ──────────────────────────────────────────────────
  const { pedidoId, cadeteId, ofertaId } = req.body ?? {};

  if (!pedidoId || !cadeteId || !ofertaId) {
    return res.status(400).json({
      error: 'Faltan campos requeridos en el body: pedidoId, cadeteId, ofertaId.',
    });
  }

  // Verificar que el cadete que acepta es el mismo usuario autenticado.
  // Previene que alguien acepte viajes en nombre de otro cadete.
  if (cadeteId !== req.user.id) {
    return res.status(403).json({
      error: 'Prohibido: no podés aceptar un viaje en nombre de otro repartidor.',
    });
  }

  // ── Verificar que supabaseAdmin está disponible ───────────────────────────
  if (!supabaseAdmin) {
    console.error('[aceptarPedido] supabaseAdmin no inicializado. Verificá SUPABASE_SERVICE_ROLE_KEY en .env');
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {

    // ── PASO 1: Capturar tarifa inmutable desde ofertas_cadetes ──────────────
    //
    // distancia_estimada y pago_cadete se copian AHORA, una sola vez,
    // para que no puedan alterarse retroactivamente desde el cliente.
    // Se valida que la oferta pertenezca a este cadete Y a este pedido
    // para que no pueda usarse una oferta de otro pedido como truco.
    const { data: oferta, error: ofertaError } = await supabaseAdmin
      .from('ofertas_cadetes')
      .select('pedido_id, distancia_estimada, pago_cadete')
      .eq('id', ofertaId)
      .eq('cadete_id', cadeteId)
      .single();

    if (ofertaError || !oferta) {
      return res.status(404).json({
        error: 'Oferta no encontrada o no pertenece a este repartidor.',
      });
    }

    if (oferta.pedido_id !== pedidoId) {
      return res.status(400).json({
        error: 'La oferta indicada no corresponde al pedido indicado.',
      });
    }

    // ── PASO 2: Generar códigos de confirmación server-side ──────────────────
    //
    // codigo_retiro  → el comercio se lo dice al cadete verbalmente al retirar.
    // codigo_entrega → el cliente lo ve en su pantalla de tracking y se lo
    //                  dice al cadete al entregar.
    // Ambos son CSPRNG: impredecibles, no reusables, generados en el servidor.
    const codigo_retiro  = generarCodigo4Digitos();
    const codigo_entrega = generarCodigo4Digitos();

    // ── PASO 3: Actualización atómica con anti-collision ─────────────────────
    //
    // .is('cadete_id', null) es la clave: PostgreSQL ejecuta el UPDATE solo si
    // cadete_id sigue siendo NULL en el momento exacto de la escritura.
    // Si dos cadetes intentan aceptar el mismo pedido al mismo milisegundo,
    // solo uno obtiene affected_rows > 0 — el otro recibe un array vacío → 409.
    //
    // Campos congelados:
    //   cadete_id          → asigna el cadete
    //   estado             → 'en_preparacion' (flujo confirmado)
    //   codigo_retiro      → 4 dígitos, generado arriba
    //   codigo_entrega     → 4 dígitos, generado arriba
    //   distancia_estimada → copiado desde ofertas_cadetes (inmutable)
    //   pago_cadete        → copiado desde ofertas_cadetes (inmutable)
    const { data: pedidoActualizado, error: updateError } = await supabaseAdmin
      .from('pedidos')
      .update({
        cadete_id:           cadeteId,
        estado:              'en_preparacion',
        codigo_retiro,
        codigo_entrega,
        distancia_estimada:  oferta.distancia_estimada,
        pago_cadete:         oferta.pago_cadete,
      })
      .eq('id', pedidoId)
      .is('cadete_id', null)        // anti-collision atómico
      .select('id, estado, cadete_id');

    if (updateError) {
      console.error('[aceptarPedido] Error al actualizar pedido:', updateError.message);
      return res.status(500).json({ error: 'Error al actualizar el pedido.' });
    }

    // Array vacío = cadete_id ya no era NULL → otro cadete ganó la carrera
    if (!pedidoActualizado || pedidoActualizado.length === 0) {
      return res.status(409).json({
        error:   'Este pedido acaba de ser tomado por otro repartidor.',
        code:    'PEDIDO_YA_TOMADO',
        mensaje: 'Seguí buscando — hay más viajes disponibles.',
      });
    }

    // ── Respuesta exitosa ─────────────────────────────────────────────────────
    return res.status(200).json({
      ok:      true,
      pedido:  pedidoActualizado[0],
      mensaje: 'Pedido aceptado. ¡A por él!',
    });

  } catch (err) {
    // Captura errores de red, timeouts, etc.
    console.error('[aceptarPedido] Excepción no controlada:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── Helpers privados ──────────────────────────────────────────────────────────

// Comparación de códigos en tiempo constante (previene timing attacks).
// Ambos strings se normalizan a 4 chars para que los buffers tengan igual longitud.
function codigosIguales(a, b) {
  try {
    const ba = Buffer.from(String(a ?? '').slice(0, 4).padEnd(4, '\0'));
    const bb = Buffer.from(String(b ?? '').slice(0, 4).padEnd(4, '\0'));
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// ─── cambiarEstadoPedido ───────────────────────────────────────────────────────

/**
 * POST /api/pedidos/cambiar-estado
 *
 * El cadete confirma el retiro del comercio (→ en_camino) o la entrega al
 * cliente (→ entregado). Ambas transiciones requieren validar el código de 4
 * dígitos correspondiente con comparación en tiempo constante.
 *
 * Body: { pedido_id, nuevo_estado, codigo_retiro?, codigo_entrega? }
 */
export async function cambiarEstadoPedido(req, res) {
  const { pedido_id, nuevo_estado, codigo_retiro, codigo_entrega } = req.body ?? {};

  if (!pedido_id || !nuevo_estado) {
    return res.status(400).json({ error: 'Faltan campos: pedido_id, nuevo_estado.' });
  }

  const estadosPermitidos = ['en_camino', 'entregado'];
  if (!estadosPermitidos.includes(nuevo_estado)) {
    return res.status(400).json({
      error: `Estado '${nuevo_estado}' no soportado en esta ruta. Usá: ${estadosPermitidos.join(', ')}.`,
    });
  }

  if (!supabaseAdmin) {
    console.error('[cambiarEstadoPedido] supabaseAdmin no inicializado.');
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    // ── PASO 1: Leer el pedido actual ──────────────────────────────────────────
    const { data: pedido, error: fetchErr } = await supabaseAdmin
      .from('pedidos')
      .select('id, cadete_id, comercio_id, estado, subtotal, total, codigo_retiro, codigo_entrega')
      .eq('id', pedido_id)
      .single();

    if (fetchErr || !pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    // ── PASO 2: Verificar que quien pide el cambio es el cadete asignado ───────
    if (pedido.cadete_id !== req.user.id) {
      return res.status(403).json({
        error: 'Solo el repartidor asignado puede actualizar el estado de este pedido.',
      });
    }

    // ── PASO 3: Validar el código correspondiente ──────────────────────────────
    if (nuevo_estado === 'en_camino') {
      if (!pedido.codigo_retiro) {
        return res.status(400).json({ error: 'Este pedido no tiene código de retiro generado.' });
      }
      if (!codigosIguales(codigo_retiro, pedido.codigo_retiro)) {
        return res.status(403).json({
          error: 'Código de retiro incorrecto.',
          code:  'CODIGO_INCORRECTO',
        });
      }
    }

    if (nuevo_estado === 'entregado') {
      if (!pedido.codigo_entrega) {
        return res.status(400).json({ error: 'Este pedido no tiene código de entrega generado.' });
      }
      if (!codigosIguales(codigo_entrega, pedido.codigo_entrega)) {
        return res.status(403).json({
          error: 'Código de entrega incorrecto.',
          code:  'CODIGO_INCORRECTO',
        });
      }
    }

    // ── PASO 4: Actualizar estado ──────────────────────────────────────────────
    // La doble condición (.eq cadete_id) actúa como segundo candado de seguridad.
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('pedidos')
      .update({ estado: nuevo_estado })
      .eq('id', pedido_id)
      .eq('cadete_id', req.user.id)
      .select('id, estado');

    if (updateErr) {
      console.error('[cambiarEstadoPedido] Error al actualizar:', updateErr.message);
      return res.status(500).json({ error: 'Error al actualizar el pedido.' });
    }

    // Cuando el pedido se entrega, disparar el cálculo de comisión del embajador.
    if (nuevo_estado === 'entregado' && pedido.comercio_id) {
      const montoBase = Number(pedido.subtotal ?? pedido.total ?? 0);
      registrarComisionSiAplica(pedido_id, pedido.comercio_id, montoBase)
        .catch(e => console.error('[Comision] hook fallo silenciosamente:', e?.message));
    }

    // Push notification al cliente sobre el cambio de estado
    if (pedido.cliente_id) {
      const comercioNombre = await supabaseAdmin
        .from('comercios').select('nombre').eq('id', pedido.comercio_id).single()
        .then(r => r.data?.nombre || 'Tu comercio')
        .catch(() => 'Tu comercio');
      notificarClienteEstado(pedido.cliente_id, nuevo_estado, comercioNombre).catch(() => {});
    }

    return res.status(200).json({ ok: true, pedido: updated[0] });

  } catch (err) {
    console.error('[cambiarEstadoPedido] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── getPedidoConCadete ────────────────────────────────────────────────────────

/**
 * GET /api/pedidos/:id
 *
 * Devuelve el pedido con el perfil del cadete asignado.
 * Solo lo puede consultar un participante del pedido (cliente, cadete, comercio).
 *
 * El código de entrega solo se expone al cliente y únicamente cuando el
 * pedido está en estado 'en_camino' (el cadete ya retiró el pedido).
 */
export async function getPedidoConCadete(req, res) {
  const { id: pedidoId } = req.params;

  if (!supabaseAdmin) {
    console.error('[getPedidoConCadete] supabaseAdmin no inicializado.');
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    // ── PASO 1: Leer pedido ────────────────────────────────────────────────────
    const { data: pedido, error } = await supabaseAdmin
      .from('pedidos')
      .select('id, estado, cadete_id, cliente_id, comercio_id, codigo_entrega')
      .eq('id', pedidoId)
      .single();

    if (error || !pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    // ── PASO 2: Verificar que el solicitante es participante ───────────────────
    const userId = req.user.id;
    const esParticipante =
      userId === pedido.cliente_id  ||
      userId === pedido.cadete_id   ||
      userId === pedido.comercio_id;

    if (!esParticipante) {
      return res.status(403).json({ error: 'Sin acceso a este pedido.' });
    }

    // ── PASO 3: Leer perfil del cadete (tabla perfiles, no profiles) ───────────
    let cadete_perfil = null;
    if (pedido.cadete_id) {
      const { data: perfil } = await supabaseAdmin
        .from('perfiles')
        .select('usuario_id, nombre, apellido, vehiculo, color, avatar_url')
        .eq('usuario_id', pedido.cadete_id)
        .single();
      cadete_perfil = perfil ?? null;
    }

    // ── PASO 4: Armar respuesta con visibilidad controlada ────────────────────
    const response = {
      id:           pedido.id,
      estado:       pedido.estado,
      cadete_perfil,
    };

    // El código de entrega solo lo ve el cliente y solo cuando el cadete ya retiró
    if (userId === pedido.cliente_id && pedido.estado === 'en_camino') {
      response.codigo_entrega = pedido.codigo_entrega;
    }

    return res.status(200).json(response);

  } catch (err) {
    console.error('[getPedidoConCadete] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── difundirPedido ────────────────────────────────────────────────────────────

/**
 * POST /api/pedidos/difundir
 *
 * Cuando el comercio acepta un pedido (estado → 'preparando'), este endpoint:
 *   1. Lee las coordenadas del comercio (comercios.lat / comercios.lng)
 *   2. Busca cadetes con disponible=true y GPS activo en los últimos 15 minutos
 *   3. Calcula distancia Haversine y filtra dentro del radio de 10 km
 *   4. Inserta filas en ofertas_cadetes para los N más cercanos
 *   5. El Realtime del cadete detecta el INSERT y muestra la oferta
 *
 * Body: { pedidoId: string, comercioId: string }
 * El comercio debe estar lat/lng configurados; sin coordenadas no hay difusión.
 */
export async function difundirPedido(req, res) {
  const { pedidoId, comercioId } = req.body ?? {};

  if (!pedidoId || !comercioId) {
    return res.status(400).json({ error: 'Faltan campos: pedidoId, comercioId.' });
  }

  if (!supabaseAdmin) {
    console.error('[difundirPedido] supabaseAdmin no inicializado.');
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    // ── PASO 1: Coordenadas del comercio ──────────────────────────────────────
    const { data: comercio, error: comErr } = await supabaseAdmin
      .from('comercios')
      .select('id, nombre, direccion, lat, lng')
      .eq('id', comercioId)
      .single();

    if (comErr || !comercio) {
      return res.status(404).json({ error: 'Comercio no encontrado.' });
    }

    const comLat = Number(comercio.lat ?? 0);
    const comLng = Number(comercio.lng ?? 0);

    if (!comLat || !comLng) {
      return res.status(200).json({
        ok: true, difundido: 0,
        mensaje: 'El comercio no tiene coordenadas GPS. Configurarlas en el perfil del comercio.',
      });
    }

    // ── PASO 2: Dirección de entrega del pedido ───────────────────────────────
    const { data: pedido, error: pedErr } = await supabaseAdmin
      .from('pedidos')
      .select('id, direccion_entrega')
      .eq('id', pedidoId)
      .single();

    if (pedErr || !pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado.' });
    }

    // ── PASO 3: Posiciones GPS recientes (últimos 15 min) ─────────────────────
    const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: posiciones } = await supabaseAdmin
      .from('ubicacion_cadetes')
      .select('cadete_id, latitud, longitud')
      .gte('ultima_actualizacion', cutoff);

    if (!posiciones?.length) {
      return res.status(200).json({ ok: true, difundido: 0, mensaje: 'Sin cadetes con GPS activo.' });
    }

    // ── PASO 4: Filtrar por cadetes disponibles ───────────────────────────────
    const posMap = Object.fromEntries(posiciones.map(p => [p.cadete_id, p]));

    const { data: cadetesDisp } = await supabaseAdmin
      .from('cadetes')
      .select('auth_uid, nombre, vehiculo')
      .eq('disponible', true)
      .eq('activo', true)
      .in('auth_uid', Object.keys(posMap));

    if (!cadetesDisp?.length) {
      return res.status(200).json({ ok: true, difundido: 0, mensaje: 'Sin cadetes disponibles en la zona.' });
    }

    // ── PASO 5: Haversine — ordenar por cercanía ──────────────────────────────
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

    const RADIO_MAX_KM  = 10;
    const MAX_OFERTAS   = 5;
    const TARIFA_POR_KM = 250;
    const TARIFA_BASE_VEHICULO = { moto: 1800, bici: 1200 };

    const candidatos = cadetesDisp
      .map(c => {
        const pos = posMap[c.auth_uid];
        const veh = (c.vehiculo ?? '').toLowerCase();
        const base = TARIFA_BASE_VEHICULO[veh] ?? TARIFA_BASE_VEHICULO.bici;
        return {
          ...c,
          tarifa_base: base,
          distancia_km: haversineKm(
            Number(pos.latitud), Number(pos.longitud),
            comLat, comLng,
          ),
        };
      })
      .filter(c => c.distancia_km <= RADIO_MAX_KM)
      .sort((a, b) => a.distancia_km - b.distancia_km)
      .slice(0, MAX_OFERTAS);

    if (!candidatos.length) {
      return res.status(200).json({
        ok: true, difundido: 0,
        mensaje: `Sin cadetes dentro del radio de ${RADIO_MAX_KM} km.`,
      });
    }

    const ofertas = candidatos.map(c => {
      const dist     = Math.round(c.distancia_km * 10) / 10;
      const ganancia = Math.round((c.tarifa_base + dist * TARIFA_POR_KM) / 50) * 50;
      return {
        pedido_id:          pedidoId,
        cadete_id:          c.auth_uid,
        comercio_nombre:    comercio.nombre,
        comercio_direccion: comercio.direccion || '',
        comercio_lat:       comLat,
        comercio_lng:       comLng,
        cliente_direccion:  pedido.direccion_entrega || '',
        distancia_km:       dist,
        ganancia_estimada:  ganancia,
        distancia_estimada: dist,
        pago_cadete:        ganancia,
        estado:             'pendiente',
      };
    });

    const { error: insertErr } = await supabaseAdmin
      .from('ofertas_cadetes')
      .insert(ofertas);

    if (insertErr) {
      console.error('[difundirPedido] Error al insertar ofertas:', insertErr.message);
      return res.status(500).json({ error: 'Error al crear ofertas para cadetes.' });
    }

    // Push notification a cada cadete candidato
    for (const o of ofertas) {
      notificarCadeteNuevoViaje(o.cadete_id, comercio.nombre).catch(() => {});
    }

    return res.status(200).json({ ok: true, difundido: ofertas.length });

  } catch (err) {
    console.error('[difundirPedido] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── valorarPedido ────────────────────────────────────────────────────────────

/**
 * POST /api/pedidos/valorar
 *
 * El cliente valora al comercio o al cadete después de la entrega.
 *   tipo: 'comercio' → inserta en tabla ratings
 *   tipo: 'cadete'   → inserta en tabla resenas
 *
 * Body: { pedido_id, tipo: 'comercio'|'cadete', estrellas: 1-5, comentario? }
 */
export async function valorarPedido(req, res) {
  const { pedido_id, tipo, estrellas, comentario } = req.body ?? {};
  const clienteId = req.user.id;

  if (!pedido_id || !tipo || estrellas == null) {
    return res.status(400).json({ error: 'Campos requeridos: pedido_id, tipo, estrellas' });
  }
  if (!['comercio', 'cadete'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser "comercio" o "cadete"' });
  }
  const estrellasNum = Number(estrellas);
  if (!Number.isInteger(estrellasNum) || estrellasNum < 1 || estrellasNum > 5) {
    return res.status(400).json({ error: 'estrellas debe ser un entero entre 1 y 5' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    const { data: pedido, error: pedidoErr } = await supabaseAdmin
      .from('pedidos')
      .select('id, estado, comercio_id, cadete_id, cliente_id')
      .eq('id', pedido_id)
      .single();

    if (pedidoErr || !pedido) {
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    if (pedido.cliente_id !== clienteId) {
      return res.status(403).json({ error: 'No podés valorar un pedido que no es tuyo' });
    }

    if (tipo === 'comercio') {
      if (!pedido.comercio_id) {
        return res.status(400).json({ error: 'El pedido no tiene comercio asignado' });
      }
      const { error } = await supabaseAdmin.from('ratings').insert({
        pedido_id,
        comercio_id: pedido.comercio_id,
        usuario_id:  clienteId,
        rating:      estrellasNum,
        comentario:  comentario?.trim() ?? null,
      });
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Ya valoraste este comercio para este pedido' });
        }
        throw error;
      }

    } else {
      if (!pedido.cadete_id) {
        return res.status(400).json({ error: 'El pedido no tiene cadete asignado' });
      }
      const { error } = await supabaseAdmin.from('resenas').insert({
        pedido_id,
        cadete_id:  pedido.cadete_id,
        cliente_id: clienteId,
        rating:     estrellasNum,
        comentario: comentario?.trim() ?? null,
      });
      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Ya valoraste al cadete para este pedido' });
        }
        throw error;
      }
    }

    // Actualizar promedio de rating del cadete o comercio
    if (tipo === 'cadete' && pedido.cadete_id) {
      try {
        const { data: resenas } = await supabaseAdmin
          .from('resenas').select('rating').eq('cadete_id', pedido.cadete_id);
        if (resenas?.length) {
          const avg = resenas.reduce((s, r) => s + Number(r.rating), 0) / resenas.length;
          await supabaseAdmin.from('cadetes')
            .update({ rating: Math.round(avg * 10) / 10 })
            .eq('auth_uid', pedido.cadete_id);
        }
      } catch {}
    }
    if (tipo === 'comercio' && pedido.comercio_id) {
      try {
        const { data: ratings } = await supabaseAdmin
          .from('ratings').select('rating').eq('comercio_id', pedido.comercio_id);
        if (ratings?.length) {
          const avg = ratings.reduce((s, r) => s + Number(r.rating), 0) / ratings.length;
          await supabaseAdmin.from('comercios')
            .update({ rating: Math.round(avg * 10) / 10 })
            .eq('id', pedido.comercio_id);
        }
      } catch {}
    }

    console.log(`[Valoración] tipo:${tipo} | ${estrellasNum}★ | pedido ${pedido_id}`);
    return res.json({ ok: true, tipo, estrellas: estrellasNum });

  } catch (err) {
    console.error('[valorarPedido] Error:', err?.message ?? err);
    return res.status(500).json({ error: 'Error guardando la valoración.' });
  }
}


/**
 * POST /api/pedidos/notificar-comercio
 * El cliente llama esto después de crear un pedido para pushear al comercio.
 * Body: { pedido_id }
 */
export async function notificarNuevoPedido(req, res) {
  const { pedido_id } = req.body ?? {};
  if (!pedido_id) return res.status(400).json({ error: 'pedido_id requerido' });

  try {
    const { data: pedido } = await supabaseAdmin
      .from('pedidos')
      .select('id, numero, comercio_id')
      .eq('id', pedido_id)
      .single();

    if (!pedido?.comercio_id) return res.json({ ok: true, notificado: false });

    const { data: comercio } = await supabaseAdmin
      .from('comercios')
      .select('usuario_id')
      .eq('id', pedido.comercio_id)
      .single();

    if (comercio?.usuario_id) {
      await notificarComercioNuevoPedido(comercio.usuario_id, pedido.numero || '—');
    }

    return res.json({ ok: true, notificado: !!comercio?.usuario_id });
  } catch {
    return res.json({ ok: true, notificado: false });
  }
}
