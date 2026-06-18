/**
 * calcularComision
 *
 * Calcula la comisión del embajador según el tiempo transcurrido
 * desde el inicio del patrocinio.
 *
 * Regla de negocio:
 *   < 6 meses  → tasa 5%  del monto base del pedido
 *   >= 6 meses → tasa 2%  del monto base del pedido
 *
 * El cálculo se hace en el backend en el momento de cerrar el pedido
 * para que la tasa sea siempre la correcta según la fecha real.
 *
 * @param {string|Date} fechaInicioPatrocinio
 * @param {number}      montoBase  — subtotal del pedido (antes de fee de plataforma)
 * @returns {{ tasa: number, porcentaje: string, monto: number, mesesActivo: number }}
 */
export function calcularComision(fechaInicioPatrocinio, montoBase) {
  const inicio = new Date(fechaInicioPatrocinio);
  const ahora  = new Date();

  const mesesActivo =
    (ahora.getFullYear() - inicio.getFullYear()) * 12 +
    (ahora.getMonth()    - inicio.getMonth());

  const tasa  = mesesActivo < 6 ? 0.05 : 0.02;
  const monto = Math.round(Number(montoBase) * tasa * 100) / 100;

  return {
    tasa,
    porcentaje: tasa === 0.05 ? '5%' : '2%',
    monto,
    mesesActivo,
  };
}
