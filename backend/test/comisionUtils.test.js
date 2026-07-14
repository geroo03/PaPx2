import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularComision } from '../src/lib/comisionUtils.js';

// haceMeses(n) devuelve una fecha tal que mesesActivo (dentro de calcularComision) da n.
function haceMeses(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

test('mesesActivo=0 (recién arrancado) → tasa 5%', () => {
  const r = calcularComision(haceMeses(0), 10000);
  assert.equal(r.tasa, 0.05);
  assert.equal(r.porcentaje, '5%');
  assert.equal(r.monto, 500);
});

test('mesesActivo=5 (último mes de la banda del 5%) → sigue en 5%', () => {
  const r = calcularComision(haceMeses(5), 10000);
  assert.equal(r.tasa, 0.05);
});

test('mesesActivo=6 (primer mes de la banda del 2%) → tasa 2%', () => {
  const r = calcularComision(haceMeses(6), 10000);
  assert.equal(r.tasa, 0.02);
  assert.equal(r.porcentaje, '2%');
  assert.equal(r.monto, 200);
});

test('mesesActivo=11 (último mes de la banda del 2%) → sigue en 2%', () => {
  const r = calcularComision(haceMeses(11), 10000);
  assert.equal(r.tasa, 0.02);
});

test('mesesActivo=12 (primer mes sin comisión) → tasa 0%', () => {
  const r = calcularComision(haceMeses(12), 10000);
  assert.equal(r.tasa, 0);
  assert.equal(r.porcentaje, '0%');
  assert.equal(r.monto, 0);
});

test('mesesActivo=24 → sigue en 0%', () => {
  const r = calcularComision(haceMeses(24), 10000);
  assert.equal(r.tasa, 0);
});

test('redondea el monto a centavos', () => {
  const r = calcularComision(haceMeses(0), 33.333);
  assert.equal(r.monto, 1.67); // 33.333 * 0.05 = 1.66665 → round a 1.67
});
