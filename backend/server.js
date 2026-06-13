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
// UTILIDAD: resolveRol
// Resuelve el rol del usuario autenticado consultando la tabla 'perfiles'
// (fuente de verdad del lado del servidor). Cae en user_metadata solo como
// último recurso, ya que esa metadata puede ser manipulada via Auth API.
// ═══════════════════════════════════════════════════════════════════════════════
async function resolveRol(userId, userMetadata = {}) {
  try {
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('rol')
      .eq('id', userId)
      .maybeSingle();
    if (perfil?.rol) return perfil.rol;
  } catch { /* fallback */ }
  return userMetadata?.role ?? userMetadata?.raw_user_meta_data?.role ?? null;
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
// 1b. ASIGNACIÓN DE ROL DESDE EL CLIENTE
// POST /api/auth/set-role
//
// Permite a un usuario recién registrado solicitar un rol específico.
// Roles permitidos desde este endpoint: 'comercio' | 'cadete'
// El rol 'admin' solo se asigna desde el Supabase Dashboard o un trigger SQL.
//
// Flujo:
//   1. Frontend llama a supabase.auth.signUp() → usuario creado sin rol (o con
//      rol 'usuario' si existe el trigger handle_new_user en la DB).
//   2. Si el usuario necesita rol 'comercio' o 'cadete', llama a este endpoint
//      con su Bearer token recién obtenido.
//   3. El servidor valida el token, verifica que el rol solicitado es legal,
//      actualiza user_metadata via Admin API y upsert en perfiles.
//
// Trigger SQL recomendado para rol por defecto (ver SUPABASE_ROLE_PLAYBOOK.sql):
//   CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$
//   BEGIN
//     INSERT INTO public.perfiles (id, email, rol)
//     VALUES (NEW.id, NEW.email, 'usuario')
//     ON CONFLICT (id) DO NOTHING;
//     RETURN NEW;
//   END; $$ LANGUAGE plpgsql SECURITY DEFINER;
//
// Requiere Bearer token (requireAuth).
// ═══════════════════════════════════════════════════════════════════════════════
const ROLES_ASIGNABLES = ['comercio', 'cadete'];

app.post('/api/auth/set-role', requireAuth, async (req, res) => {
  const { role } = req.body ?? {};

  if (!role || !ROLES_ASIGNABLES.includes(role)) {
    return res.status(400).json({
      error: `Rol inválido. Solo se puede solicitar: ${ROLES_ASIGNABLES.join(', ')}`,
    });
  }

  // Verificar que el usuario no tenga ya un rol distinto asignado en perfiles.
  // Un 'comercio' no puede reasignarse a 'cadete' y viceversa sin intervención de admin.
  const { data: perfilActual } = await supabase
    .from('perfiles')
    .select('rol')
    .eq('id', req.user.id)
    .maybeSingle();

  if (perfilActual?.rol && perfilActual.rol !== 'usuario' && perfilActual.rol !== role) {
    return res.status(409).json({
      error: `Tu cuenta ya tiene el rol '${perfilActual.rol}'. Contactá al administrador para cambiarlo.`,
    });
  }

  // Actualizar user_metadata via Admin API (service_role, operación privilegiada)
  const { error: metaErr } = await supabase.auth.admin.updateUserById(req.user.id, {
    user_metadata: { ...req.user.user_metadata, role },
  });

  if (metaErr) {
    console.error('[set-role] Error actualizando metadata:', metaErr.message);
    return res.status(500).json({ error: 'No se pudo asignar el rol' });
  }

  // Upsert en la tabla perfiles (fuente de verdad para consultas RLS)
  const { error: perfilErr } = await supabase
    .from('perfiles')
    .upsert({ id: req.user.id, email: req.user.email, rol: role }, { onConflict: 'id' });

  if (perfilErr) {
    console.error('[set-role] Error en perfiles:', perfilErr.message);
    // No es fatal: la metadata ya fue actualizada. El trigger puede encargarse.
  }

  console.log(`[set-role] Usuario ${req.user.id} → rol '${role}'`);
  return res.json({ ok: true, rol: role });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PASARELA DE PAGOS — MercadoPago
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/mp/crear-preferencia
// Crea la preferencia de pago en MP con pedido_id como external_reference.
// El webhook usa esa referencia para identificar qué pedido actualizar.
//
// Requiere Bearer token del cliente dueño del pedido (requireAuth).
// Verifica que pedido.cliente_id === req.user.id antes de crear la preferencia.
app.post('/api/mp/crear-preferencia', requireAuth, async (req, res) => {
  const { pedido_id, items, total, propina_cadete } = req.body ?? {};

  if (!pedido_id || !Array.isArray(items) || items.length === 0 || !total) {
    return res.status(400).json({
      error: 'Campos requeridos: pedido_id (UUID), items (array), total (number)',
    });
  }

  // 4c: Validar propina — entero no negativo, máximo $10.000
  const propinaNum = Math.max(0, Math.floor(Number(propina_cadete ?? 0)));
  if (propinaNum > 10000) {
    return res.status(400).json({ error: 'La propina no puede superar $10.000' });
  }

  // Verificar que el pedido existe y pertenece al usuario autenticado
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, cliente_id, estado')
    .eq('id', pedido_id)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  if (pedido.cliente_id !== req.user.id) {
    return res.status(403).json({ error: 'Este pedido no te pertenece' });
  }

  const ESTADOS_PAGABLES = ['nuevo', 'pendiente'];
  if (!ESTADOS_PAGABLES.includes(pedido.estado)) {
    return res.status(409).json({
      error: `El pedido está en estado '${pedido.estado}' y no puede procesarse como pago`,
    });
  }

  try {
    // 4c: Construir items para MP — propina se suma como línea separada
    const mpItems = [
      ...items.map(item => ({
        id:          String(item.id || item.nombre),
        title:       String(item.nombre),
        quantity:    Number(item.qty ?? item.quantity ?? 1),
        unit_price:  Number(item.precio ?? item.unit_price ?? 0),
        currency_id: 'ARS',
      })),
      ...(propinaNum > 0 ? [{
        id:          'propina-cadete',
        title:       'Propina al repartidor',
        quantity:    1,
        unit_price:  propinaNum,
        currency_id: 'ARS',
      }] : []),
    ];

    // Persistir propina en el pedido antes de redirigir al pago
    if (propinaNum > 0) {
      await supabase.from('pedidos')
        .update({ propina_cadete: propinaNum })
        .eq('id', pedido_id);
    }

    const result = await mpPreference.create({
      body: {
        items: mpItems,
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
  const { pedido_id, nuevo_estado, cadete_id: cadeteIdBody } = req.body ?? {};

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

  // ── Resolver rol del actor (perfiles es la fuente de verdad) ─────────────
  const actorRol = await resolveRol(req.user.id, req.user.user_metadata);
  if (!actorRol) {
    return res.status(403).json({ error: 'Tu cuenta no tiene un rol asignado' });
  }

  // Leer el pedido completo
  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select('id, estado, comercio_id, cliente_id, cadete_id, direccion_entrega, codigo_retiro, codigo_entrega')
    .eq('id', pedido_id)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // ── Matriz de autorización por transición ─────────────────────────────────
  if (nuevo_estado === 'en_preparacion') {
    if (actorRol !== 'comercio' && actorRol !== 'admin') {
      return res.status(403).json({ error: 'Solo el comercio puede aceptar un pedido' });
    }
    if (actorRol === 'comercio') {
      const { data: miComercio } = await supabase
        .from('comercios')
        .select('id')
        .eq('usuario_id', req.user.id)
        .maybeSingle();
      if (!miComercio || miComercio.id !== pedido.comercio_id) {
        return res.status(403).json({ error: 'Este pedido no pertenece a tu comercio' });
      }
    }

  } else if (nuevo_estado === 'cadete_asignado') {
    if (actorRol !== 'cadete' && actorRol !== 'admin') {
      return res.status(403).json({ error: 'Solo un cadete puede aceptar un viaje' });
    }
    // Un cadete solo puede asignarse a sí mismo — nunca a otro cadete
    if (actorRol === 'cadete' && cadeteIdBody && cadeteIdBody !== req.user.id) {
      return res.status(403).json({ error: 'No podés asignar otro cadete en tu nombre' });
    }

  } else if (nuevo_estado === 'en_camino') {
    if (actorRol !== 'cadete' && actorRol !== 'admin') {
      return res.status(403).json({ error: 'Solo el cadete asignado puede marcar el pedido en camino' });
    }
    if (actorRol === 'cadete' && pedido.cadete_id !== req.user.id) {
      return res.status(403).json({ error: 'No sos el cadete asignado a este pedido' });
    }

  } else if (nuevo_estado === 'entregado') {
    if (actorRol !== 'cadete' && actorRol !== 'admin') {
      return res.status(403).json({ error: 'Solo el cadete asignado puede marcar el pedido como entregado' });
    }
    if (actorRol === 'cadete' && pedido.cadete_id !== req.user.id) {
      return res.status(403).json({ error: 'No sos el cadete asignado a este pedido' });
    }

  } else if (nuevo_estado === 'cancelado') {
    if (actorRol === 'comercio') {
      const { data: miComercio } = await supabase
        .from('comercios').select('id').eq('usuario_id', req.user.id).maybeSingle();
      if (!miComercio || miComercio.id !== pedido.comercio_id) {
        return res.status(403).json({ error: 'Este pedido no pertenece a tu comercio' });
      }
    } else if (actorRol === 'usuario' || actorRol === 'cliente') {
      if (pedido.cliente_id !== req.user.id) {
        return res.status(403).json({ error: 'Este pedido no te pertenece' });
      }
    } else if (actorRol !== 'admin') {
      return res.status(403).json({ error: 'No tenés permiso para cancelar este pedido' });
    }
  }

  // ── Validar códigos de seguridad (4a) ─────────────────────────────────────
  // Comparación con timingSafeEqual para evitar timing attacks.
  // Backward-compat: si el pedido no tiene código (creado antes de Fase 4),
  // la transición se permite pero se logea advertencia.
  if (nuevo_estado === 'en_camino' || nuevo_estado === 'entregado') {
    const campoBody  = nuevo_estado === 'en_camino' ? 'codigo_retiro'  : 'codigo_entrega';
    const codigoBody = String(req.body?.[campoBody] ?? '').trim();
    const codigoDb   = String(pedido[nuevo_estado === 'en_camino' ? 'codigo_retiro' : 'codigo_entrega'] ?? '');

    if (codigoDb) {
      if (!codigoBody) {
        return res.status(400).json({
          error: nuevo_estado === 'en_camino'
            ? 'El código de retiro es requerido para confirmar la recogida'
            : 'El código de entrega es requerido para confirmar la entrega',
        });
      }
      // Padding a longitud fija garantiza que timingSafeEqual reciba buffers iguales
      const norm  = s => String(s).padEnd(16, '\0');
      const bufR  = Buffer.from(norm(codigoBody));
      const bufE  = Buffer.from(norm(codigoDb));
      const valid = bufR.length === bufE.length && crypto.timingSafeEqual(bufR, bufE);
      if (!valid) {
        return res.status(403).json({
          error: nuevo_estado === 'en_camino'
            ? 'Código de retiro incorrecto'
            : 'Código de entrega incorrecto',
        });
      }
    } else {
      // Pedido creado antes de Fase 4 — sin código generado
      console.warn(`[Código] Pedido ${pedido_id} sin código generado — transición sin validación`);
    }
  }

  // ── Construir payload de actualización ────────────────────────────────────
  // cadete_id NUNCA viene del body cuando el actor es un cadete:
  // se usa req.user.id para evitar que un cadete asigne otro.
  const updatePayload = { estado: nuevo_estado };

  // 4a: Generar códigos de seguridad cuando el comercio acepta el pedido.
  // crypto.randomInt es criptográficamente seguro (CSPRNG de Node).
  // Rango 1000-9999 → siempre 4 dígitos, sin necesidad de padding.
  if (nuevo_estado === 'en_preparacion') {
    updatePayload.codigo_retiro  = String(crypto.randomInt(1000, 10000));
    updatePayload.codigo_entrega = String(crypto.randomInt(1000, 10000));
  }

  if (nuevo_estado === 'cadete_asignado') {
    updatePayload.cadete_id = actorRol === 'admin'
      ? (cadeteIdBody ?? req.user.id)
      : req.user.id;
  }

  // ── UPDATE atómico — la condición varía por estado ───────────────────────
  if (nuevo_estado === 'cadete_asignado') {
    // Anti-colisión: solo actualiza si cadete_id sigue siendo NULL.
    // Si dos cadetes llegan al mismo tiempo, solo el primero en escribir gana.
    const { data: rowsActualizados, error: updateErr } = await supabase
      .from('pedidos')
      .update(updatePayload)
      .eq('id', pedido_id)
      .is('cadete_id', null)
      .select('id');

    if (updateErr) {
      console.error('[cambiar-estado] Error:', updateErr.message);
      return res.status(500).json({ error: 'No se pudo actualizar el estado del pedido' });
    }

    if (!rowsActualizados?.length) {
      return res.status(409).json({ error: 'Este viaje ya fue tomado por otro cadete' });
    }

    // 4b: Persistir distancia_estimada y pago_cadete como campos estáticos.
    // Se copian de la oferta aceptada — no pueden ser alterados desde el cliente.
    try {
      const { data: ofertaAceptada } = await supabase
        .from('ofertas_cadetes')
        .select('distancia_km, ganancia_estimada')
        .eq('pedido_id', pedido_id)
        .eq('cadete_id', req.user.id)
        .maybeSingle();

      if (ofertaAceptada?.distancia_km != null) {
        await supabase.from('pedidos').update({
          distancia_estimada: ofertaAceptada.distancia_km,
          pago_cadete:        ofertaAceptada.ganancia_estimada
                              ?? calcularGanancia(ofertaAceptada.distancia_km),
        }).eq('id', pedido_id);
      }
    } catch (e) {
      console.warn('[4b] No se pudo persistir distancia/ganancia:', e?.message);
    }

  } else {
    const { error: updateErr } = await supabase
      .from('pedidos')
      .update(updatePayload)
      .eq('id', pedido_id);

    if (updateErr) {
      console.error('[cambiar-estado] Error:', updateErr.message);
      return res.status(500).json({ error: 'No se pudo actualizar el estado del pedido' });
    }
  }

  console.log(`[Pedido ${pedido_id}] ${pedido.estado} → ${nuevo_estado} | actor: ${actorRol}:${req.user.id}`);

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
  // cadeteIdAsignado es el valor real que quedó en la DB (req.user.id para cadetes).
  const cadeteIdAsignado = updatePayload.cadete_id ?? null;
  if (nuevo_estado === 'cadete_asignado' && cadeteIdAsignado) {
    try {
      await supabase
        .from('ofertas_cadetes')
        .update({ estado: 'aceptada' })
        .eq('pedido_id', pedido_id)
        .eq('cadete_id', cadeteIdAsignado);

      await supabase
        .from('ofertas_cadetes')
        .update({ estado: 'rechazada' })
        .eq('pedido_id', pedido_id)
        .neq('cadete_id', cadeteIdAsignado);

      console.log(`[Pedido ${pedido_id}] Cadete ${cadeteIdAsignado} asignado — otras ofertas rechazadas`);
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

  // Rol resuelto desde perfiles (consistente con el resto del backend).
  // Nota: este endpoint se llama cada 5-10 s; el costo extra de la query a
  // perfiles es aceptable porque el token JWT puede tener metadata desactualizada.
  const rolCadete = await resolveRol(req.user.id, req.user.user_metadata);
  if (rolCadete !== 'cadete') {
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

  // ── Procesar transiciones de estado opcionales ────────────────────────────
  if (pedido_id && accion) {

    if (accion === 'aceptar_viaje') {
      // Anti-colisión: UPDATE solo si cadete_id IS NULL.
      // Si otro cadete llegó primero, el UPDATE afecta 0 filas → 409.
      const { data: rowsAsignados, error: stateErr } = await supabase
        .from('pedidos')
        .update({ estado: 'cadete_asignado', cadete_id: cadeteId })
        .eq('id', pedido_id)
        .is('cadete_id', null)
        .select('id');

      if (stateErr) {
        console.error('[GPS→aceptar_viaje] Error:', stateErr.message);
        return res.status(500).json({ error: 'Error al asignar el pedido' });
      }

      if (!rowsAsignados?.length) {
        return res.status(409).json({
          ok:      true,
          gps:     'actualizado',
          error:   'viaje_ya_tomado',
          mensaje: 'Este viaje ya fue tomado por otro cadete',
        });
      }

      // Cerrar las demás ofertas del mismo pedido
      await supabase.from('ofertas_cadetes')
        .update({ estado: 'aceptada' })
        .eq('pedido_id', pedido_id).eq('cadete_id', cadeteId);
      await supabase.from('ofertas_cadetes')
        .update({ estado: 'rechazada' })
        .eq('pedido_id', pedido_id).neq('cadete_id', cadeteId);

      console.log(`[GPS] cadete:${cadeteId} | aceptar_viaje | pedido ${pedido_id} → cadete_asignado`);
      return res.json({ ok: true, gps: 'actualizado', estado: 'cadete_asignado' });
    }

    if (accion === 'retirar_pedido') {
      // Solo el cadete asignado puede retirar: verificar ownership en la query.
      const { data: rowsRetirados, error: stateErr } = await supabase
        .from('pedidos')
        .update({ estado: 'en_camino' })
        .eq('id', pedido_id)
        .eq('cadete_id', cadeteId)
        .select('id');

      if (stateErr) {
        console.error('[GPS→retirar_pedido] Error:', stateErr.message);
        return res.status(500).json({ error: 'Error al retirar el pedido' });
      }

      if (!rowsRetirados?.length) {
        return res.status(403).json({ error: 'No sos el cadete asignado a este pedido' });
      }

      console.log(`[GPS] cadete:${cadeteId} | retirar_pedido | pedido ${pedido_id} → en_camino`);
      return res.json({ ok: true, gps: 'actualizado', estado: 'en_camino' });
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
// 6. DETALLE DE PEDIDO CON IDENTIDAD DEL CADETE (4d)
// GET /api/pedidos/:id
//
// Devuelve el pedido completo + perfil del cadete asignado (LEFT JOIN manual).
// Si cadete_id es null el campo cadete_perfil viene null — nunca rompe.
//
// Visibilidad de códigos de seguridad:
//   cliente  → recibe codigo_entrega  (lo muestra al cadete al entregar)
//   comercio → recibe codigo_retiro   (lo dice al cadete al retirar)
//   cadete   → no recibe ninguno      (los tipea tras recibirlos verbalmente)
//   admin    → recibe ambos
//
// Requiere Bearer token (requireAuth).
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/api/pedidos/:id', requireAuth, async (req, res) => {
  const pedidoId = req.params.id;
  if (!pedidoId) return res.status(400).json({ error: 'pedido_id requerido' });

  const actorRol = await resolveRol(req.user.id, req.user.user_metadata);

  const { data: pedido, error: pedidoErr } = await supabase
    .from('pedidos')
    .select(
      'id, numero, estado, total, subtotal, costo_envio, metodo_pago, ' +
      'direccion_entrega, created_at, notas, ' +
      'cliente_id, comercio_id, cadete_id, ' +
      'distancia_estimada, pago_cadete, propina_cadete, ' +
      'codigo_retiro, codigo_entrega, ' +
      'comercios ( nombre, direccion, telefono, imagen_url, lat, lng )'
    )
    .eq('id', pedidoId)
    .single();

  if (pedidoErr || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' });
  }

  // ── Autorización ───────────────────────────────────────────────────────────
  const esCliente = pedido.cliente_id === req.user.id;
  const esCadete  = pedido.cadete_id  === req.user.id;
  const esAdmin   = actorRol === 'admin';

  let esComercio = false;
  if (actorRol === 'comercio') {
    const { data: miComercio } = await supabase
      .from('comercios').select('id').eq('usuario_id', req.user.id).maybeSingle();
    esComercio = miComercio?.id === pedido.comercio_id;
  }

  if (!esCliente && !esCadete && !esComercio && !esAdmin) {
    return res.status(403).json({ error: 'No tenés permiso para ver este pedido' });
  }

  // ── Perfil del cadete asignado (LEFT JOIN manual) ──────────────────────────
  // Se usa LEFT JOIN manual en lugar de embedded select para no depender de
  // que exista una FK nombrada entre pedidos.cadete_id y perfiles.id.
  let cadetePerfil = null;
  if (pedido.cadete_id) {
    const { data: perfil } = await supabase
      .from('perfiles')
      .select('id, nombre, apellido, avatar_url, vehiculo, color')
      .eq('id', pedido.cadete_id)
      .maybeSingle();
    cadetePerfil = perfil ?? null;
  }

  // ── Filtrar códigos según el rol del solicitante ───────────────────────────
  const respuesta = { ...pedido, cadete_perfil: cadetePerfil };

  if (!esAdmin) {
    // Cliente solo ve codigo_entrega — lo muestra al cadete al recibir
    if (esCliente)  delete respuesta.codigo_retiro;
    // Comercio solo ve codigo_retiro — se lo dice al cadete al retirar
    if (esComercio) delete respuesta.codigo_entrega;
    // Cadete no ve ninguno — los recibe verbalmente y los tipea en la app
    if (esCadete)   { delete respuesta.codigo_retiro; delete respuesta.codigo_entrega; }
  }

  return res.json(respuesta);
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
  console.log('║  GET  /api/pedidos/:id             [auth]    ║');
  console.log('║  GET  /health                                ║');
  console.log('╚══════════════════════════════════════════════╝\n');
});
