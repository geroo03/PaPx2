/**
 * paywayUtils.js
 *
 * Funciones puras (sin red, sin DB) para la integración con Payway —
 * separadas de paywayClient.js para poder testearlas sin credenciales
 * reales, igual que comisionUtils.js/tarifaUtils.js. Ver
 * backend/test/paywayUtils.test.js y docs/PAYWAY-INTEGRACION.md.
 *
 * ⚠️ WIP — Payway todavía no está conectado al flujo real de pedidos.
 * Ver docs/PAYWAY-INTEGRACION.md para el estado y qué falta.
 */

/**
 * pesosToPaywayAmount
 *
 * La API de Payway/Decidir espera el monto como entero donde los últimos
 * DOS dígitos son los centavos (ej. $500,00 ARS → 50000). Confirmado en el
 * SDK oficial (payway-ar/sdk-php-ventaonline): "The amount field uses the
 * last two digits as decimals."
 *
 * @param {number} pesos — monto en ARS con hasta 2 decimales (ej. 1234.5)
 * @returns {number} entero listo para mandar como `amount` a Payway
 */
export function pesosToPaywayAmount(pesos) {
  const n = Number(pesos);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`pesosToPaywayAmount: monto inválido (${pesos})`);
  }
  // Redondeo a centavos antes de escalar, para no arrastrar errores de
  // punto flotante (ej. 19.99 * 100 = 1998.9999999999998 sin este paso).
  return Math.round(Math.round(n * 100));
}

/**
 * paywayAmountToPesos — inversa de pesosToPaywayAmount, para mostrar/loguear
 * montos que vienen de una respuesta de Payway (ej. PaymentInfo).
 *
 * @param {number} amount — entero en formato Payway (ej. 50000)
 * @returns {number} pesos ARS con 2 decimales (ej. 500)
 */
export function paywayAmountToPesos(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`paywayAmountToPesos: monto inválido (${amount})`);
  }
  return Math.round(n) / 100;
}

/**
 * mapEstadoPayway
 *
 * Traduce el `status` que devuelve Payway/Decidir al vocabulario que ya usa
 * este proyecto en `pedidos.estado_pago` (ver mpController.js: 'aprobado' /
 * 'pendiente' / 'rechazado'), para que pedidoController.js y el resto del
 * código no tengan que conocer los strings específicos de Payway.
 *
 * ⚠️ Los valores exactos de `status` de Payway (approved/rejected/etc.) están
 * tomados de la doc pública de Decidir (misma infra, ver docs/PAYWAY-INTEGRACION.md)
 * pero NO fueron verificados contra una respuesta real todavía — no hay
 * credenciales de sandbox. Confirmar contra un pago de prueba real antes de
 * confiar en este mapeo en producción.
 *
 * @param {string} statusPayway
 * @returns {'aprobado'|'pendiente'|'rechazado'}
 */
export function mapEstadoPayway(statusPayway) {
  const s = String(statusPayway ?? '').toLowerCase();

  if (s === 'approved') return 'aprobado';
  if (s === 'pending' || s === 'in_process' || s === 'authorized') return 'pendiente';
  // 'rejected', 'cancelled', 'error', o cualquier valor no reconocido: no
  // asumimos aprobado ante la duda — mejor un falso rechazo revisable a mano
  // que acreditar un pago que no se confirmó.
  return 'rechazado';
}
