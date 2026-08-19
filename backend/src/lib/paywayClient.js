/**
 * paywayClient.js
 *
 * ⚠️ WIP / NO VERIFICADO CONTRA LA API REAL — no hay credenciales de Payway
 * (sandbox ni producción) todavía. Ver docs/PAYWAY-INTEGRACION.md para el
 * checklist completo antes de usar esto en serio.
 *
 * Cliente REST minimalista para la Gateway API de Payway. No existe un SDK
 * oficial de Node.js (solo hay SDKs publicados por payway-ar en GitHub para
 * PHP/.NET/Java: sdk-php-ventaonline, sdk-net-ventaonline, sdk-java-ventaonline)
 * — así que este archivo pega directo a la API REST con fetch nativo (Node 22),
 * sin agregar ninguna dependencia nueva a package.json.
 *
 * Los 3 SDKs oficiales usan el namespace `\Decidir\Connector` — la Gateway
 * API de Payway corre sobre la misma infraestructura que la de Decidir
 * (Prisma/Banco Galicia). La base URL, el nombre del header de la API key
 * y los paths de abajo están tomados de ese parentesco + la doc pública de
 * Decidir, PERO nunca se probaron contra un pago real de Payway — la doc
 * oficial de Payway (developers.payway.com.ar) es una SPA que no expone su
 * contenido a un fetch simple, así que hace falta:
 *
 *   1. Conseguir acceso real a developers.payway.com.ar (cuenta comercial)
 *      y confirmar ahí mismo: base URL, nombre del header de la key,
 *      endpoints exactos y forma exacta del payload/response.
 *   2. Correr al menos un pago de prueba contra el ambiente sandbox y
 *      comparar contra lo que este archivo asume.
 *
 * No usar en producción sin haber hecho el paso 1 y 2.
 */

// TODO(verificar): confirmar la base URL real de Payway (sandbox y
// producción) en developers.payway.com.ar antes de ir a producción. La de
// abajo es la convención conocida de Decidir (misma infra) — puede que
// Payway use un host propio (ej. algo bajo payway.com.ar) en vez del de
// Decidir directamente.
const PAYWAY_API_BASE =
  process.env.PAYWAY_API_BASE ??
  (process.env.PAYWAY_ENV === 'production'
    ? 'https://live.decidir.com/api/v2'
    : 'https://developers.decidir.com/api/v2');

function assertConfigurado() {
  if (!process.env.PAYWAY_PRIVATE_KEY) {
    throw new Error(
      '[paywayClient] PAYWAY_PRIVATE_KEY no configurada. Ver docs/PAYWAY-INTEGRACION.md — ' +
      'esta integración todavía no tiene credenciales reales.'
    );
  }
}

async function paywayFetch(path, { method = 'GET', body } = {}) {
  assertConfigurado();

  const res = await fetch(`${PAYWAY_API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // TODO(verificar): Decidir usa el header `apikey` para la private key
      // en llamadas server-to-server. Confirmar que Payway usa el mismo
      // nombre de header (podría ser Authorization/Bearer u otro).
      apikey: process.env.PAYWAY_PRIVATE_KEY,
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
    const err = new Error(`[paywayClient] ${method} ${path} → HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

/**
 * ejecutarPago — cobra un token de tarjeta ya generado en el frontend
 * (ver frontend/assets/js/payway.js). Equivalente a `ExecutePayment()` del
 * SDK PHP oficial. A diferencia de MercadoPago, la respuesta trae el estado
 * final (aprobado/rechazado) de forma SINCRÓNICA — no hace falta esperar un
 * webhook para confirmar el pago (ver mapEstadoPayway en paywayUtils.js).
 *
 * @param {object} data
 * @param {string} data.token             — token de tarjeta (generado client-side)
 * @param {string} data.site_transaction_id — id único de esta transacción de este lado
 * @param {number} data.amount            — en formato Payway, ver pesosToPaywayAmount()
 * @param {number} data.payment_method_id
 * @param {string} data.bin               — primeros 6 dígitos de la tarjeta
 * @param {number} [data.installments]    — cuotas, default 1
 * @param {object} data.customer          — { id, email, ip_address }
 */
export async function ejecutarPago(data) {
  const payload = {
    site_transaction_id: data.site_transaction_id,
    token:                data.token,
    payment_method_id:    data.payment_method_id,
    bin:                  data.bin,
    amount:               data.amount,
    currency:             'ARS',
    installments:         data.installments ?? 1,
    payment_type:         'single',
    customer:             data.customer,
  };

  return paywayFetch('/payments', { method: 'POST', body: payload });
}

/** consultarPago — equivalente a `PaymentInfo()`. Re-consulta el estado de un pago por id. */
export async function consultarPago(paymentId) {
  return paywayFetch(`/payments/${encodeURIComponent(paymentId)}`);
}

/** reembolsar — reembolso total, o parcial si se pasa `amount` (formato Payway). */
export async function reembolsar(paymentId, amount) {
  if (amount == null) {
    return paywayFetch(`/payments/${encodeURIComponent(paymentId)}/refunds`, { method: 'POST' });
  }
  return paywayFetch(`/payments/${encodeURIComponent(paymentId)}/refunds`, {
    method: 'POST',
    body: { amount },
  });
}
