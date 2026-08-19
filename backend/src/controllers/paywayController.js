/**
 * paywayController.js
 *
 * ⚠️ WIP — NO conectado al flujo real de pedidos todavía. Ningún HTML/JS del
 * frontend en producción llama a estos endpoints (a diferencia de
 * mpController.js, que sí es el camino de pago real hoy). Ver
 * docs/PAYWAY-INTEGRACION.md para el estado completo y qué falta para
 * activarlo de verdad.
 *
 * Diferencia clave de arquitectura vs. mpController.js: Payway no tiene
 * checkout hospedado ni webhook — el frontend tokeniza la tarjeta
 * directamente contra la API de Payway (ver frontend/assets/js/payway.js)
 * y le manda el token a ESTE backend, que ejecuta el cobro y recibe el
 * resultado (aprobado/rechazado) en la misma respuesta HTTP. Por eso acá no
 * hay un `paywayWebhook` — `crearPago` hace el trabajo que en mpController.js
 * está repartido entre `crearPreferencia` (crear) y `mpWebhook` (confirmar).
 */

import { supabaseAdmin } from '../lib/supabaseClient.js';
import { ejecutarPago as ejecutarPagoPayway, consultarPago as consultarPagoPayway } from '../lib/paywayClient.js';
import { pesosToPaywayAmount, mapEstadoPayway } from '../lib/paywayUtils.js';

/**
 * POST /api/payway/crear-pago
 * Body: { pedido_id?, token, bin, payment_method_id, installments?, items, total,
 *         comercio_id, cliente_id, direccion_entrega, propina_cadete? }
 *
 * Requiere que el frontend ya haya tokenizado la tarjeta (payway.js) — este
 * endpoint nunca recibe datos crudos de tarjeta, solo el token.
 */
export async function crearPago(req, res) {
  if (!process.env.PAYWAY_PRIVATE_KEY) {
    return res.status(501).json({
      error: 'Payway no está configurado todavía en este servidor (falta PAYWAY_PRIVATE_KEY). ' +
             'Ver docs/PAYWAY-INTEGRACION.md.',
    });
  }

  const {
    pedido_id, token, bin, payment_method_id, installments,
    items, total, comercio_id, cliente_id, direccion_entrega, propina_cadete,
  } = req.body ?? {};

  if (!token || !bin || !payment_method_id) {
    return res.status(400).json({ error: 'Campos requeridos: token, bin, payment_method_id' });
  }
  if (!Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({ error: 'Campos requeridos: items (array), total (number)' });
  }

  const propinaNum = Math.max(0, Math.floor(Number(propina_cadete ?? 0)));
  if (propinaNum > 10000) {
    return res.status(400).json({ error: 'La propina no puede superar $10.000' });
  }

  const subtotal = items.reduce(
    (s, item) => s + Number(item.precio ?? item.unit_price ?? 0) * Number(item.qty ?? item.quantity ?? 1),
    0,
  );

  // site_transaction_id propio, para reconciliar con Payway independientemente
  // del payment_id que ellos asignen — mismo criterio que pedido_id en MP.
  const siteTransactionId = `pap-${pedido_id ?? 'nuevo'}-${Date.now()}`;

  let resultado;
  try {
    resultado = await ejecutarPagoPayway({
      site_transaction_id: siteTransactionId,
      token,
      bin,
      payment_method_id,
      installments: installments ?? 1,
      amount: pesosToPaywayAmount(Number(total)),
      customer: {
        id:         cliente_id || req.user.id,
        email:      req.user.email,
        ip_address: req.ip,
      },
    });
  } catch (err) {
    console.error('[Payway] Error ejecutando pago:', err?.message ?? err, err?.data ?? '');
    return res.status(502).json({ error: 'No se pudo procesar el pago con Payway' });
  }

  const estadoPago = mapEstadoPayway(resultado?.status);
  console.log(`[Payway] site_transaction_id:${siteTransactionId} payment_id:${resultado?.id} status:${resultado?.status} → ${estadoPago}`);

  if (estadoPago !== 'aprobado') {
    return res.status(402).json({
      error:  'Pago rechazado',
      status: resultado?.status ?? 'desconocido',
    });
  }

  try {
    // Idempotencia — mismo criterio que mpWebhook: si por lo que sea este
    // endpoint se llama dos veces para el mismo payment_id, no duplicar el pedido.
    const { data: pedidoExistente } = await supabaseAdmin
      .from('pedidos')
      .select('id')
      .eq('payway_payment_id', String(resultado.id))
      .maybeSingle();

    if (pedidoExistente) {
      return res.json({ ok: true, pedido_id: pedidoExistente.id, ya_existia: true });
    }

    if (pedido_id) {
      await supabaseAdmin.from('pedidos')
        .update({ estado: 'nuevo', estado_pago: 'aprobado', payway_payment_id: String(resultado.id) })
        .eq('id', pedido_id);
      return res.json({ ok: true, pedido_id, payment_id: resultado.id });
    }

    const { data: nuevoPedido, error: insertErr } = await supabaseAdmin
      .from('pedidos')
      .insert({
        comercio_id:       comercio_id || null,
        cliente_id:        cliente_id || req.user.id,
        productos:         items,
        subtotal,
        total:             Number(total),
        direccion_entrega: direccion_entrega || '',
        propina_cadete:    propinaNum,
        metodo_pago:       'payway',
        estado:            'nuevo',
        estado_pago:       'aprobado',
        payway_payment_id: String(resultado.id),
      })
      .select('id, numero')
      .single();

    if (insertErr) {
      console.error('[Payway] Error creando pedido:', insertErr.message);
      return res.status(500).json({ error: 'Pago aprobado pero no se pudo crear el pedido' });
    }

    return res.json({ ok: true, pedido_id: nuevoPedido.id, numero: nuevoPedido.numero, payment_id: resultado.id });
  } catch (err) {
    console.error('[Payway] Error post-pago:', err?.message ?? err);
    return res.status(500).json({ error: 'Pago aprobado pero hubo un error registrando el pedido' });
  }
}

/**
 * GET /api/payway/estado/:paymentId
 * Reconsulta el estado de un pago contra Payway — para reconciliación/debug,
 * no es parte del flujo normal (crearPago ya confirma en el momento).
 */
export async function consultarEstado(req, res) {
  if (!process.env.PAYWAY_PRIVATE_KEY) {
    return res.status(501).json({ error: 'Payway no está configurado todavía en este servidor.' });
  }

  const { paymentId } = req.params;
  try {
    const resultado = await consultarPagoPayway(paymentId);
    return res.json({ status: resultado?.status, estado_pago: mapEstadoPayway(resultado?.status), raw: resultado });
  } catch (err) {
    console.error('[Payway] Error consultando pago:', err?.message ?? err);
    return res.status(502).json({ error: 'No se pudo consultar el estado del pago' });
  }
}
