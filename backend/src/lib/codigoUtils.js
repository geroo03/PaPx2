/**
 * codigoUtils.js
 *
 * Códigos de retiro/entrega (PIN 4 dígitos). Extraído de pedidoController.js
 * para poder testearlo sin pegarle a Supabase.
 */

import crypto from 'node:crypto';

/**
 * Genera un código numérico de 4 dígitos como string con ceros a la izquierda.
 * Ejemplos: "0432", "9999", "0001"
 *
 * crypto.randomInt(min, max) es CSPRNG — a diferencia de Math.random(), no es
 * predecible. Rango [0, 10000) → 0 a 9999 → siempre 4 dígitos con padStart.
 */
export function generarCodigo4Digitos() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Comparación de códigos en tiempo constante (previene timing attacks).
// Ambos strings se normalizan a 4 chars para que los buffers tengan igual longitud.
export function codigosIguales(a, b) {
  try {
    const ba = Buffer.from(String(a ?? '').slice(0, 4).padEnd(4, '\0'));
    const bb = Buffer.from(String(b ?? '').slice(0, 4).padEnd(4, '\0'));
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}
