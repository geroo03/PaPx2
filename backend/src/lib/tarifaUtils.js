/**
 * tarifaUtils.js
 *
 * Fórmula de pago al cadete. Extraído de pedidoController.js (difundirPedido)
 * para poder testearlo sin pegarle a Supabase.
 */

export const TARIFA_POR_KM = 750;
export const TARIFA_BASE_VEHICULO = { moto: 1800, bici: 1200 };

/**
 * @param {string} vehiculo     — 'moto' | 'bici' (case-insensitive). Cualquier
 *                                otro valor cae a la base de bici.
 * @param {number|null} distanciaKm — distancia comercio→cliente. Si es null
 *                                    (el cliente no envió coords), se cobra
 *                                    solo la tarifa base, sin adicional por km.
 * @param {boolean} tarifaClima — si está activo, +20% sobre el resultado.
 * @returns {number} ganancia final, redondeada a múltiplos de $50.
 */
export function calcularTarifa(vehiculo, distanciaKm, tarifaClima) {
  const veh  = (vehiculo ?? '').toLowerCase();
  const base = TARIFA_BASE_VEHICULO[veh] ?? TARIFA_BASE_VEHICULO.bici;

  const gananciaBase = (distanciaKm !== null && distanciaKm !== undefined)
    ? Math.round((base + distanciaKm * TARIFA_POR_KM) / 50) * 50
    : base;

  return tarifaClima
    ? Math.round((gananciaBase * 1.20) / 50) * 50
    : gananciaBase;
}
