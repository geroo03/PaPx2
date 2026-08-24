/**
 * getnetController.js
 *
 * ⚠️ WIP — NO conectado al flujo real de pedidos todavía. Ningún HTML/JS del
 * frontend en producción llama a estos endpoints (a diferencia de
 * mpController.js, que sí es el camino de pago real hoy). Ver
 * docs/GETNET-INTEGRACION.md para el estado completo y qué falta para
 * activarlo de verdad.
 *
 * Misma forma que mpController.js (no que paywayController.js): Get
 * Checkout es un checkout HOSPEDADO por Getnet con confirmación ASÍNCRONA
 * por webhook — arquitectura mucho más parecida a MercadoPago
 * (crearPreferencia/mpWebhook) que a la tokenización síncrona de Payway.
 * Por eso acá hay `crearCheckout` (arma la orden, devuelve dónde mandar al
 * cliente a pagar) + `getnetWebhook` (confirma el pago después, async) —
 * el pedido recién se crea/confirma cuando el webhook avisa que se aprobó,
 * igual que mpController.js.
 */

import { supabaseAdmin } from '../lib/supabaseClient.js';
import { crearCheckout as crearCheckoutGetnet, consultarOrden } from '../lib/getnetClient.js';
import { mapEstadoGetnet, verificarFirmaWebhook } from '../lib/getnetUtils.js';

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8000';
const SERVER_URL   = process.env.SERVER_URL   ?? 'http://localhost:3000';

/**
 * POST /api/getnet/crear-checkout
 * Body: { pedido_id?, items, total, comercio_id, cliente_id, direccion_entrega, propina_cadete? }
 *
 * Empaqueta los datos del pedido igual que crearPreferencia() en
 * mpController.js (todavía no existe fila en `pedidos` en este punto — se
 * crea recién cuando el webhook confirma el pago).
 */
export async function crearCheckout(req, res) {
  if (!process.env.GETNET_CLIENT_ID || !process.env.GETNET_CLIENT_SECRET) {
    return res.status(501).json({
      error: 'Getnet no está configurado todavía en este servidor (falta GETNET_CLIENT_ID/GETNET_CLIENT_SECRET). ' +
             'Ver docs/GETNET-INTEGRACION.md.',
    });
  }

  const { pedido_id, items, total, comercio_id, cliente_id, direccion_entrega, propina_cadete } = req.body ?? {};

  if (!Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({ error: 'Campos requeridos: items (array), total (number)' });
  }

  const propinaNum = Math.max(0, Math.floor(Number(propina_cadete ?? 0)));
  if (propinaNum > 10000) {
    return res.status(400).json({ error: 'La propina no puede superar $10.000' });
  }

  // Subtotal real (sin envío/propina) — mismo motivo que en mpController.js:
  // lo necesita pedidos_compute_totals() en la DB.
  const subtotal = items.reduce(
    (s, item) => s + Number(item.precio ?? item.unit_price ?? 0) * Number(item.qty ?? item.quantity ?? 1),
    0,
  );

  const orderId = `pap-${pedido_id ?? 'nuevo'}-${Date.now()}`;

  // Igual que external_reference en mpController.js: todo el pedido viaja
  // codificado, y el webhook lo decodifica recién cuando confirma el pago.
  // ⚠️ TODO(verificar): a diferencia de MP (que sí soporta un
  // external_reference propio libre), no está confirmado si la Regional
  // API de Getnet permite adjuntar metadata arbitraria a la orden o si hay
  // que guardar este mapeo en una tabla propia (ej. una tabla
  // `getnet_ordenes_pendientes`) en vez de confiar en round-trip de datos
  // opacos. Confirmar contra la doc real antes de activar esto de verdad.
  const refData = {
    comercio_id:       comercio_id || null,
    cliente_id:        cliente_id || req.user.id,
    productos:         items,
    subtotal,
    total:             Number(total),
    direccion_entrega: direccion_entrega || '',
    propina_cadete:    propinaNum,
    metodo_pago:       'getnet',
    pedido_id:         pedido_id || null,
  };

  try {
    const resultado = await crearCheckoutGetnet({
      orderId,
      amount:           Number(total),
      currency:          'ARS',
      notificationUrl:   `${SERVER_URL}/api/getnet/webhook`,
      returnUrl:         `${FRONTEND_URL}/cliente/pago.html?estado=success`,
    });

    // Guardamos refData asociado a orderId — ver TODO arriba sobre dónde
    // debería vivir esto realmente. Por ahora, en memoria vía comentario
    // explícito de que esto NO sobrevive un restart/redeploy ni funciona
    // con WEB_CONCURRENCY>1 (cada worker tendría su propio Map). No usar
    // así en producción — placeholder para que el resto del flujo sea
    // legible mientras no hay API real contra la cual probar esto.
    ordenesEnMemoria.set(orderId, refData);

    return res.json({
      checkout_url: resultado?.checkout_url ?? resultado?.redirect_url ?? null,
      order_id:     orderId,
      raw:          resultado,
    });
  } catch (err) {
    console.error('[Getnet] Error creando checkout:', err?.message ?? err, err?.data ?? '');
    return res.status(502).json({ error: 'No se pudo crear el checkout con Getnet' });
  }
}

