#!/usr/bin/env node
/**
 * QA E2E smoke test — Día 2 del plan de lanzamiento.
 *
 * Simula el flujo completo de un pedido (cliente → comercio → cadete → entrega
 * → rating) pegando directo a la API real de Railway y a Supabase real, con
 * las MISMAS llamadas (mismos endpoints, mismas tablas, mismo shape de body)
 * que usa el frontend. No usa service_role — todo pasa por las mismas reglas
 * de RLS/auth que atraviesa un usuario real.
 *
 * Crea cuentas de prueba nuevas en producción (prefijo "qa-e2e-"), no toca
 * datos existentes. No las borra al terminar — quedan listadas al final del
 * output para que se puedan identificar/borrar a mano si se quiere.
 *
 * No cubre (requieren navegador real):
 *   - Pago real con MercadoPago (necesita tarjeta/checkout real)
 *   - Entrega de push notifications (necesita Service Worker + navegador)
 *   - Render visual del mapa / chat UI (esto sí verifica que los datos
 *     lleguen a las tablas correctas; no que se vean bien en pantalla)
 *
 * Uso: node backend/scripts/qa-e2e.mjs   (desde la raíz del repo o desde backend/)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot   = path.resolve(__dirname, '..', '..');

// ─── Config: leída directo de frontend/env.js (son valores públicos: anon key) ──
function leerEnvJs() {
  const contenido = readFileSync(path.join(repoRoot, 'frontend', 'env.js'), 'utf8');
  const grab = (key) => {
    const m = contenido.match(new RegExp(`window\\.${key}\\s*=\\s*['"]([^'"]+)['"]`));
    if (!m) throw new Error(`No se encontró ${key} en frontend/env.js`);
    return m[1];
  };
  return {
    SUPABASE_URL:      grab('SUPABASE_URL'),
    SUPABASE_ANON_KEY: grab('SUPABASE_ANON_KEY'),
    BACKEND_URL:       grab('BACKEND_URL'),
  };
}

const { SUPABASE_URL, SUPABASE_ANON_KEY, BACKEND_URL } = leerEnvJs();

const RUN_ID = Date.now();
const results = [];
const creados = []; // emails/IDs de prueba creados, para poder identificarlos después

function log(msg) { console.log(msg); }

async function step(nombre, fn) {
  try {
    const r = await fn();
    results.push({ nombre, ok: true });
    log(`✅ ${nombre}`);
    return r;
  } catch (err) {
    results.push({ nombre, ok: false, error: err.message });
    log(`❌ ${nombre} — ${err.message}`);
    throw err;
  }
}

// ─── Helpers HTTP ───────────────────────────────────────────────────────────────

async function backendRegister(email, password, full_name, role) {
  const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password, full_name, role }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`register ${role} → HTTP ${res.status}: ${json.error}`);
  return json.user;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body:    JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`signIn ${email} → HTTP ${res.status}: ${json.error_description || json.msg}`);
  return json.access_token;
}

function sbHeaders(jwt, extra = {}) {
  return {
    apikey:        SUPABASE_ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbInsert(table, body, jwt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: sbHeaders(jwt, { Prefer: 'return=representation' }),
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`insert ${table} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  return Array.isArray(json) ? json[0] : json;
}

async function sbUpdate(table, filtroQS, body, jwt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filtroQS}`, {
    method:  'PATCH',
    headers: sbHeaders(jwt, { Prefer: 'return=representation' }),
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`update ${table} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  return Array.isArray(json) ? json[0] : json;
}

async function sbSelect(table, filtroQS, jwt) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filtroQS}`, {
    headers: sbHeaders(jwt),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`select ${table} → HTTP ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function apiPost(pathname, body, jwt) {
  const res = await fetch(`${BACKEND_URL}${pathname}`, {
    method:  'POST',
    headers: sbHeaders(jwt),
    body:    JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function apiGet(pathname, jwt) {
  const res = await fetch(`${BACKEND_URL}${pathname}`, { headers: sbHeaders(jwt) });
  const json = await res.json();
  return { status: res.status, json };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion falló: ${msg}`);
}

// ─── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  log(`\n=== QA E2E — run ${RUN_ID} ===`);
  log(`Backend: ${BACKEND_URL}`);
  log(`Supabase: ${SUPABASE_URL}\n`);

  const pass = 'Qa-e2e-2026!';

  // ── Setup: 3 cuentas de prueba ────────────────────────────────────────────────
  const clienteEmail = `qa-e2e-cliente-${RUN_ID}@test.local`;
  const comercioEmail = `qa-e2e-comercio-${RUN_ID}@test.local`;
  const cadeteEmail  = `qa-e2e-cadete-${RUN_ID}@test.local`;
  const cadete2Email = `qa-e2e-cadete2-${RUN_ID}@test.local`;
  creados.push(clienteEmail, comercioEmail, cadeteEmail, cadete2Email);

  const cliente = await step('Registrar cliente de prueba', () => backendRegister(clienteEmail, pass, 'QA Cliente', 'cliente'));
  const comercio = await step('Registrar comercio de prueba', () => backendRegister(comercioEmail, pass, 'QA Comercio', 'comercio'));
  const cadete = await step('Registrar cadete de prueba', () => backendRegister(cadeteEmail, pass, 'QA Cadete', 'cadete'));
  const cadete2 = await step('Registrar segundo cadete (para anti-colisión)', () => backendRegister(cadete2Email, pass, 'QA Cadete 2', 'cadete'));

  const jwtCliente = await step('Login cliente', () => signIn(clienteEmail, pass));
  const jwtComercio = await step('Login comercio', () => signIn(comercioEmail, pass));
  const jwtCadete = await step('Login cadete', () => signIn(cadeteEmail, pass));
  const jwtCadete2 = await step('Login cadete 2', () => signIn(cadete2Email, pass));

  // Coordenadas reales de Santiago del Estero, separadas ~2-3km
  const comLat = -27.7834, comLng = -64.2642;
  const cliLat = -27.7950, cliLng = -64.2500;

  const comercioRow = await step('Comercio: crear fila en comercios (lat/lng reales)', () => sbInsert('comercios', {
    nombre: `QA E2E Test Comercio ${RUN_ID}`,
    categoria: 'restaurante',
    descripcion: 'Cuenta de prueba generada por qa-e2e.mjs — se puede borrar.',
    direccion: 'Dirección de prueba 123',
    provincia: 'Santiago del Estero',
    ciudad: 'Santiago del Estero',
    email: comercioEmail,
    usuario_id: comercio.id,
    estado_registro: 'pendiente',
    tipo_delivery_defecto: 'app',
    activo: false,
    abierto_ahora: false,
    deuda: 0,
    rating: 0,
    total_pedidos: 0,
    lat: comLat,
    lng: comLng,
  }, jwtComercio));

  const categoria = await step('Comercio: crear categoría de producto', () => sbInsert('categorias_producto', {
    nombre: 'QA Test', comercio_id: comercioRow.id, orden: 0,
  }, jwtComercio));

  const producto = await step('Comercio: crear producto', () => sbInsert('productos', {
    nombre: 'Producto QA', descripcion: 'Test', precio_base: 1000,
    categoria_id: categoria.id, comercio_id: comercioRow.id, disponible: true,
  }, jwtComercio));

  await step('Cadete: activar disponible + vehículo (sin onboarding UI)', () => sbUpdate(
    'cadetes', `auth_uid=eq.${cadete.id}`,
    { disponible: true, activo: true, vehiculo: 'moto', tarifa_clima: false },
    jwtCadete,
  ));
  await step('Cadete 2: activar disponible (mismo vehículo)', () => sbUpdate(
    'cadetes', `auth_uid=eq.${cadete2.id}`,
    { disponible: true, activo: true, vehiculo: 'moto', tarifa_clima: false },
    jwtCadete2,
  ));
  // GPS inicial de ambos cadetes, cerca del comercio, para que difundir los encuentre
  await step('Cadete: ping GPS inicial (cerca del comercio)', async () => {
    const r = await apiPost('/api/cadete/actualizar-ubicacion', { lat: comLat + 0.001, lng: comLng + 0.001 }, jwtCadete);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });
  await step('Cadete 2: ping GPS inicial', async () => {
    const r = await apiPost('/api/cadete/actualizar-ubicacion', { lat: comLat + 0.001, lng: comLng + 0.001 }, jwtCadete2);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  // ── Pedido #1: flujo feliz completo, sin tarifa clima ─────────────────────────
  const pedido1 = await step('Cliente: crear pedido (efectivo)', () => sbInsert('pedidos', {
    comercio_id: comercioRow.id,
    cliente_id:  cliente.id,
    productos:   [{ id: producto.id, nombre: 'Producto QA', precio: 1000, qty: 2 }],
    total:       3200,
    estado:      'nuevo',
    direccion_entrega: 'Dirección de entrega de prueba',
    lat_entrega: cliLat,
    lng_entrega: cliLng,
    propina_cadete: 0,
    metodo_pago: 'efectivo',
  }, jwtCliente));

  await step('Comercio: aceptar pedido → preparando', () => sbUpdate(
    'pedidos', `id=eq.${pedido1.id}`, { estado: 'preparando' }, jwtComercio,
  ));

  const difundirResp = await step('Comercio: POST /api/pedidos/difundir', async () => {
    const r = await apiPost('/api/pedidos/difundir', { pedidoId: pedido1.id, comercioId: comercioRow.id }, jwtComercio);
    assert(r.status === 200, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
    assert((r.json.difundido ?? 0) >= 1, `difundido=${r.json.difundido}, esperaba ≥1 (¿los cadetes de prueba no quedaron dentro del radio de 10km?)`);
    return r.json;
  });

  const ofertasCadete1 = await step('Cadete: leer su oferta pendiente', async () => {
    const rows = await sbSelect('ofertas_cadetes', `cadete_id=eq.${cadete.id}&pedido_id=eq.${pedido1.id}&estado=eq.pendiente`, jwtCadete);
    assert(rows.length === 1, `esperaba 1 oferta pendiente, encontré ${rows.length}`);
    return rows[0];
  });
  const ofertasCadete2 = await step('Cadete 2: leer su oferta pendiente (para el test de anti-colisión)', async () => {
    const rows = await sbSelect('ofertas_cadetes', `cadete_id=eq.${cadete2.id}&pedido_id=eq.${pedido1.id}&estado=eq.pendiente`, jwtCadete2);
    assert(rows.length === 1, `esperaba 1 oferta pendiente para cadete2, encontré ${rows.length}`);
    return rows[0];
  });

  await step('Cadete: aceptar viaje (POST /api/pedidos/aceptar)', async () => {
    const r = await apiPost('/api/pedidos/aceptar', { pedidoId: pedido1.id, cadeteId: cadete.id, ofertaId: ofertasCadete1.id }, jwtCadete);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Anti-colisión: cadete 2 intenta aceptar el mismo pedido → debe fallar 409', async () => {
    const r = await apiPost('/api/pedidos/aceptar', { pedidoId: pedido1.id, cadeteId: cadete2.id, ofertaId: ofertasCadete2.id }, jwtCadete2);
    assert(r.status === 409, `esperaba 409 PEDIDO_YA_TOMADO, obtuve HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  const codigoRetiro = await step('Comercio: leer codigo_retiro (select directo, RLS)', async () => {
    const rows = await sbSelect('pedidos', `id=eq.${pedido1.id}&select=codigo_retiro,estado`, jwtComercio);
    assert(rows[0]?.codigo_retiro, 'codigo_retiro vino vacío');
    assert(rows[0]?.estado === 'en_preparacion', `esperaba estado en_preparacion, vino ${rows[0]?.estado}`);
    return rows[0].codigo_retiro;
  });

  await step('Cadete: confirmar retiro con código correcto → en_camino', async () => {
    const r = await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id: pedido1.id, nuevo_estado: 'en_camino', codigo_retiro: codigoRetiro,
    }, jwtCadete);
    assert(r.status === 200 && r.json.ok !== false, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Cadete: código de retiro incorrecto es rechazado (chequeo de seguridad)', async () => {
    // Reusar el mismo estado no aplica dos veces, así que probamos contra un pedido ya en_camino:
    // cambiar-estado con código erroneo para el paso de entrega debe fallar.
    const r = await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id: pedido1.id, nuevo_estado: 'entregado', codigo_entrega: '0000',
    }, jwtCadete);
    assert(r.status !== 200 || r.json.ok === false, `un código inventado NO debería confirmar la entrega, pero HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Cadete: ping GPS en camino (simula watchPosition)', async () => {
    const r = await apiPost('/api/cadete/actualizar-ubicacion', {
      lat: (comLat + cliLat) / 2, lng: (comLng + cliLng) / 2, pedido_id: pedido1.id,
    }, jwtCadete);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Realtime: la fila de ubicacion_cadetes quedó escrita (proxy de que Realtime tiene algo que propagar)', async () => {
    const rows = await sbSelect('ubicacion_cadetes', `cadete_id=eq.${cadete.id}&select=lat,lng,pedido_id`, jwtCadete);
    assert(rows[0]?.pedido_id === pedido1.id, 'ubicacion_cadetes no quedó asociada al pedido');
  });

  await step('Chat: cliente envía mensaje del pedido', () => sbInsert('mensajes_pedido', {
    pedido_id: pedido1.id, remitente_id: cliente.id, rol_remitente: 'cliente', mensaje: 'Hola, ¿cuánto falta?',
  }, jwtCliente));

  const codigoEntrega = await step('Cliente: GET /api/pedidos/:id revela codigo_entrega (solo en en_camino)', async () => {
    const r = await apiGet(`/api/pedidos/${pedido1.id}`, jwtCliente);
    assert(r.status === 200, `HTTP ${r.status}`);
    assert(r.json.codigo_entrega, 'codigo_entrega no vino en la respuesta estando en_camino');
    return r.json.codigo_entrega;
  });

  const cadeteDeudaAntes = await step('Cadete: leer deuda_efectivo ANTES de entregar', async () => {
    const rows = await sbSelect('cadetes', `auth_uid=eq.${cadete.id}&select=deuda_efectivo`, jwtCadete);
    return Number(rows[0]?.deuda_efectivo ?? 0);
  });

  await step('Cadete: confirmar entrega con código correcto → entregado', async () => {
    const r = await apiPost('/api/pedidos/cambiar-estado', {
      pedido_id: pedido1.id, nuevo_estado: 'entregado', codigo_entrega: codigoEntrega,
    }, jwtCadete);
    assert(r.status === 200 && r.json.ok !== false, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Trigger efectivo: deuda_efectivo del cadete aumentó tras la entrega', async () => {
    const rows = await sbSelect('cadetes', `auth_uid=eq.${cadete.id}&select=deuda_efectivo`, jwtCadete);
    const despues = Number(rows[0]?.deuda_efectivo ?? 0);
    assert(despues > cadeteDeudaAntes, `deuda_efectivo no aumentó (antes=${cadeteDeudaAntes}, después=${despues})`);
  });

  await step('Cliente: valorar comercio (5★)', async () => {
    const r = await apiPost('/api/pedidos/valorar', { pedido_id: pedido1.id, tipo: 'comercio', estrellas: 5 }, jwtCliente);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });
  await step('Cliente: valorar cadete (5★)', async () => {
    const r = await apiPost('/api/pedidos/valorar', { pedido_id: pedido1.id, tipo: 'cadete', estrellas: 5 }, jwtCliente);
    assert(r.status === 200 && r.json.ok, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Rating: el promedio del cadete se actualizó a 5', async () => {
    const rows = await sbSelect('cadetes', `auth_uid=eq.${cadete.id}&select=rating`, jwtCadete);
    assert(Number(rows[0]?.rating) === 5, `rating del cadete = ${rows[0]?.rating}, esperaba 5`);
  });

  // ── Pedido #2: mismo comercio/cliente, tarifa clima ON — comparar ganancia ────
  const gananciaSinClima = await step('Ganancia SIN clima (leída de ofertas_cadetes del pedido #1)', async () => {
    return Number(ofertasCadete1.ganancia_estimada);
  });

  await step('Cadete: activar tarifa_clima', () => sbUpdate(
    'cadetes', `auth_uid=eq.${cadete.id}`, { tarifa_clima: true }, jwtCadete,
  ));

  const pedido2 = await step('Cliente: crear pedido #2 (mismas coords, para comparar tarifa)', () => sbInsert('pedidos', {
    comercio_id: comercioRow.id,
    cliente_id:  cliente.id,
    productos:   [{ id: producto.id, nombre: 'Producto QA', precio: 1000, qty: 1 }],
    total:       2200,
    estado:      'nuevo',
    direccion_entrega: 'Dirección de entrega de prueba',
    lat_entrega: cliLat,
    lng_entrega: cliLng,
    propina_cadete: 0,
    metodo_pago: 'efectivo',
  }, jwtCliente));

  await step('Comercio: aceptar pedido #2', () => sbUpdate('pedidos', `id=eq.${pedido2.id}`, { estado: 'preparando' }, jwtComercio));
  await step('Comercio: difundir pedido #2', async () => {
    const r = await apiPost('/api/pedidos/difundir', { pedidoId: pedido2.id, comercioId: comercioRow.id }, jwtComercio);
    assert(r.status === 200 && (r.json.difundido ?? 0) >= 1, `HTTP ${r.status}: ${JSON.stringify(r.json)}`);
  });

  await step('Tarifa clima: ganancia_estimada del pedido #2 es ×1.20 (redondeado a $50) vs pedido #1', async () => {
    const rows = await sbSelect('ofertas_cadetes', `cadete_id=eq.${cadete.id}&pedido_id=eq.${pedido2.id}&select=ganancia_estimada`, jwtCadete);
    const gananciaConClima = Number(rows[0]?.ganancia_estimada);
    const esperada = Math.round((gananciaSinClima * 1.20) / 50) * 50;
    assert(gananciaConClima === esperada, `sin clima=${gananciaSinClima}, con clima=${gananciaConClima}, esperaba=${esperada}`);
  });

  log(`\n=== Resumen: ${results.filter(r => r.ok).length}/${results.length} pasos OK ===`);
  log(`\nCuentas de prueba creadas (podés borrarlas a mano si querés, prefijo qa-e2e-):`);
  creados.forEach(e => log(`  - ${e}`));
  log(`\nComercio de prueba: "${comercioRow.nombre}" (id ${comercioRow.id})`);
  log(`\nNo cubierto por este script (requiere navegador real): pago MercadoPago real, push notifications, chat/mapa visual.`);
}

main().catch((err) => {
  log(`\n=== FALLÓ: ${err.message} ===`);
  log(`\n${results.filter(r => r.ok).length}/${results.length} pasos completados antes de la falla.`);
  log(`\nCuentas de prueba parcialmente creadas (revisar/limpiar a mano):`);
  creados.forEach(e => log(`  - ${e}`));
  process.exit(1);
});
