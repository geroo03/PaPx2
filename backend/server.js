'use strict';
require('dotenv').config();

const express          = require('express');
const cors             = require('cors');
const crypto           = require('crypto');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const { createClient } = require('@supabase/supabase-js');

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE ENTORNO
// ═══════════════════════════════════════════════════════════════════════════════
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MP_ACCESS_TOKEN',
  'MP_WEBHOOK_SECRET',
  'FRONTEND_URL',
  'SERVER_URL',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`[FATAL] Falta la variable de entorno: ${key}`);
    process.exit(1);
  }
}

const PORT         = process.env.PORT        || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL;  // ej: https://tuapp.vercel.app
const SERVER_URL   = process.env.SERVER_URL;    // ej: https://api.tuapp.com

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTES
// ═══════════════════════════════════════════════════════════════════════════════

// Supabase con service_role → bypass total de RLS para operaciones de servidor
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// MercadoPago SDK v2
const mpClient     = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const mpPreference = new Preference(mpClient);
const mpPayment    = new Payment(mpClient);

// ═══════════════════════════════════════════════════════════════════════════════
// EXPRESS + MIDDLEWARES
// ═══════════════════════════════════════════════════════════════════════════════
const app = express();

app.use(cors({
  origin:         FRONTEND_URL,
  methods:        ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// ═══════════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fórmula de Haversine: distancia en KM entre dos coordenadas GPS.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ganancia estimada del cadete en ARS.
 * Base $600 + $250 por km, redondeado a $50.
 */
function calcularGanancia(distanciaKm) {
  return Math.round((600 + distanciaKm * 250) / 50) * 50;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE: requireAuth
// Lee "Authorization: Bearer <jwt>" y valida contra Supabase Auth.
// Adjunta req.user para los endpoints protegidos.
// ═══════════════════════════════════════════════════════════════════════════════
async function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token de autenticación requerido' });
  }
  const { data: { user }, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !user) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
  req.user = user;
  next();
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTENTICACIÓN Y ROLES
// POST /api/auth/login
//
// Valida credenciales en Supabase Auth. Devuelve el JWT + rol sin loops:
// el rol viaja en la respuesta y el frontend redirige en el mismo request.
// Estrategia de resolución de rol (en orden):
//   1. user_metadata.role     (seteado por admin en Supabase Dashboard)
//   2. tabla 'perfiles'.rol   (si el proyecto la usa como fuente de verdad)
//   3. 'cliente'              (default de último recurso)
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('invalid') || msg.includes('credentials')) {
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    if (msg.includes('email not confirmed')) {
      return res.status(403).json({ error: 'Confirmá tu email antes de ingresar' });
    }
    return res.status(401).json({ error: error.message });
  }

  const { user, session } = data;

  let rol = user.user_metadata?.role ?? user.raw_user_meta_data?.role ?? null;

  if (!rol) {
    try {
      const { data: perfil } = await supabase
        .from('profiles')
        .select('rol')
        .eq('id', user.id)
        .maybeSingle();
      rol = perfil?.rol ?? 'cliente';
    } catch {
      rol = 'cliente';
    }
  }

  return res.json({
    token:         session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at,
    user: { id: user.id, email: user.email, rol },
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PASARELA DE PAGOS — MercadoPago
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/mp/crear-preferencia
// Crea la preferencia de pago en MP con pedido_id como external_reference.
// El webhook usa esa referencia para identificar qué pedido actualizar.
app.post('/api/mp/crear-preferencia', async (req, res) => {
  const { pedido_id, items, total } = req.body ?? {};

  if (!pedido_id || !Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({
      error: 'Campos requeridos: pedido_id (UUID), items (array), total (number)',
    });
  }

  try {
    const result = await mpPreference.create({
      body: {
        items: items.map(item => ({
          id:          String(item.id || item.nombre),
          title:       String(item.nombre),
          quantity:    Number(item.qty ?? item.quantity ?? 1),
          unit_price:  Number(item.precio ?? item.unit_price ?? 0),
          currency_id: 'ARS',
        })),
        external_reference: pedido_id,
        back_urls: {
          success: `${FRONTEND_URL}/cliente/pago-resultado.html?estado=success&pedido=${pedido_id}`,
          failure: `${FRONTEND_URL}/cliente/pago-resultado.html?estado=failure&pedido=${pedido_id}`,
          pending: `${FRONTEND_URL}/cliente/pago-resultado.html?estado=pending&pedido=${pedido_id}`,
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
});

// POST /api/mp/webhook
// Recibe notificaciones asíncronas de MercadoPago.
// 1. Verifica firma HMAC-SHA256 (header x-signature)
// 2. Consulta el pago a la API de MP → status + external_reference
// 3. Si approved → pedidos.estado = 'pagado' (service_role, bypass RLS)
// Retorna 500 en errores de Supabase para que MP reintente automáticamente.
app.post('/api/mp/webhook', async (req, res) => {
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
    const { error: dbError } = await supabase
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. LOGÍSTICA — MÁQUINA DE ESTADOS DE PEDIDOS
// POST /api/pedidos/cambiar-estado
//
// Endpoint central de logística. Maneja todas las transiciones de estado.
// Cuando nuevo_estado === 'en_preparacion' (comercio acepta el pedido):
//   → Busca cadetes activos (GPS reportado en los últimos 5 minutos)
//   → Calcula distancia Haversine entre cada cadete y el comercio
//   → Filtra los que están a ≤ 10 km
//   → Inserta registros en 'ofertas_cadetes'
//   → Supabase Realtime propaga el INSERT al panel del cadete en tiempo real
//
// Transiciones soportadas:
//   pagado          → en_preparacion  (comercio acepta y cocina)
//   en_preparacion  → cadete_asignado (cadete acepta oferta)
//   cadete_asignado → en_camino       (cadete retira en comercio)
//   en_camino       → entregado       (cadete entrega al cliente)
//   cualquier estado → cancelado
//
// Body: { pedido_id, nuevo_estado, cadete_id? }
// Requiere Bearer token (requireAuth).
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/pedidos/cambiar-estado', requireAuth, async (req, res) => {
  const { pedido_id, nuevo_estado, cadete_id } = req.body ?? {};

  if (!pedido_id || !nuevo_estado) {
    return res.status(400).json({ error: 'Campos requeridos: pedido_id, nuevo_estado' });
  }

  const ESTADOS_VALIDOS = [
    'en_preparacion', 'cadete_asignado', 'en_camino', 'entregado', 'cancelado',
  ];
  if (!ESTADOS_VALIDOS.includes(nuevo_estado)) {
    return res.status(400).json({
      error: `Estado inválido. Valores posibles: ${ESTADOS_VALIDOS.join(', ')}`,
    });
  }

  // Leer el pedido completo
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, estado, comercio_id, cliente_id, cadete_id, direccion_entrega')
    .eq('id', pedido_id)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // Actualizar el estado del pedido
  const updatePayload = { estado: nuevo_estado };
  if (nuevo_estado === 'cadete_asignado' && cadete_id) {
    updatePayload.cadete_id = cadete_id;
  }

  const { error: updateErr } = await supabase
    .from('pedidos')
    .update(updatePayload)
    .eq('id', pedido_id);

  if (updateErr) {
    console.error('[cambiar-estado] Error:', updateErr.message);
    return res.status(500).json({ error: 'No se pudo actualizar el estado del pedido' });
  }

  console.log(`[Pedido ${pedido_id}] ${pedido.estado} → ${nuevo_estado}`);

  // ── Lógica de asignación automática de cadetes ────────────────────────────
  if (nuevo_estado === 'en_preparacion') {
    try {
      // 1. Obtener coordenadas del comercio
      const { data: comercio } = await supabase
        .from('comercios')
        .select('nombre, direccion, lat, lng')
        .eq('id', pedido.comercio_id)
        .single();

      if (!comercio?.lat || !comercio?.lng) {
        console.warn('[Asignación] Comercio sin coordenadas GPS — ofertas no generadas');
        return res.json({ ok: true, advertencia: 'Comercio sin GPS. Asigná cadete manualmente.' });
      }

      // 2. Buscar cadetes activos (GPS actualizado en los últimos 5 minutos)
      const cincoMinAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: cadetesActivos } = await supabase
        .from('ubicacion_cadetes')
        .select('cadete_id, lat, lng')
        .eq('activo', true)
        .gte('updated_at', cincoMinAtras);

      if (!cadetesActivos?.length) {
        console.warn('[Asignación] Sin cadetes activos en este momento');
        return res.json({ ok: true, advertencia: 'Sin cadetes disponibles ahora mismo' });
      }

      // 3. Calcular distancia, filtrar por radio y calcular ganancia
      const RADIO_MAX_KM = 10;
      const ofertas = cadetesActivos
        .map(cadete => {
          const distanciaKm = haversineKm(
            comercio.lat, comercio.lng,
            cadete.lat,   cadete.lng
          );
          return {
            cadete_id:           cadete.cadete_id,
            pedido_id,
            comercio_nombre:     comercio.nombre,
            comercio_direccion:  comercio.direccion ?? '',
            comercio_lat:        comercio.lat,
            comercio_lng:        comercio.lng,
            cliente_direccion:   pedido.direccion_entrega,
            distancia_km:        Math.round(distanciaKm * 10) / 10,
            ganancia_estimada:   calcularGanancia(distanciaKm),
            estado:              'pendiente',
          };
        })
        .filter(o => o.distancia_km <= RADIO_MAX_KM)
        .sort((a, b) => a.distancia_km - b.distancia_km); // más cercano primero

      if (!ofertas.length) {
        console.warn(`[Asignación] Ningún cadete dentro del radio de ${RADIO_MAX_KM} km`);
        return res.json({ ok: true, advertencia: `Sin cadetes en radio de ${RADIO_MAX_KM} km` });
      }

      // 4. Insertar ofertas en 'ofertas_cadetes'
      // Supabase Realtime propaga el INSERT al panel del cadete (cadete.html)
      const { error: ofertaErr } = await supabase
        .from('ofertas_cadetes')
        .insert(ofertas);

      if (ofertaErr) {
        console.error('[Asignación] Error insertando ofertas:', ofertaErr.message);
        // No es crítico: el pedido ya cambió de estado
      } else {
        console.log(`[Asignación] ${ofertas.length} oferta(s) enviadas para pedido ${pedido_id}`);
      }

      return res.json({
        ok:                  true,
        cadetes_notificados: ofertas.length,
        ofertas_resumen:     ofertas.map(o => ({
          cadete_id:         o.cadete_id,
          distancia_km:      o.distancia_km,
          ganancia_estimada: o.ganancia_estimada,
        })),
      });

    } catch (err) {
      console.error('[Asignación] Excepción:', err?.message ?? err);
      return res.json({ ok: true, advertencia: 'Error en asignación automática de cadetes' });
    }
  }

  // ── Cadete acepta la oferta → rechazar las otras del mismo pedido ─────────
  if (nuevo_estado === 'cadete_asignado' && cadete_id) {
    try {
      await supabase
        .from('ofertas_cadetes')
        .update({ estado: 'aceptada' })
        .eq('pedido_id', pedido_id)
        .eq('cadete_id', cadete_id);

      await supabase
        .from('ofertas_cadetes')
        .update({ estado: 'rechazada' })
        .eq('pedido_id', pedido_id)
        .neq('cadete_id', cadete_id);

      console.log(`[Pedido ${pedido_id}] Cadete ${cadete_id} asignado — otras ofertas rechazadas`);
    } catch (err) {
      console.error('[cadete_asignado] Error gestionando ofertas:', err?.message ?? err);
    }
  }

  return res.json({ ok: true, nuevo_estado });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GPS Y TRACKING EN TIEMPO REAL
// POST /api/cadete/actualizar-ubicacion
//
// El app del cadete llama este endpoint periódicamente (cada 5-10 seg)
// para reportar su posición. Hace UPSERT en 'ubicacion_cadetes'.
// Supabase Realtime propaga el cambio al mapa del cliente sin WebSockets propios.
//
// Si se incluye 'accion' en el body, también cambia el estado del pedido:
//   accion: 'aceptar_viaje'  → pedido pasa a 'cadete_asignado'
//   accion: 'retirar_pedido' → pedido pasa a 'en_camino'
//
// Body: { lat, lng, pedido_id?, accion? }
// Requiere Bearer token del cadete (requireAuth).
//
// Tabla requerida:
//   CREATE TABLE ubicacion_cadetes (
//     cadete_id  UUID PRIMARY KEY REFERENCES auth.users(id),
//     pedido_id  UUID REFERENCES pedidos(id),
//     lat        FLOAT8 NOT NULL,
//     lng        FLOAT8 NOT NULL,
//     activo     BOOLEAN NOT NULL DEFAULT true,
//     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
//   );
//   ALTER TABLE ubicacion_cadetes ENABLE ROW LEVEL SECURITY;
//   CREATE POLICY "clientes leen su cadete" ON ubicacion_cadetes FOR SELECT
//     USING (pedido_id IN (SELECT id FROM pedidos WHERE cliente_id = auth.uid()));
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/cadete/actualizar-ubicacion', requireAuth, async (req, res) => {
  const { pedido_id, lat, lng, accion } = req.body ?? {};
  const cadeteId = req.user.id;

  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'lat y lng son requeridos' });
  }

  const latNum = Number(lat);
  const lngNum = Number(lng);
  if (
    isNaN(latNum) || isNaN(lngNum) ||
    latNum < -90 || latNum > 90 ||
    lngNum < -180 || lngNum > 180
  ) {
    return res.status(400).json({ error: 'Coordenadas fuera de rango válido' });
  }

  const rol = req.user.user_metadata?.role ?? req.user.raw_user_meta_data?.role ?? null;
  if (rol !== 'cadete') {
    return res.status(403).json({ error: 'Solo cadetes pueden actualizar su ubicación' });
  }

  // UPSERT en la tabla de tracking
  const upsertData = {
    cadete_id:  cadeteId,
    lat:        latNum,
    lng:        lngNum,
    activo:     true,
    updated_at: new Date().toISOString(),
    ...(pedido_id && { pedido_id }),
  };

  const { error: upsertErr } = await supabase
    .from('ubicacion_cadetes')
    .upsert(upsertData, { onConflict: 'cadete_id' });

  if (upsertErr) {
    console.error('[GPS] Error guardando ubicación:', upsertErr.message);
    return res.status(500).json({ error: 'Error guardando ubicación GPS' });
  }

  // Procesar transiciones de estado opcionales
  if (pedido_id && accion) {
    const MAPA_ACCION = {
      aceptar_viaje:  'cadete_asignado',
      retirar_pedido: 'en_camino',
    };
    const nuevoEstado = MAPA_ACCION[accion];

    if (nuevoEstado) {
      const payload = { estado: nuevoEstado };
      if (accion === 'aceptar_viaje') payload.cadete_id = cadeteId;

      const { error: stateErr } = await supabase
        .from('pedidos')
        .update(payload)
        .eq('id', pedido_id);

      if (stateErr) {
        console.error(`[GPS→Estado] Error cambiando a ${nuevoEstado}:`, stateErr.message);
        return res.json({ ok: true, gps: 'actualizado', advertencia: stateErr.message });
      }

      // Cerrar ofertas al aceptar el viaje
      if (accion === 'aceptar_viaje') {
        await supabase.from('ofertas_cadetes').update({ estado: 'aceptada' })
          .eq('pedido_id', pedido_id).eq('cadete_id', cadeteId);
        await supabase.from('ofertas_cadetes').update({ estado: 'rechazada' })
          .eq('pedido_id', pedido_id).neq('cadete_id', cadeteId);
      }

      console.log(`[GPS] cadete:${cadeteId} | accion:${accion} | pedido ${pedido_id} → ${nuevoEstado}`);
      return res.json({ ok: true, gps: 'actualizado', estado: nuevoEstado });
    }
  }

  return res.json({ ok: true, gps: 'actualizado' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. CIERRE Y VALORACIÓN
// POST /api/pedidos/valorar
//
// Cuando el cadete entrega el pedido, el cliente puede valorar al comercio
// y/o al cadete con estrellas (1–5) y comentario opcional.
// Cada valoración se inserta en su tabla independiente.
//
// Body: { pedido_id, tipo: "comercio"|"cadete", estrellas: 1-5, comentario? }
// Requiere Bearer token del cliente (requireAuth).
//
// Tablas requeridas:
//   CREATE TABLE ratings (
//     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     pedido_id   UUID REFERENCES pedidos(id),
//     comercio_id UUID REFERENCES comercios(id),
//     cliente_id  UUID REFERENCES auth.users(id),
//     rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
//     comentario  TEXT,
//     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
//     UNIQUE (pedido_id, cliente_id)
//   );
//
//   CREATE TABLE resenas (
//     id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//     pedido_id   UUID REFERENCES pedidos(id),
//     cadete_id   UUID REFERENCES auth.users(id),
//     cliente_id  UUID REFERENCES auth.users(id),
//     rating      SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
//     comentario  TEXT,
//     created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
//     UNIQUE (pedido_id, cliente_id)
//   );
// ═══════════════════════════════════════════════════════════════════════════════
app.post('/api/pedidos/valorar', requireAuth, async (req, res) => {
  const { pedido_id, tipo, estrellas, comentario } = req.body ?? {};
  const clienteId = req.user.id;

  if (!pedido_id || !tipo || estrellas == null) {
    return res.status(400).json({ error: 'Campos requeridos: pedido_id, tipo, estrellas' });
  }
  if (!['comercio', 'cadete'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo debe ser "comercio" o "cadete"' });
  }
  const estrellasNum = Number(estrellas);
  if (!Number.isInteger(estrellasNum) || estrellasNum < 1 || estrellasNum > 5) {
    return res.status(400).json({ error: 'estrellas debe ser un entero entre 1 y 5' });
  }

  // Leer el pedido para obtener IDs de comercio y cadete
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, estado, comercio_id, cadete_id, cliente_id')
    .eq('id', pedido_id)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // Verificar que el pedido pertenece al cliente autenticado
  if (pedido.cliente_id !== clienteId) {
    return res.status(403).json({ error: 'No podés valorar un pedido que no es tuyo' });
  }

  try {
    if (tipo === 'comercio') {
      if (!pedido.comercio_id) {
        return res.status(400).json({ error: 'El pedido no tiene comercio asignado' });
      }

      const { error } = await supabase
        .from('ratings')
        .insert({
          pedido_id,
          comercio_id: pedido.comercio_id,
          cliente_id:  clienteId,
          rating:      estrellasNum,   // columna real: 'rating' (no 'estrellas')
          comentario:  comentario?.trim() ?? null,
        });

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Ya valoraste este comercio para este pedido' });
        }
        throw error;
      }

      console.log(`[Valoración] Comercio ${pedido.comercio_id} | ${estrellasNum}★ | pedido ${pedido_id}`);

    } else {
      if (!pedido.cadete_id) {
        return res.status(400).json({ error: 'El pedido no tiene cadete asignado' });
      }

      const { error } = await supabase
        .from('resenas')
        .insert({
          pedido_id,
          cadete_id:  pedido.cadete_id,
          cliente_id: clienteId,
          rating:     estrellasNum,    // columna real: 'rating' (no 'estrellas')
          comentario: comentario?.trim() ?? null,
        });

      if (error) {
        if (error.code === '23505') {
          return res.status(409).json({ error: 'Ya valoraste al cadete para este pedido' });
        }
        throw error;
      }

      console.log(`[Valoración] Cadete ${pedido.cadete_id} | ${estrellasNum}★ | pedido ${pedido_id}`);
    }

    // Marcar pedido como entregado si todavía no lo está
    if (pedido.estado !== 'entregado') {
      await supabase
        .from('pedidos')
        .update({ estado: 'entregado' })
        .eq('id', pedido_id);
    }

    return res.json({ ok: true, tipo, estrellas: estrellasNum });

  } catch (err) {
    console.error('[Valoración] Error:', err?.message ?? err);
    return res.status(500).json({ error: 'Error guardando la valoración' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'puerta-a-puerta-api', ts: new Date().toISOString() });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ARRANQUE DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║  Puerta a Puerta — API de Logística         ║');
  console.log(`║  Puerto: ${PORT}                               ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  POST /api/auth/login                        ║');
  console.log('║  POST /api/mp/crear-preferencia              ║');
  console.log('║  POST /api/mp/webhook                        ║');
  console.log('║  POST /api/pedidos/cambiar-estado  [auth]    ║');
  console.log('║  POST /api/cadete/actualizar-ubicacion [auth]║');
  console.log('║  POST /api/pedidos/valorar         [auth]    ║');
  console.log('║  GET  /health                                ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