// ⚠️ Placeholder WIP — ver comentario en crearCheckout(). Un Map en memoria
// del proceso no es una solución real (se pierde en cada restart, no
// funciona con más de un worker/instancia) — está acá solo para que
// getnetWebhook() tenga algo de qué leer en un test/smoke manual local.
// Antes de activar esto de verdad, reemplazar por una tabla en Supabase
// (mismo patrón que soportaría cualquier metadata que Getnet no permita
// adjuntar directo a la orden — ver TODO en crearCheckout()).
const ordenesEnMemoria = new Map();

/**
 * GET /api/getnet/estado/:orderId
 * Reconsulta el estado de una orden contra Getnet — para reconciliación/debug,
 * no es parte del flujo normal (el webhook ya confirma en su momento).
 */
export async function consultarEstado(req, res) {
  if (!process.env.GETNET_CLIENT_ID || !process.env.GETNET_CLIENT_SECRET) {
    return res.status(501).json({ error: 'Getnet no está configurado todavía en este servidor.' });
  }

  const { orderId } = req.params;
  try {
    const resultado = await consultarOrden(orderId);
    return res.json({ status: resultado?.status, estado_pago: mapEstadoGetnet(resultado?.status), raw: resultado });
  } catch (err) {
    console.error('[Getnet] Error consultando orden:', err?.message ?? err);
    return res.status(502).json({ error: 'No se pudo consultar el estado de la orden' });
  }
}

/**
 * POST /api/getnet/webhook
 * Recibe notificaciones de Getnet. Verifica firma SHA-256. Crea el pedido
 * si el pago fue aprobado. Sin auth (mismo criterio que mpWebhook).
 */
export async function getnetWebhook(req, res) {
  if (!process.env.GETNET_WEBHOOK_SECRET) {
    console.error('[Getnet webhook] GETNET_WEBHOOK_SECRET no configurado en variables de entorno.');
    return res.status(500).json({ error: 'Webhook no configurado correctamente.' });
  }

  // ⚠️ TODO(verificar): nombre real del header de firma no confirmado —
  // 'x-getnet-signature' es un supuesto razonable (convención común de la
  // industria), no un hecho documentado. Ver disclaimer en
  // verificarFirmaWebhook() (getnetUtils.js).
  const firmaRecibida = req.headers['x-getnet-signature'] ?? '';
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});

  const firmaValida = verificarFirmaWebhook(rawBody, firmaRecibida, process.env.GETNET_WEBHOOK_SECRET);
  if (!firmaValida) {
    return res.status(401).json({ error: 'Firma inválida' });
  }

  const { order_id, status } = req.body ?? {};
  if (!order_id) return res.sendStatus(200);

  console.log(`[Getnet webhook] order_id:${order_id} | status:${status}`);

  const estadoPago = mapEstadoGetnet(status);
  if (estadoPago !== 'aprobado') return res.sendStatus(200);

  const refData = ordenesEnMemoria.get(order_id);
  if (!refData) {
    // Ver disclaimer del Map en memoria arriba — en un restart/redeploy o
    // con más de un worker esto va a pasar siempre. Esperado mientras esto
    // sea un esqueleto sin backing real en DB.
    console.error(`[Getnet webhook] order_id:${order_id} aprobado pero sin refData en memoria — no se puede crear el pedido.`);
    return res.sendStatus(200);
  }

  try {
    if (refData.pedido_id) {
      await supabaseAdmin.from('pedidos')
        .update({ estado: 'nuevo', estado_pago: 'aprobado', getnet_payment_id: String(order_id) })
        .eq('id', refData.pedido_id);
      return res.sendStatus(200);
    }

    // Idempotencia — mismo criterio que mpWebhook/paywayController.js.
    const { data: pedidoExistente } = await supabaseAdmin
      .from('pedidos')
      .select('id')
      .eq('getnet_payment_id', String(order_id))
      .maybeSingle();

    if (pedidoExistente) return res.sendStatus(200);

    const { error: insertErr } = await supabaseAdmin
      .from('pedidos')
      .insert({
        comercio_id:       refData.comercio_id,
        cliente_id:        refData.cliente_id,
        productos:         refData.productos,
        subtotal:          refData.subtotal ?? 0,
        total:             refData.total,
        direccion_entrega: refData.direccion_entrega,
        propina_cadete:    refData.propina_cadete || 0,
        metodo_pago:       'getnet',
        estado:            'nuevo',
        estado_pago:       'aprobado',
        getnet_payment_id: String(order_id),
      });

    if (insertErr) {
      console.error('[Getnet webhook] Error creando pedido:', insertErr.message);
      return res.status(500).json({ error: 'Error creando pedido' });
    }

    ordenesEnMemoria.delete(order_id);
    return res.sendStatus(200);
  } catch (err) {
    console.error('[Getnet webhook] Error procesando orden:', err?.message ?? err);
    return res.status(500).json({ error: 'Error procesando pago' });
  }
}
