import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversineKm, rankearCandidatos } from '../src/lib/matchingUtils.js';

// ─── haversineKm ────────────────────────────────────────────────────────────

test('haversineKm: mismo punto da 0', () => {
  assert.equal(haversineKm(-27.7951, -64.2615, -27.7951, -64.2615), 0);
});

test('haversineKm: distancia conocida entre dos puntos de Santiago del Estero (~2.5km)', () => {
  const km = haversineKm(-27.7834, -64.2642, -27.7950, -64.2500);
  assert.ok(km > 1.5 && km < 3, `esperaba ~2-3km, dio ${km}`);
});

// ─── rankearCandidatos ──────────────────────────────────────────────────────
// Nota: cada caso mantiene fijos los otros dos factores (mismo rating, mismo
// idle, o pesos en 0) para que el factor bajo prueba sea el único que puede
// decidir el orden — evita que la magnitud relativa de los otros términos
// contamine la comparación.

const AHORA = new Date('2026-07-30T12:00:00Z');
const RATING_NEUTRO = 5;
const IDLE_RECIENTE = new Date(AHORA.getTime() - 60_000).toISOString(); // hace 1 min, igual para ambos

test('con peso_rating y peso_rotacion en 0, el más cercano gana', () => {
  const config = { radio_km: 10, peso_distancia: 1, peso_rating: 0, peso_rotacion: 0, max_ofertas: 5 };
  const candidatos = [
    { auth_uid: 'lejos', distancia_km: 8, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE },
    { auth_uid: 'cerca', distancia_km: 1, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE },
  ];
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado[0].auth_uid, 'cerca');
});

test('con peso_distancia y peso_rotacion en 0, el de mejor rating gana', () => {
  const config = { radio_km: 10, peso_distancia: 0, peso_rating: 1, peso_rotacion: 0, max_ofertas: 5 };
  const candidatos = [
    { auth_uid: 'rating_bajo', distancia_km: 1, rating: 3, ultima_asignacion_at: IDLE_RECIENTE },
    { auth_uid: 'rating_alto', distancia_km: 8, rating: 5, ultima_asignacion_at: IDLE_RECIENTE },
  ];
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado[0].auth_uid, 'rating_alto');
});

test('con peso_distancia y peso_rating en 0, el que hace más tiempo no recibe un viaje gana', () => {
  const config = { radio_km: 10, peso_distancia: 0, peso_rating: 0, peso_rotacion: 1, max_ofertas: 5 };
  const candidatos = [
    { auth_uid: 'recien_asignado', distancia_km: 1, rating: RATING_NEUTRO, ultima_asignacion_at: new Date(AHORA.getTime() - 60_000).toISOString() },
    { auth_uid: 'hace_rato_idle',  distancia_km: 8, rating: RATING_NEUTRO, ultima_asignacion_at: new Date(AHORA.getTime() - 4 * 3_600_000).toISOString() },
  ];
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado[0].auth_uid, 'hace_rato_idle');
});

test('cadete sin ultima_asignacion_at (nunca asignado) recibe el máximo bonus de rotación, igual que uno con 4+ horas de idle', () => {
  const config = { radio_km: 10, peso_distancia: 0, peso_rating: 0, peso_rotacion: 1, max_ofertas: 5 };
  const candidatos = [
    { auth_uid: 'nuevo_sin_historial', distancia_km: 1, rating: RATING_NEUTRO, ultima_asignacion_at: null },
    { auth_uid: 'recien_asignado',     distancia_km: 1, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE },
  ];
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado[0].auth_uid, 'nuevo_sin_historial');
});

test('score es un empate cuando todos los factores son iguales (orden estable de entrada)', () => {
  const config = { radio_km: 10, peso_distancia: 1, peso_rating: 1, peso_rotacion: 1, max_ofertas: 5 };
  const candidatos = [
    { auth_uid: 'a', distancia_km: 3, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE },
    { auth_uid: 'b', distancia_km: 3, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE },
  ];
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado[0].score, resultado[1].score);
});

test('respeta max_ofertas', () => {
  const config = { radio_km: 10, peso_distancia: 1, peso_rating: 0, peso_rotacion: 0, max_ofertas: 3 };
  const candidatos = Array.from({ length: 10 }, (_, i) => ({
    auth_uid: `c${i}`, distancia_km: i, rating: RATING_NEUTRO, ultima_asignacion_at: IDLE_RECIENTE,
  }));
  const resultado = rankearCandidatos(candidatos, config, AHORA);
  assert.equal(resultado.length, 3);
  assert.equal(resultado[0].auth_uid, 'c0'); // el más cercano sigue primero
});
