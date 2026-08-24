/**
 * getnetClient.js
 *
 * ⚠️ WIP / NO VERIFICADO CONTRA LA API REAL — no hay cuenta comercial ni
 * credenciales de Getnet (sandbox ni producción) todavía. Ver
 * docs/GETNET-INTEGRACION.md para el checklist completo antes de usar esto
 * en serio.
 *
 * Cliente REST minimalista para la Regional API de Getnet (Getnet SEP —
 * Argentina/Brasil/Chile/México/Colombia/Portugal/España/Uruguay con un
 * único esquema de integración). No hay SDK oficial de Node.js publicado
 * — igual que con Payway (ver paywayClient.js), este archivo pega directo
 * a la API REST con fetch nativo (Node 22), sin agregar ninguna
 * dependencia nueva a package.json.
 *
 * Lo confirmado contra la documentación pública (docs.globalgetnet.com,
 * 2026-08-24):
 *   - Auth: OAuth2 client_credentials. POST a
 *     `/authentication/oauth2/access_token` con HTTP Basic Auth
 *     (`client_id:client_secret` en base64) → devuelve `access_token`
 *     (JWT), `token_type: Bearer`, expira en 3599s.
 *   - Cada request autenticado además lleva el header `x-seller-id` con el
 *     identificador del comercio.
 *   - Confirmación de pago: asincrónica, vía webhook a una URL configurada
 *     por el comercio antes de pasar a producción, con firma SHA-256 (ver
 *     verificarFirmaWebhook en getnetUtils.js — fórmula exacta sin
 *     confirmar).
 *
 * Lo NO confirmado (el resto de la doc técnica — paths exactos, forma del
 * payload/response de creación de orden/checkout, base URL de producción —
 * está detrás del developer portal, que requiere cuenta real; no se pudo
 * scrapear como contenido público, mismo bloqueo que hubo con
 * developers.payway.com.ar):
 *   1. Confirmar con cuenta real en el developer portal de Getnet: base URL
 *      de producción, path exacto de "crear checkout/orden" (Get
 *      Checkout vs. Regional API pueden diferir), forma exacta del
 *      payload/response.
 *   2. Correr al menos un pago de prueba contra el ambiente sandbox y
 *      comparar contra lo que este archivo asume.
 *
 * No usar en producción sin haber hecho el paso 1 y 2.
 */

// Confirmado por doc pública para sandbox. Producción NO confirmada — ver
// disclaimer arriba. GETNET_API_BASE permite overridear ambas por env sin
// tocar código.
const GETNET_API_BASE =
  process.env.GETNET_API_BASE ??
  (process.env.GETNET_ENV === 'production'
    ? 'https://api.globalgetnet.com' // TODO(verificar): host de producción no confirmado
    : 'https://api-sbx.globalgetnet.com');

let tokenCache = { accessToken: null, expiraEn: 0 };

function assertConfigurado() {
  if (!process.env.GETNET_CLIENT_ID || !process.env.GETNET_CLIENT_SECRET) {
    throw new Error(
      '[getnetClient] GETNET_CLIENT_ID / GETNET_CLIENT_SECRET no configuradas. Ver ' +
      'docs/GETNET-INTEGRACION.md — esta integración todavía no tiene credenciales reales.'
    );
  }
}

/**
 * obtenerAccessToken — OAuth2 client_credentials. Cachea el token en
 * memoria del proceso hasta ~30s antes de que expire, para no pedir uno
 * nuevo en cada request (mismo criterio de caché simple que ya usa
 * climaService.js para no golpear una API externa de más).
 */
async function obtenerAccessToken() {
  assertConfigurado();

  const ahora = Date.now();
  if (tokenCache.accessToken && ahora < tokenCache.expiraEn) {
    return tokenCache.accessToken;
  }

  const basicAuth = Buffer.from(
    `${process.env.GETNET_CLIENT_ID}:${process.env.GETNET_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${GETNET_API_BASE}/authentication/oauth2/access_token`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    // TODO(verificar): confirmar si el grant_type va en el body form-urlencoded
    // (convención OAuth2 estándar, asumido acá) o si Getnet lo infiere del
    // Basic Auth solo. No confirmado contra la API real.
    body: 'grant_type=client_credentials',
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.access_token) {
    const err = new Error(`[getnetClient] No se pudo obtener access_token → HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  tokenCache = {
    accessToken: data.access_token,
    // expires_in viene en segundos (~3599 según doc); restamos 30s de margen.
    expiraEn: ahora + Math.max(0, (Number(data.expires_in ?? 3599) - 30)) * 1000,
  };

  return tokenCache.accessToken;
}

async function getnetFetch(path, { method = 'GET', body } = {}) {
  const accessToken = await obtenerAccessToken();

  const res = await fetch(`${GETNET_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'x-seller-id':   process.env.GETNET_SELLER_ID ?? '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const err = new Error(`[getnetClient] ${method} ${path} → HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * crearCheckout — crea una orden de pago/checkout hospedado (Get Checkout).
 *
 * ⚠️ TODO(verificar): path (`/v1/orders` es un supuesto tomado de
 * convenciones REST comunes de esta familia de APIs, no confirmado) y forma
 * exacta del payload NO confirmados contra la doc real — ver disclaimer al
 * inicio del archivo. No usar en producción sin verificar contra
 * developer.globalgetnet.com con cuenta real.
 *
 * @param {object} data
 * @param {string} data.orderId       — id único de esta orden de este lado (reconciliación)
 * @param {number} data.amount        — ver pesosToGetnetAmount() en getnetUtils.js (formato sin confirmar)
 * @param {string} data.currency      — 'ARS'
 * @param {string} data.notificationUrl — URL del webhook (GETNET/api/getnet/webhook)
 * @param {string} [data.returnUrl]   — a dónde vuelve el cliente tras pagar (redirect mode)
 */
export async function crearCheckout(data) {
  const payload = {
    order_id:          data.orderId,
    amount:            data.amount,
    currency:          data.currency ?? 'ARS',
    notification_url:  data.notificationUrl,
    return_url:        data.returnUrl,
  };

  return getnetFetch('/v1/orders', { method: 'POST', body: payload });
}

/** consultarOrden — re-consulta el estado de una orden por id. Path sin confirmar (ver disclaimer). */
export async function consultarOrden(orderId) {
  return getnetFetch(`/v1/orders/${encodeURIComponent(orderId)}`);
}
