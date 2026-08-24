/**
 * getnetUtils.js
 *
 * Funciones puras (sin red, sin DB) para la integración con Getnet —
 * separadas de getnetClient.js para poder testearlas sin credenciales
 * reales, mismo criterio que paywayUtils.js/comisionUtils.js/tarifaUtils.js.
 * Ver backend/test/getnetUtils.test.js y docs/GETNET-INTEGRACION.md.
 *
 * ⚠️ WIP — Getnet todavía no está conectado al flujo real de pedidos.
 * MercadoPago sigue siendo la única pasarela activa. Ver
 * docs/GETNET-INTEGRACION.md para el estado completo y qué falta.
 */

import crypto from 'node:crypto';

/**
 * pesosToGetnetAmount / getnetAmountToPesos
 *
 * ⚠️ TODO(verificar): a diferencia de Payway (confirmado: enteros con los
 * últimos 2 dígitos como centavos, por parentesco con Decidir), no se
 * encontró documentación pública que confirme si la Regional API de Getnet
 * espera el monto como decimal ARS (ej. 500.00) o como entero escalado
 * (ej. 50000). El portal técnico (docs.globalgetnet.com) no expone el
 * payload de creación de orden sin una cuenta real. Hasta confirmar esto
 * contra la doc real o un pago de sandbox, estas funciones son identidad —
 * NO asumir un formato de otra pasarela solo porque "seguramente es
 * parecido". Actualizar junto con getnetClient.js cuando se confirme.
 *
 * @param {number} pesos
 * @returns {number}
 */
export function pesosToGetnetAmount(pesos) {
  const n = Number(pesos);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`pesosToGetnetAmount: monto inválido (${pesos})`);
  }
  return Math.round(n * 100) / 100;
}

/** getnetAmountToPesos — inversa de pesosToGetnetAmount, ver disclaimer arriba. */
export function getnetAmountToPesos(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`getnetAmountToPesos: monto inválido (${amount})`);
  }
  return n;
}

/**
 * mapEstadoGetnet
 *
 * Traduce el estado que devuelve Getnet al vocabulario que ya usa este
 * proyecto en `pedidos.estado_pago` (ver mpController.js: 'aprobado' /
 * 'pendiente' / 'rechazado'), para que pedidoController.js y el resto del
 * código no tengan que conocer los strings específicos de Getnet.
 *
 * ⚠️ TODO(verificar): los valores de estado de abajo (approved/paid,
 * pending/processing, denied/declined/cancelled) son un supuesto razonable
 * basado en convenciones comunes de gateways de tarjeta — NO fueron
 * confirmados contra una respuesta real de la Regional API ni de Get
 * Checkout (no hay credenciales de sandbox todavía). Confirmar contra
 * developer portal / un pago de prueba real antes de confiar en esto en
 * producción. Mismo criterio de seguridad que mapEstadoPayway(): ante un
 * valor no reconocido, nunca asumir aprobado.
 *
 * @param {string} statusGetnet
 * @returns {'aprobado'|'pendiente'|'rechazado'}
 */
export function mapEstadoGetnet(statusGetnet) {
  const s = String(statusGetnet ?? '').toLowerCase();

  if (s === 'approved' || s === 'paid' || s === 'confirmed') return 'aprobado';
  if (s === 'pending' || s === 'processing' || s === 'in_process' || s === 'authorized') return 'pendiente';
  // 'denied', 'declined', 'cancelled', 'refused', o cualquier valor no
  // reconocido: no asumimos aprobado ante la duda — mejor un falso rechazo
  // revisable a mano que acreditar un pago que no se confirmó.
  return 'rechazado';
}

/**
 * verificarFirmaWebhook
 *
 * ⚠️ TODO(verificar): la doc pública solo confirma "se valida la
 * autenticidad de la notificación haciendo un SHA-256 con la firma
 * proporcionada" — sin especificar si es un HMAC-SHA256 (secreto como key,
 * como ya usa mpWebhook con MP_WEBHOOK_SECRET) o un hash simple del body
 * concatenado con un secreto. Se implementa acá con HMAC-SHA256 por ser el
 * patrón estándar de la industria y el que ya usa este mismo backend para
 * MercadoPago (ver mpController.js) — pero es un supuesto, no un hecho
 * confirmado. Verificar la fórmula exacta contra developer portal /
 * Notificaciones antes de confiar en esto para aceptar dinero real.
 *
 * @param {string} rawBody          — body crudo del webhook, tal cual llegó (string)
 * @param {string} firmaRecibida    — valor del header de firma que manda Getnet
 * @param {string} secret           — GETNET_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verificarFirmaWebhook(rawBody, firmaRecibida, secret) {
  if (!rawBody || !firmaRecibida || !secret) return false;

  const esperada = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  try {
    const bufEsperado = Buffer.from(esperada, 'hex');
    const bufRecibido = Buffer.from(String(firmaRecibida), 'hex');
    return (
      bufEsperado.length > 0 &&
      bufEsperado.length === bufRecibido.length &&
      crypto.timingSafeEqual(bufEsperado, bufRecibido)
    );
  } catch {
    return false;
  }
}
