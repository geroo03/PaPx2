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

/**
 * Envuelve el History API para SPA seguras sin romper state
 * @param {string} screenId - ID de la pantalla a ir
 */
export function navigateSeguro(screenId) {
  // Push state en la historia
  history.pushState({ screen: screenId }, "", `?view=${screenId}`);
  
  // Cambiamos pantallas visualmente
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById('s-' + screenId);
  if (target) target.classList.add('active');

  // Manejo de clase active en la nav
  document.querySelectorAll('.nav-i').forEach(n => n.classList.remove('active'));
  const navMap = {
    home: 'nav-home',
    pedidos: 'nav-pedidos',
    'pedido-detalle': 'nav-pedidos',
    carrito: 'nav-carrito',
    perfil: 'nav-perfil',
    soporte: 'nav-soporte',
    'chat-reporte': 'nav-soporte',
    asistente: 'nav-soporte'
  };
  if (navMap[screenId]) {
    const navItem = document.getElementById(navMap[screenId]);
    if (navItem) navItem.classList.add('active');
  }
}
