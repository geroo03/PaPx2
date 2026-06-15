import crypto from 'node:crypto';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { supabaseAdmin } from '../lib/supabaseClient.js';

const mpClient     = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const mpPreference = new Preference(mpClient);
const mpPayment    = new Payment(mpClient);

const FRONTEND_URL = process.env.FRONTEND_URL?.split(',')[0]?.trim() ?? '';
const SERVER_URL   = process.env.SERVER_URL ?? '';

/**
 * POST /api/mp/crear-preferencia
 *
 * Crea la preferencia de pago en MercadoPago.
 * Verifica que el pedido exista y pertenezca al usuario autenticado.
 * Propina máxima: $10.000.
 *
 * Body: { pedido_id, items: [{ nombre, precio, qty }], total, propina_cadete? }
 */
export async function crearPreferencia(req, res) {
  const { pedido_id, items, total, propina_cadete } = req.body ?? {};

  if (!pedido_id || !Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({
      error: 'Campos requeridos: pedido_id (UUID), items (array), total (number)',
    });
  }

  const propinaNum = Math.max(0, Math.floor(Number(propina_cadete ?? 0)));
  if (propinaNum > 10000) {
    return res.status(400).json({ error: 'La propina no puede superar $10.000' });
  }

  const { data: pedido, error: pedidoErr } = await supabaseAdmin
    .from('pedidos')
    .select('id, cliente_id, estado')
    .eq('id', pedido_id)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  if (pedido.cliente_id !== req.user.id) {
    return res.status(403).json({ error: 'Este pedido no te pertenece' });
  }

  const ESTADOS_PAGABLES = ['nuevo', 'pendiente'];
  if (!ESTADOS_PAGABLES.includes(pedido.estado)) {
    return res.status(409).json({
      error: `El pedido está en estado '${pedido.estado}' y no puede pagarse`,
    });
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

    if (propinaNum > 0) {
      await supabaseAdmin.from('pedidos')
        .update({ propina_cadete: propinaNum })
        .eq('id', pedido_id);
    }

    const result = await mpPreference.create({
      body: {
        items: mpItems,
        external_reference: pedido_id,
        back_urls: {
          success: `${FRONTEND_URL}/cliente/pago.html?estado=success&pedido=${pedido_id}`,
          failure: `${FRONTEND_URL}/cliente/pago.html?estado=failure&pedido=${pedido_id}`,
          pending: `${FRONTEND_URL}/cliente/pago.html?estado=pending&pedido=${pedido_id}`,
        },
        auto_return:          'approved',
        notification_url:     `${SERVER_URL}/api/mp/webhook`,
        statement_descriptor: 'Puerta a Puerta',
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
 *
 * Recibe notificaciones asíncronas de MercadoPago.
 * Verifica firma HMAC-SHA256 antes de procesar.
 * Retorna 500 en error de DB para que MP reintente automáticamente.
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
    return res.status(401).json({ error: 'Firma inválida' });
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
    return res.status(401).json({ error: 'Firma HMAC inválida' });
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

  const { status, external_reference: pedidoId } = paymentData;
  console.log(`[Webhook] payment:${data.id} | status:${status} | pedido:${pedidoId ?? '—'}`);

  if (!pedidoId) return res.sendStatus(200);

  if (status === 'approved') {
    const { error: dbError } = await supabaseAdmin
      .from('pedidos')
      .update({ estado: 'pagado' })
      .eq('id', pedidoId);

    if (dbError) {
      console.error('[Webhook→Supabase] Error:', dbError.message);
      return res.status(500).json({ error: 'Error actualizando pedido' });
    }
    console.log(`[Supabase] Pedido ${pedidoId} → pagado`);
  }

  return res.sendStatus(200);
}
