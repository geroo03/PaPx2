// API/notificar-pedido.js — Notifica al comercio cuando llega un pedido nuevo
const webpush = require('web-push');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_CONTACT = process.env.VAPID_CONTACT;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_KEY;

if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_CONTACT) {
  console.error('[notificar-pedido] FATAL: VAPID_PUBLIC, VAPID_PRIVATE y VAPID_CONTACT son requeridas.');
  // No lanzamos process.exit porque es una serverless function —
  // el error se propaga al handler para devolver 500 al caller.
}

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[notificar-pedido] FATAL: SUPABASE_URL y SUPABASE_KEY son requeridas.');
}

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_CONTACT) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_CONTACT || !SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Configuración de notificaciones incompleta en el servidor.' });
  }

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
