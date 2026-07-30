/**
 * matchingUtils.js
 *
 * Funciones puras del matching de cadetes. Extraídas de pedidoController.js
 * (difundirPedido/ejecutarDifusion) para poder testearlas sin pegarle a
 * Supabase.
 */

const HORAS_IDLE_TOPE = 4;

/**
 * Distancia en km entre dos coordenadas (fórmula de Haversine).
 */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Ordena candidatos a cadete combinando distancia, rating, y hace cuánto no
 * se le asigna un viaje (fairness/rotación) — en vez de ordenar solo por
 * distancia pura. Menor score = mejor candidato.
 *
 * @param {Array<{auth_uid:string, distancia_km:number, rating?:number, ultima_asignacion_at?:string|null}>} candidatos
 * @param {{radio_km?:number, peso_distancia?:number, peso_rating?:number, peso_rotacion?:number, max_ofertas?:number}} config
 * @param {Date} [ahora] — inyectable para tests; default new Date()
 * @returns {Array} candidatos (con .score agregado) ordenados ascendente por score, recortados a max_ofertas.
 */
export function rankearCandidatos(candidatos, config = {}, ahora = new Date()) {
  const radioKm       = config.radio_km ?? 10;
  const pesoDistancia = config.peso_distancia ?? 1;
  const pesoRating    = config.peso_rating ?? 1;
  const pesoRotacion  = config.peso_rotacion ?? 1;

  const conScore = candidatos.map(c => {
    const distanciaKm = Number(c.distancia_km ?? 0);
    const rating      = Number(c.rating ?? 5);

    let horasIdle = HORAS_IDLE_TOPE;
    if (c.ultima_asignacion_at) {
      const horas = (ahora.getTime() - new Date(c.ultima_asignacion_at).getTime()) / 3_600_000;
      horasIdle = Math.max(0, Math.min(horas, HORAS_IDLE_TOPE));
    }

    const score =
      (distanciaKm / radioKm) * pesoDistancia -
      ((rating - 3) / 2) * pesoRating -
      (horasIdle / HORAS_IDLE_TOPE) * pesoRotacion;

    return { ...c, score };
  });

  conScore.sort((a, b) => a.score - b.score);

  const maxOfertas = config.max_ofertas ?? conScore.length;
  return conScore.slice(0, maxOfertas);
}
