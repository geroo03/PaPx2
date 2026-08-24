/**
 * getnet.js
 *
 * ⚠️ WIP — módulo aislado, no importado por cliente.js ni por ningún flujo
 * real de la app todavía. Solo lo usa frontend/getnet-test.html (página de
 * prueba manual, no linkeada desde ningún menú). Ver
 * docs/GETNET-INTEGRACION.md.
 *
 * A diferencia de payway.js (tokenización de tarjeta client-side), Get
 * Checkout es un checkout HOSPEDADO por Getnet — este módulo no maneja
 * datos de tarjeta en ningún momento, mismo alcance PCI mínimo que ya
 * tiene la integración de MercadoPago (ver pago.html). El backend
 * (getnetController.js) crea la orden y devuelve una `checkout_url`; acá
 * solo se decide cómo mostrársela al cliente:
 *
 *   - Modo por defecto (siempre funciona, cero configuración extra):
 *     redirect completo a `checkout_url` — igual que el fallback de
 *     `pago.html` cuando MercadoPago Bricks no está disponible.
 *   - Modo embebido/lightbox (⚠️ NO VERIFICADO): Getnet ofrece estos modos
 *     además del redirect (ver docs.globalgetnet.com/es/products/online-payments/web-checkout),
 *     pero la URL del SDK JS y el nombre del objeto global no están
 *     confirmados — la doc técnica detallada está detrás del developer
 *     portal, mismo bloqueo que hubo con Payway. Si
 *     window.GETNET_CHECKOUT_SDK_URL no está configurada, directamente no
 *     se intenta — se usa el redirect, que no depende de nada de esto.
 */

let sdkCargado = null;

/** Carga el script del SDK embebido de Getnet una sola vez (idempotente). */
function cargarSdkGetnet() {
  if (sdkCargado) return sdkCargado;

  const scriptUrl = window.GETNET_CHECKOUT_SDK_URL;
  if (!scriptUrl) {
    return Promise.reject(new Error(
      'window.GETNET_CHECKOUT_SDK_URL no está configurada — falta confirmar la URL real ' +
      'del SDK embebido de Getnet (ver docs/GETNET-INTEGRACION.md). Usá iniciarCheckout() ' +
      'con modo "redirect", que no depende de esto.'
    ));
  }

  sdkCargado = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = scriptUrl;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`No se pudo cargar el SDK de Getnet desde ${scriptUrl}`));
    document.head.appendChild(s);
  });

  return sdkCargado;
}

/**
 * crearCheckout — llama al backend para armar la orden en Getnet.
 *
 * @param {object} datosPedido — { items, total, comercio_id, cliente_id, direccion_entrega, propina_cadete? }
 * @param {string} authToken   — JWT de la sesión activa (el endpoint usa requireAuth)
 * @returns {Promise<{ checkout_url: string, order_id: string, raw: object }>}
 */
export async function crearCheckout(datosPedido, authToken) {
  const BACKEND_URL = window.BACKEND_URL || 'http://localhost:3000';

  const resp = await fetch(`${BACKEND_URL}/api/getnet/crear-checkout`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body:    JSON.stringify(datosPedido),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error || `crear-checkout falló (HTTP ${resp.status})`);
  }
  if (!data.checkout_url) {
    throw new Error('El backend no devolvió checkout_url — ver getnetClient.js (endpoint/payload sin confirmar).');
  }
  return data;
}

/**
 * iniciarCheckout — arma la orden y lleva al cliente a pagarla.
 *
 * @param {object} datosPedido
 * @param {string} authToken
 * @param {'redirect'|'embebido'} [modo] — default 'redirect' (siempre funciona)
 */
export async function iniciarCheckout(datosPedido, authToken, modo = 'redirect') {
  const { checkout_url } = await crearCheckout(datosPedido, authToken);

  if (modo === 'embebido') {
    // ⚠️ NO VERIFICADO — ver disclaimer arriba. Si falla, no hay fallback
    // automático a redirect acá a propósito: mejor un error explícito que
    // dejar al cliente en una pantalla rota sin saber por qué.
    await cargarSdkGetnet();
    throw new Error(
      'Modo "embebido" no implementado todavía — falta confirmar el nombre del objeto ' +
      'global del SDK de Getnet contra la doc real. Usá modo "redirect".'
    );
  }

  window.location.href = checkout_url;
}
