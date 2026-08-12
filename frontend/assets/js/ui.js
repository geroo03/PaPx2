// assets/js/ui.js

/**
 * Sanitiza un string para evitar inyecciones XSS al usar innerHTML.
 * Escapa & < > " ' -- mismo patrón ya usado (triplicado, idéntico) en
 * admin.html/pago.html/cadete.js antes de esta consolidación (2026-08-11).
 * Preserva 0/false (solo null/undefined se convierten en '').
 * @param {*} str - El valor a sanitizar (se convierte a string)
 * @returns {string} - Texto seguro
 */
export function sanitizeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Helper para formatear precio a moneda ARS
 * @param {number} num - Precio
 * @returns {string} - Precio formateado
 */
export function formatARS(num) {
  return '$' + Number(num).toLocaleString('es-AR');
}

/**
 * Conecta un botón "mostrar/ocultar contraseña" (ícono de ojo) a su input.
 * Espera dentro del botón un <svg class="eye-open"> y otro class="eye-closed"
 * que se togglean por display. Mismo patrón ya usado (parametrizado) en
 * registro-comercio.html antes de esta consolidación (2026-08-11).
 * @param {string} btnId - id del botón con los dos ícono de ojo adentro
 * @param {string} inputId - id del <input type="password">
 */
export function bindPasswordToggle(btnId, inputId) {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (!btn || !inp) return;
  const eyeOpen   = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');
  btn.addEventListener('click', () => {
    const isPass = inp.type === 'password';
    inp.type = isPass ? 'text' : 'password';
    if (eyeOpen)   eyeOpen.style.display   = isPass ? 'none'  : 'block';
    if (eyeClosed) eyeClosed.style.display = isPass ? 'block' : 'none';
    btn.setAttribute('aria-label', isPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
    inp.focus();
  });
}
