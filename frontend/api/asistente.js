export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { messages, rol } = req.body;
  if (!messages || !Array.isArray(messages)) return res.status(400).json({ error: 'Mensajes requeridos' });

  const systemPrompts = {
    usuario: `Sos el asistente virtual de Puerta a Puerta, una app de delivery local de La Banda y Santiago del Estero, Argentina. Ayudás a usuarios con sus dudas sobre pedidos, pagos y entregas. Respondé siempre en español rioplatense, de forma clara, amigable y concisa. Sobre la app: los usuarios pueden pedir delivery de restaurantes, farmacias, supermercados, panaderías y más. Se puede pagar con MercadoPago, efectivo o transferencia. Si hay un problema con un pedido el usuario puede reportarlo y chatear con el comercio. El comercio tiene 10 minutos para resolver. Si no se resuelve, el pedido se anula y el usuario recibe el reembolso. No inventes información que no sabés.`,
    comercio: `Sos el asistente virtual de Puerta a Puerta para comercios. Ayudás a los dueños de comercios con dudas sobre cómo gestionar pedidos, configurar su perfil, conectar MercadoPago, manejar reportes y usar el panel. Respondé en español rioplatense, de forma clara y concisa.`,
    cadete: `Sos el asistente virtual de Puerta a Puerta para cadetes. Ayudás a los cadetes con dudas sobre cómo recibir y entregar pedidos, cobrar, usar la app y resolver problemas con entregas. Respondé en español rioplatense, de forma clara y concisa.`,
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1000,
        system: systemPrompts[rol] || systemPrompts.usuario,
        messages,
      }),
    });

    const data = await response.json();
    const texto = data.content?.[0]?.text || 'Lo siento, no pude procesar tu consulta.';
    res.status(200).json({ respuesta: texto });
  } catch (error) {
    res.status(500).json({ error: 'Error al conectar con el asistente' });
  }
}
