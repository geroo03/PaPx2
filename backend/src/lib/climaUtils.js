/**
 * climaUtils.js
 *
 * Clasificación de códigos de clima de wttr.in (WorldWeatherOnline). Misma
 * clasificación que ya usaba frontend/assets/js/cliente.js (cargarClima,
 * puramente decorativa) — acá se reutiliza para decidir si corresponde
 * aplicar la tarifa por clima automáticamente.
 */

// Códigos de despejado/nublado/niebla — NO cuentan como clima adverso.
// Ojo: 248 y 260 (niebla / niebla congelante) son numéricamente >= 176 pero
// siguen siendo niebla, no lluvia — por eso se excluyen explícitamente en
// vez de usar solo un corte numérico.
const CODES_NO_ADVERSOS = new Set([113, 116, 119, 122, 143, 248, 260]);

// A partir de 176 (y fuera del set de arriba) el catálogo de wttr.in son
// variantes de lluvia/nieve/tormenta/granizo — incluye a las tormentas
// (200,386,389,392,395) y nieve/aguanieve (179,182,185,323,326,329,332,335,
// 338,350,368,371), que numéricamente ya caen dentro de ese rango.
const CODE_UMBRAL_ADVERSO = 176;

/**
 * @param {number} weatherCode — código de wttr.in (`current_condition[0].weatherCode`).
 * @param {number|null} [precipMM] — no se usa para la decisión todavía (a
 *   propósito — decisión de producto: cualquier código de lluvia/tormenta/
 *   granizo dispara el +20%, sin filtro de milímetros por ahora). Se deja
 *   en la firma para poder afinar el umbral más adelante sin cambiar el
 *   call site.
 * @returns {boolean}
 */
export function esClimaAdverso(weatherCode, precipMM = null) {
  const code = Number(weatherCode ?? 0);
  if (CODES_NO_ADVERSOS.has(code)) return false;
  return code >= CODE_UMBRAL_ADVERSO;
}
