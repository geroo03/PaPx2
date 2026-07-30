import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esClimaAdverso } from '../src/lib/climaUtils.js';

// Códigos de wttr.in (WorldWeatherOnline) — misma clasificación que ya usaba
// frontend/assets/js/cliente.js (cargarClima, decorativa) antes de esta
// automatización.

test('soleado (113) no es adverso', () => {
  assert.equal(esClimaAdverso(113), false);
});

test('parcialmente nublado (116) no es adverso', () => {
  assert.equal(esClimaAdverso(116), false);
});

test('nublado (119, 122) no es adverso', () => {
  assert.equal(esClimaAdverso(119), false);
  assert.equal(esClimaAdverso(122), false);
});

test('niebla (143, 248, 260) no es adverso', () => {
  assert.equal(esClimaAdverso(143), false);
  assert.equal(esClimaAdverso(248), false);
  assert.equal(esClimaAdverso(260), false);
});

test('lluvia liviana (176, 179) es adverso', () => {
  assert.equal(esClimaAdverso(176), true);
  assert.equal(esClimaAdverso(179), true);
});

test('tormenta (200, 386, 389, 392, 395) es adverso', () => {
  for (const code of [200, 386, 389, 392, 395]) {
    assert.equal(esClimaAdverso(code), true, `code ${code} debería ser adverso`);
  }
});

test('nieve/aguanieve/granizo (323, 335, 371) es adverso', () => {
  for (const code of [323, 335, 371]) {
    assert.equal(esClimaAdverso(code), true, `code ${code} debería ser adverso`);
  }
});

test('sin código (null/undefined) no es adverso', () => {
  assert.equal(esClimaAdverso(null), false);
  assert.equal(esClimaAdverso(undefined), false);
});

test('precipMM no afecta el resultado todavía (decisión de producto: sin filtro de mm por ahora)', () => {
  assert.equal(esClimaAdverso(176, 0.1), true);
  assert.equal(esClimaAdverso(176, 50), true);
  assert.equal(esClimaAdverso(113, 50), false);
});
