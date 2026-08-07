// assets/js/ui.js

/**
 * Sanitiza un string para evitar inyecciones XSS al usar innerHTML
 * @param {string} str - El texto a sanitizar
 * @returns {string} - Texto seguro
 */
export function sanitizeHTML(str) {
  if (typeof str !== 'string') return str;
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Helper para formatear precio a moneda ARS
 * @param {number} num - Precio
 * @returns {string} - Precio formateado
 */
export function formatARS(num) {
  return '$' + Number(num).toLocaleString('es-AR');
}
