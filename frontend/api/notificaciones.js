// API/notificaciones.js — Web Push con VAPID nativo
// Vercel Serverless Function

const webpush = require('web-push');

const VAPID_PUBLIC = process.env.VAPID_PUBLIC || 'BMOSombn5870MeH1ufWwYLEosTFqcDPuD5t-GtpWzQ33C8gEP0D9TC6IXvauq0qxDK13pUmtU0g8m-h25brELSM';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE; // Debes poner esto en tu config de Vercel

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
