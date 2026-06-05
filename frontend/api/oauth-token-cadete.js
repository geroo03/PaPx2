export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Código requerido' });

    const resp = await fetch('https://api.mercadopago.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_secret: process.env.MP_CLIENT_SECRET, // Usar variable de entorno
        client_id: process.env.MP_CLIENT_ID, // Usar variable de entorno
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: 'https://puertaapuerta.vercel.app/oauth-callback-cadete.html'
      })
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Error OAuth' });

    return res.status(200).json({
      access_token: data.access_token,
      user_id: data.user_id
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
