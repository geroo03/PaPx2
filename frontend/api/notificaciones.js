// API/notificaciones.js — Web Push con VAPID nativo
// Vercel Serverless Function

const webpush = require('web-push');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_CONTACT = process.env.VAPID_CONTACT;

if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_CONTACT) {
  console.error('[notificaciones] FATAL: VAPID_PUBLIC, VAPID_PRIVATE y VAPID_CONTACT son requeridas.');
}

if (VAPID_PUBLIC && VAPID_PRIVATE && VAPID_CONTACT) {
  webpush.setVapidDetails(VAPID_CONTACT, VAPID_PUBLIC, VAPID_PRIVATE);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_CONTACT) {
    return res.status(500).json({ error: 'Configuración VAPID incompleta en el servidor.' });
  }

  if (req.method === 'GET' && req.query.vapidPublic) {
    return res.json({ publicKey: VAPID_PUBLIC });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { subscription, title, body, icon } = req.body;

  if (!subscription) return res.status(400).json({ error: 'Falta subscription' });

  try {
    await webpush.sendNotification(subscription, JSON.stringify({
      title: title || '🔔 Puerta a Puerta',
      body: body || 'Tenés una notificación nueva',
      icon: icon || '/icons/icon-192.png'
    }));
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error enviando notificación:', err);
    return res.status(500).json({ error: err.message });
  }
};
