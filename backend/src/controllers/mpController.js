import crypto from 'node:crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { supabaseAdmin } from '../lib/supabaseClient.js';

const mpClient     = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const mpPreference = new Preference(mpClient);
const mpPayment    = new Payment(mpClient);

const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8000';
const SERVER_URL   = process.env.SERVER_URL   ?? 'http://localhost:3000';


/**
 * POST /api/mp/crear-preferencia
 * Body: { items, total, comercio_id, cliente_id, direccion_entrega, metodo_pago, propina_cadete? }
 */
export async function crearPreferencia(req, res) {
  const { pedido_id, items, total, comercio_id, cliente_id, direccion_entrega, metodo_pago, propina_cadete } = req.body ?? {};

  if (!Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({ error: 'Campos requeridos: items (array), total (number)' });
  }

  const propinaNum = Math.max(0, Math.floor(Number(propina_cadete ?? 0)));
  if (propinaNum > 10000) {
    return res.status(400).json({ error: 'La propina no puede superar $10.000' });
  }

  try {
    const mpItems = [
      ...items.map(item => ({
        id:          String(item.id || item.nombre),
        title:       String(item.nombre),
        quantity:    Number(item.qty ?? item.quantity ?? 1),
        unit_price:  Number(item.precio ?? item.unit_price ?? 0),
        currency_id: 'ARS',
      })),
      ...(propinaNum > 0 ? [{
        id:          'propina-cadete',
        title:       'Propina al repartidor',
        quantity:    1,
        unit_price:  propinaNum,
        currency_id: 'ARS',
      }] : []),
    ];

    // Guardar datos del pedido en external_reference como JSON
    const refData = {
      comercio_id:      comercio_id || null,
      cliente_id:       cliente_id || req.user.id,
      productos:        items,
      total:            Number(total),
      direccion_entrega: direccion_entrega || '',
      propina_cadete:   propinaNum,
      metodo_pago:      'mercadopago',
      pedido_id:        pedido_id || null,
    };
    const externalRef = Buffer.from(JSON.stringify(refData)).toString('base64url');

    const result = await mpPreference.create({
      body: {
        items: mpItems,
        external_reference: externalRef,
        back_urls: {
          success: `${FRONTEND_URL}/cliente/pago.html?estado=success`,
          failure: `${FRONTEND_URL}/cliente/pago.html?estado=failure`,
          pending: `${FRONTEND_URL}/cliente/pago.html?estado=pending`,
        },
        auto_return:          'approved',
        notification_url:     `${SERVER_URL}/api/mp/webhook`,
        statement_descriptor: 'Puerta a Puerta X',
      },
    });

    return res.json({
      init_point:         result.init_point,
      sandbox_init_point: result.sandbox_init_point,
      preference_id:      result.id,
    });
  } catch (err) {
    console.error('[MP] Error creando preferencia:', err?.message ?? err);
    return res.status(500).json({ error: 'No se pudo crear la preferencia de pago' });
  }
}


/**
 * POST /api/mp/webhook
 * Recibe notificaciones de MP. Verifica HMAC. Crea el pedido si el pago fue aprobado.
 */
export async function mpWebhook(req, res) {
  const xSignature = req.headers['x-signature']  ?? '';
  const xRequestId = req.headers['x-request-id'] ?? '';
  const notifId    = req.query.id                ?? '';

  const sigParts = Object.fromEntries(
    xSignature.split(',').map(part => {
      const idx = part.indexOf('=');
      return [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
    })
  );
  const ts = sigParts['ts'];
  const v1 = sigParts['v1'];

  if (!ts || !v1) {
    return res.status(401).json({ error: 'Firma invalida' });
  }

  const manifest = `id:${notifId};request-id:${xRequestId};ts:${ts};`;
  const expected  = crypto
    .createHmac('sha256', process.env.MP_WEBHOOK_SECRET)
    .update(manifest)
    .digest('hex');

  let firmaValida = false;
  try {
    const bufExp = Buffer.from(expected, 'hex');
    const bufRec = Buffer.from(v1, 'hex');
    firmaValida  = bufExp.length > 0 &&
                   bufExp.length === bufRec.length &&
                   crypto.timingSafeEqual(bufExp, bufRec);
  } catch { firmaValida = false; }

  if (!firmaValida) {
    return res.status(401).json({ error: 'Firma HMAC invalida' });
  }

  const { type, data } = req.body ?? {};
  if (type !== 'payment' || !data?.id) return res.sendStatus(200);

  let paymentData;
  try {
    paymentData = await mpPayment.get({ id: String(data.id) });
  } catch (err) {
    console.error('[Webhook] Error consultando pago MP:', err?.message ?? err);
    return res.status(500).json({ error: 'Error consultando pago' });
  }

  const { status, external_reference } = paymentData;
  console.log(`[Webhook] payment:${data.id} | status:${status}`);

  if (!external_reference) return res.sendStatus(200);

  if (status === 'approved') {
    try {
      const refData = JSON.parse(Buffer.from(external_reference, 'base64url').toString());

      // Si ya existe un pedido_id, solo actualizar estado
      if (refData.pedido_id) {
        await supabaseAdmin.from('pedidos')
          .update({ estado: 'nuevo', estado_pago: 'aprobado', mp_payment_id: String(data.id) })
          .eq('id', refData.pedido_id);
        console.log(`[Webhook] Pedido ${refData.pedido_id} → pagado`);
      } else {
        // Crear el pedido ahora que el pago fue confirmado
        const { data: nuevoPedido, error: insertErr } = await supabaseAdmin
          .from('pedidos')
          .insert({
            comercio_id:      refData.comercio_id,
            cliente_id:       refData.cliente_id,
            productos:        refData.productos,
            total:            refData.total,
            direccion_entrega: refData.direccion_entrega,
            propina_cadete:   refData.propina_cadete || 0,
            metodo_pago:      'mercadopago',
            estado:           'nuevo',
            estado_pago:      'aprobado',
            mp_payment_id:    String(data.id),
          })
          .select('id, numero')
          .single();

        if (insertErr) {
          console.error('[Webhook] Error creando pedido:', insertErr.message);
          return res.status(500).json({ error: 'Error creando pedido' });
        }
        console.log(`[Webhook] Pedido creado: #${nuevoPedido.numero} (${nuevoPedido.id})`);
      }
    } catch (err) {
      console.error('[Webhook] Error procesando external_reference:', err?.message);
      return res.status(500).json({ error: 'Error procesando pago' });
    }
  }

  return res.sendStatus(200);
}
