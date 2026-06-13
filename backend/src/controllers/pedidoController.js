/**
 * pedidoController.js
 *
 * Lógica de negocio del recurso pedidos.
 * Opera con supabaseAdmin (service_role) para bypassear RLS en todas las
 * escrituras del servidor.
 *
 * Esquema de DB relevante:
 *   profiles        → id (PK), role           ← tabla nativa de Supabase Auth
 *   pedidos         → id, cliente_id, cadete_id, estado, codigo_retiro,
 *                     codigo_entrega, distancia_estimada, pago_cadete
 *   ofertas_cadetes → id, pedido_id, cadete_id, distancia_estimada, pago_cadete
 */

import crypto from 'node:crypto';
import { supabaseAdmin } from '../lib/supabaseClient.js';

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
