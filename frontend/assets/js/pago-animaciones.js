/**
 * pago-animaciones.js — animaciones de tarjeta para el flujo de pago.
 *
 * ⚠️ Componente autónomo: NO está cableado a ningún flujo de pago real
 * todavía. Se construyó por adelantado para Getnet, que sigue bloqueada
 * esperando las credenciales de sandbox (ver docs/GETNET-INTEGRACION.md en la
 * rama work/2026-08-24-getnet-integracion). Cuando lleguen, `getnet.js` lo
 * enchufa en `iniciarCheckout()` — ver "Cómo se enchufa" abajo.
 *
 * Getnet usa Get Checkout HOSPEDADO: la app nunca ve ni pide datos de tarjeta.
 * Por eso acá no hay ningún formulario ni input — la tarjeta es decorativa (los
 * dígitos son placeholders fijos) y el overlay solo cubre el hueco entre que se
 * crea la orden y el checkout hospedado toma el control.
 *
 * Requiere assets/css/pago-animaciones.css.
 *
 * ── API ────────────────────────────────────────────────────────────────────
 *   renderTarjeta(el, { tipo, marca, titular, flip })
 *   mostrarProcesando({ mensaje, submensaje, tipo })
 *   actualizarProcesando(estado, { mensaje, submensaje })   // 'aprobado' | 'rechazado'
 *   ocultarProcesando()
 *
 * ── Cómo se enchufa (cuando haya credenciales) ─────────────────────────────
 *   import { mostrarProcesando, actualizarProcesando, ocultarProcesando }
 *     from './pago-animaciones.js';
 *
 *   mostrarProcesando({ mensaje: 'Preparando tu pago seguro...' });
 *   try {
 *     await iniciarCheckout(datosPedido, token);   // getnet.js — redirige
 *   } catch (e) {
 *     actualizarProcesando('rechazado', { mensaje: 'No pudimos iniciar el pago' });
 *   }
 *
 * Al volver del checkout, pago.html lee el resultado y llama a
 * actualizarProcesando('aprobado' | 'rechazado', ...) antes de navegar.
 */

import { sanitizeHTML } from './ui.js';

const ID_OVERLAY = 'pap-pago-overlay';

/** overflow del body previo a abrir el overlay, para restaurarlo al cerrarlo. */
let scrollPrevio = '';

/** Marca por defecto de cada tipo. Nada de esto viaja a ningún lado: es texto. */
const ETIQUETA_TIPO = {
  credito: 'Crédito',
  debito:  'Débito',
};

/**
 * Dibuja una tarjeta decorativa dentro de `el`.
 *
 * @param {HTMLElement} el        Contenedor. Se reemplaza su contenido.
 * @param {object}      [op]
 * @param {'credito'|'debito'} [op.tipo='credito']
 * @param {string}      [op.marca='Puerta a Puerta X']  Texto del ángulo superior izquierdo.
 * @param {string}      [op.titular='TITULAR']
 * @param {boolean}     [op.flip=false]   Arranca mostrando el dorso.
 * @returns {HTMLElement|null} El nodo .pap-card, para poder togglear .is-flipped.
 */
export function renderTarjeta(el, op = {}) {
  if (!el) return null;

  const tipo     = op.tipo === 'debito' ? 'debito' : 'credito';
  const marca    = sanitizeHTML(op.marca ?? 'Puerta a Puerta X');
  const titular  = sanitizeHTML(op.titular ?? 'TITULAR');
  const etiqueta = sanitizeHTML(ETIQUETA_TIPO[tipo]);

  el.innerHTML = `
    <div class="pap-card-wrap">
      <div class="pap-card pap-card--${tipo}${op.flip ? ' is-flipped' : ''}"
           role="img"
           aria-label="Tarjeta de ${etiqueta.toLowerCase()} (ilustración)">
        <div class="pap-card-face pap-card-face--front">
          <div class="pap-card-top">
            <span class="pap-card-marca">${marca}</span>
            <span class="pap-card-tipo">${etiqueta}</span>
          </div>
          <div class="pap-card-chip" aria-hidden="true"></div>
          <div class="pap-card-numero" aria-hidden="true">•••• •••• •••• ••••</div>
          <div class="pap-card-pie">
            <span>${titular}</span>
            <span>••/••</span>
          </div>
        </div>
        <div class="pap-card-face pap-card-face--back">
          <div class="pap-card-banda" aria-hidden="true"></div>
          <div class="pap-card-firma" aria-hidden="true"></div>
          <p class="pap-card-aviso">
            Ilustración. Puerta a Puerta X nunca te pide los datos de tu tarjeta:
            se cargan en el sitio seguro del procesador de pagos.
          </p>
        </div>
      </div>
    </div>`;

  return el.querySelector('.pap-card');
}

