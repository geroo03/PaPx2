export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { items, total, pedido_id, comercio } = body;

    let mpItems = [];
    if (items && Array.isArray(items) && items.length > 0) {
      mpItems = items
        .filter(i => (i.nombre || i.title) && parseFloat(i.precio || i.unit_price || 0) > 0)
        .map(i => ({
          title: String(i.nombre || i.title || 'Producto').slice(0, 256),
          quantity: Math.max(1, parseInt(i.qty || i.quantity || 1)),
          unit_price: parseFloat(i.precio || i.unit_price || 0),
          currency_id: 'ARS'
        }));
    }

    if (mpItems.length === 0) {
      mpItems = [{
        title: `Pedido ${comercio || 'Puerta a Puerta'}`,
        quantity: 1,
        unit_price: parseFloat(total) || 1000,
        currency_id: 'ARS'
      }];
    }

    const preference = {
      items: mpItems,
      back_urls: {
        success: 'https://puertaapuerta.vercel.app/pago.html?status=approved',
        failure: 'https://puertaapuerta.vercel.app/pago.html?status=failure',
        pending: 'https://puertaapuerta.vercel.app/pago.html?status=pending',
      },
      auto_return: 'approved',
      statement_descriptor: 'PUERTA A PUERTA',
      external_reference: String(pedido_id || Date.now()),
    };

    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
      },
      body: JSON.stringify(preference)
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Error MP', detail: data });
    return res.status(200).json({ id: data.id, init_point: data.init_point });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
