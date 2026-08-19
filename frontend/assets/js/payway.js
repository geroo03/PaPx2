/**
 * payway.js
 *
 * ⚠️ WIP — módulo aislado, no importado por cliente.js ni por ningún flujo
 * real de la app todavía. Solo lo usa frontend/payway-test.html (página de
 * prueba manual, no linkeada desde ningún menú). Ver docs/PAYWAY-INTEGRACION.md.
 *
 * Tokeniza los datos de tarjeta client-side contra la API de Payway, para
 * que el backend (paywayController.js) nunca reciba el número de tarjeta
 * crudo — mismo motivo que existe la Public Key de MercadoPago en pago.html,
 * pero acá el SDK arma el token en vez de un botón/checkout completo.
 *
 * ⚠️ NO VERIFICADO: la URL del SDK JS de Payway y el nombre exacto del
 * objeto global NO están confirmados — la doc pública
 * (developers.payway.com.ar) es una SPA que no se pudo scrapear. Lo de acá
 * abajo sigue el patrón conocido de "Decidir.js" (misma infra que Payway,
 * ver paywayClient.js), pero hace falta:
 *   1. Conseguir acceso a developers.payway.com.ar (cuenta comercial) y
 *      confirmar la URL real del script y el nombre del objeto global.
 *   2. Setear esa URL real en window.PAYWAY_JS_SDK_URL (env.js) — sin esto,
 *      cargarSdkPayway() rechaza con un error explícito en vez de fallar
 *      silenciosamente contra una URL adivinada.
 */

let sdkCargado = null;

/** Carga el script del SDK de Payway una sola vez (idempotente). */
function cargarSdkPayway() {
  if (sdkCargado) return sdkCargado;

  const scriptUrl = window.PAYWAY_JS_SDK_URL;
  if (!scriptUrl) {
    return Promise.reject(new Error(
      'window.PAYWAY_JS_SDK_URL no está configurada — falta confirmar la URL real ' +
      'del SDK de Payway (ver docs/PAYWAY-INTEGRACION.md) antes de poder tokenizar nada.'
    ));
  }

  sdkCargado = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = scriptUrl;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar el SDK de Payway desde ${scriptUrl}`));
    document.head.appendChild(s);
  });

  return sdkCargado;
}

/**
 * tokenizarTarjeta
 *
 * @param {object} datosTarjeta
 * @param {string} datosTarjeta.numero          — sin espacios
 * @param {string} datosTarjeta.mesExpiracion    — "MM"
 * @param {string} datosTarjeta.anioExpiracion   — "AA" o "AAAA" (confirmar formato esperado)
 * @param {string} datosTarjeta.titular          — nombre tal cual figura en la tarjeta
 * @param {string} datosTarjeta.codigoSeguridad  — CVV
 * @param {string} datosTarjeta.dniTipo          — ej. "dni"
 * @param {string} datosTarjeta.dniNumero
 * @returns {Promise<{ token: string, bin: string }>}
 */
export async function tokenizarTarjeta(datosTarjeta) {
  const numero = String(datosTarjeta.numero || '').replace(/\s+/g, '');
  if (numero.length < 6) {
    throw new Error('Número de tarjeta inválido');
  }
  const bin = numero.slice(0, 6);

  await cargarSdkPayway();

  // ⚠️ NO VERIFICADO: nombre del objeto global (`window.Decidir` es lo que
  // usa Decidir.js) y forma exacta de la llamada. Confirmar contra la doc
  // real antes de usar esto en serio — ver cabecera del archivo.
  if (typeof window.Decidir !== 'function' && typeof window.Payway !== 'function') {
    throw new Error(
      'El SDK de Payway se cargó pero no expone el objeto global esperado ' +
      '(ni window.Decidir ni window.Payway) — confirmar el nombre real contra la doc.'
    );
  }

  const PublishableClient = window.Decidir || window.Payway;
  const cliente = new PublishableClient(window.PAYWAY_PUBLIC_KEY, window.PAYWAY_ENV !== 'production');

  const payload = {
    card_number:            numero,
    card_expiration_month:  String(datosTarjeta.mesExpiracion || '').padStart(2, '0'),
    card_expiration_year:   String(datosTarjeta.anioExpiracion || ''),
    card_holder_name:       String(datosTarjeta.titular || ''),
    security_code:          String(datosTarjeta.codigoSeguridad || ''),
    card_holder_identification: {
      type:   String(datosTarjeta.dniTipo || 'dni'),
      number: String(datosTarjeta.dniNumero || ''),
    },
  };

  return new Promise((resolve, reject) => {
    cliente.createToken(payload, (status, response) => {
      if (status !== 200 && status !== 201) {
        return reject(new Error(response?.error?.message || `Tokenización falló (HTTP ${status})`));
      }
      resolve({ token: response.id, bin });
    });
  });
}
