export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body || {};
    const { items, total, pedido_id, comercio, comercio_mp_token, comercio_mp_user_id, costo_envio } = body;

    // Calcular el split
    const subtotal = parseFloat(total) || 1000;
    const envio = parseFloat(costo_envio) || 800;
    const comision_pap = Math.round(subtotal * 0.12); // 12% para Puerta a Puerta
    const ganancia_envio = Math.round(envio * 0.25); // 25% del envío para Puerta a Puerta
    const marketplace_fee = comision_pap + ganancia_envio;

    // Construir items
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
        unit_price: subtotal,
        currency_id: 'ARS'
      }];
    }

    // Agregar costo de envío como item
    if (envio > 0) {
      mpItems.push({
        title: 'Costo de envío',
        quantity: 1,
        unit_price: envio,
        currency_id: 'ARS'
      });
    }

    const preference = {
      items: mpItems,
      marketplace_fee: marketplace_fee, // Lo que se queda Puerta a Puerta
      back_urls: {
        success: 'https://puertaapuerta.vercel.app/pago.html?status=approved',
        failure: 'https://puertaapuerta.vercel.app/pago.html?status=failure',
        pending: 'https://puertaapuerta.vercel.app/pago.html?status=pending',
      },
      auto_return: 'approved',
      statement_descriptor: 'PUERTA A PUERTA',
      external_reference: String(pedido_id || Date.now()),
    };

    // Usar el token del comercio si está disponible, sino usar el de Puerta a Puerta
    const accessToken = comercio_mp_token || process.env.MP_ACCESS_TOKEN;

    const resp = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(preference)
    });

    const data = await resp.json();
    if (!resp.ok) return res.status(500).json({ error: data.message || 'Error MP', detail: data });

    return res.status(200).json({
      id: data.id,
      init_point: data.init_point,
      marketplace_fee,
      comision_pap,
      ganancia_envio
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