/** Da vuelta una tarjeta ya renderizada. */
export function girarTarjeta(cardEl) {
  cardEl?.classList.toggle('is-flipped');
}

/**
 * Muestra el overlay de "procesando pago". Idempotente: si ya hay uno abierto,
 * lo reutiliza en vez de apilar otro.
 *
 * @param {object} [op]
 * @param {string} [op.mensaje='Procesando tu pago...']
 * @param {string} [op.submensaje]
 * @param {'credito'|'debito'} [op.tipo='credito']
 * @returns {HTMLElement} El overlay.
 */
export function mostrarProcesando(op = {}) {
  let overlay = document.getElementById(ID_OVERLAY);

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = ID_OVERLAY;
    overlay.className = 'pap-pago-overlay';
    // El overlay tapa la pantalla entera: hay que anunciarlo a los lectores
    // y no dejar que el foco se escape a lo que quedó abajo.
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    document.body.appendChild(overlay);
    // El overlay tapa todo: si el fondo sigue scrolleando, en el celular se
    // siente como que la app se movió sola mientras se procesa el pago.
    scrollPrevio = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  overlay.dataset.estado = 'procesando';
  overlay.innerHTML = `
    <div class="pap-pago-tarjeta"></div>
    <div class="pap-pago-barra" aria-hidden="true"></div>
    <p class="pap-pago-msg"></p>
    <p class="pap-pago-sub"></p>`;

  renderTarjeta(overlay.querySelector('.pap-pago-tarjeta'), { tipo: op.tipo });
  escribirTextos(overlay, {
    mensaje:    op.mensaje    ?? 'Procesando tu pago...',
    submensaje: op.submensaje ?? 'No cierres la app ni toques atrás.',
  });

  return overlay;
}

/**
 * Pasa el overlay a su estado final. Si no hay overlay abierto, lo abre —
 * así sirve también para mostrar el resultado al volver del checkout
 * hospedado, cuando la pantalla se recargó y el overlay original ya no existe.
 *
 * @param {'aprobado'|'rechazado'} estado
 * @param {object} [op]
 * @param {string} [op.mensaje]
 * @param {string} [op.submensaje]
 */
export function actualizarProcesando(estado, op = {}) {
  const ok = estado === 'aprobado';
  const overlay = document.getElementById(ID_OVERLAY) ?? mostrarProcesando();

  overlay.dataset.estado = ok ? 'aprobado' : 'rechazado';

  const barra = overlay.querySelector('.pap-pago-barra');
  if (barra) barra.remove();

  if (!overlay.querySelector('.pap-pago-icono')) {
    const icono = document.createElement('div');
    icono.className = `pap-pago-icono pap-pago-icono--${ok ? 'ok' : 'error'}`;
    icono.innerHTML = ok
      ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`
      : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
    overlay.insertBefore(icono, overlay.querySelector('.pap-pago-msg'));
  }

  escribirTextos(overlay, {
    mensaje:    op.mensaje    ?? (ok ? '¡Pago aprobado!' : 'El pago fue rechazado'),
    submensaje: op.submensaje ?? (ok ? '' : 'No se te cobró nada. Podés intentar con otro medio de pago.'),
  });
}

/** Cierra el overlay. Seguro de llamar aunque no haya ninguno abierto. */
export function ocultarProcesando() {
  const overlay = document.getElementById(ID_OVERLAY);
  if (!overlay) return;
  overlay.remove();
  document.body.style.overflow = scrollPrevio;
}

/** textContent, no innerHTML: estos textos pueden venir de un error del backend. */
function escribirTextos(overlay, { mensaje, submensaje }) {
  const elMsg = overlay.querySelector('.pap-pago-msg');
  const elSub = overlay.querySelector('.pap-pago-sub');
  if (elMsg) elMsg.textContent = mensaje ?? '';
  if (elSub) {
    elSub.textContent = submensaje ?? '';
    elSub.style.display = submensaje ? '' : 'none';
  }
}

// Puente para páginas que todavía usan <script> clásico inline (pago.html).
// Los módulos ES se difieren, así que window.papPago existe recién después del
// parseo — sirve para handlers (onclick, callbacks), no para código que corre
// durante el parseo del HTML.
if (typeof window !== 'undefined') {
  window.papPago = { renderTarjeta, girarTarjeta, mostrarProcesando, actualizarProcesando, ocultarProcesando };
}
