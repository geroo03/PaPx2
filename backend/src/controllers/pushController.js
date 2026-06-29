import webpush from 'web-push';
import { supabaseAdmin } from '../lib/supabaseClient.js';

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:puertaapuertax@gmail.com';

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);
}

async function enviarPushAUsuario(userId, payload) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return;

  const { data: tokens } = await supabaseAdmin
    .from('fcm_tokens')
    .select('id, token')
    .eq('user_id', userId);

  if (!tokens?.length) return;

  const body = JSON.stringify(payload);

  for (const t of tokens) {
    try {
      const sub = JSON.parse(t.token);
      await webpush.sendNotification(sub, body);
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabaseAdmin.from('fcm_tokens').delete().eq('id', t.id);
      }
    }
  }
}

export async function notificarCadeteNuevoViaje(cadeteId, comercioNombre) {
  await enviarPushAUsuario(cadeteId, {
    title: 'Nuevo viaje disponible',
    body: `${comercioNombre} tiene un pedido para vos`,
    rol: 'cadete',
    tag: 'nuevo-viaje',
  });
}

export async function notificarClienteEstado(clienteId, estado, comercioNombre) {
  const mensajes = {
    preparando:      { title: 'Pedido aceptado', body: `${comercioNombre} esta preparando tu pedido` },
    en_preparacion:  { title: 'Pedido aceptado', body: `${comercioNombre} esta preparando tu pedido` },
    en_camino:       { title: 'Cadete en camino', body: 'Tu pedido ya salio y esta en camino' },
    entregado:       { title: 'Pedido entregado', body: 'Tu pedido fue entregado con exito' },
  };
  const msg = mensajes[estado];
  if (!msg) return;
  await enviarPushAUsuario(clienteId, { ...msg, rol: 'cliente', tag: 'estado-' + estado });
}

export async function notificarComercioNuevoPedido(comercioUserId, numeroPedido) {
  await enviarPushAUsuario(comercioUserId, {
    title: 'Nuevo pedido',
    body: `Pedido #${numeroPedido} recibido — revisalo en tu panel`,
    rol: 'comercio',
    tag: 'nuevo-pedido',
  });
}
