// API/notificar-pedido.js — Notifica al comercio cuando llega un pedido nuevo
const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BMOSombn5870MeH1ufWwYLEosTFqcDPuD5t-GtpWzQ33C8gEP0D9TC6IXvauq0qxDK13pUmtU0g8m-h25brELSM';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || 'Ku_iBASeFbbHqNH_iJGJtIgU3Qx6_UaM5cgjLvTlFt4';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://fmqlpgerqdiplnvjjarl.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

webpush.setVapidDetails(
  'mailto:gerardoacostafrancario@gmail.com',
  VAPID_PUBLIC,
  VAPID_PRIVATE
);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { record } = req.body;
    if (!record) return res.status(400).json({ error: 'Falta record' });

    const comercioId = record.comercio_id;
    const numeroPedido = record.numero || '—';
    const total = record.total || 0;

    // Buscar el usuario_id del comercio
    const comercioRes = await fetch(`${SUPABASE_URL}/rest/v1/comercios?id=eq.${comercioId}&select=usuario_id,nombre`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const comercios = await comercioRes.json();
    if (!comercios.length) return res.status(404).json({ error: 'Comercio no encontrado' });

    const usuarioId = comercios[0].usuario_id;
    const nombreComercio = comercios[0].nombre;

    // Buscar la suscripción push del comercio
    const tokenRes = await fetch(`${SUPABASE_URL}/rest/v1/fcm_tokens?user_id=eq.${usuarioId}&rol=eq.comercio&select=token`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const tokens = await tokenRes.json();
    if (!tokens.length) return res.status(404).json({ error: 'No hay suscripción push para este comercio' });

    const subscription = JSON.parse(tokens[0].token);

    // Enviar notificación push
    await webpush.sendNotification(subscription, JSON.stringify({
      title: '🛵 ¡Nuevo pedido!',
      body: `Pedido #${numeroPedido} — $${Number(total).toLocaleString('es-AR')}`,
      icon: '/icons/icon-192.png'
    }));

    console.log(`✅ Notificación enviada al comercio ${nombreComercio}`);
    return res.json({ ok: true });

  } catch (err) {
    console.error('Error enviando notificación:', err);
    return res.status(500).json({ error: err.message });
  }
};
