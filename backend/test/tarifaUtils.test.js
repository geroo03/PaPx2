import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcularTarifa } from '../src/lib/tarifaUtils.js';

test('bici, 3km, sin clima', () => {
  assert.equal(calcularTarifa('bici', 3, false), 3450);
});

test('bici, 5km, sin clima', () => {
  assert.equal(calcularTarifa('bici', 5, false), 4950);
});

test('bici, 10km, sin clima', () => {
  assert.equal(calcularTarifa('bici', 10, false), 8700);
});

test('moto, 3km, sin clima', () => {
  assert.equal(calcularTarifa('moto', 3, false), 4050);
});

test('moto, 5km, sin clima', () => {
  assert.equal(calcularTarifa('moto', 5, false), 5550);
});

test('moto, 10km, sin clima', () => {
  assert.equal(calcularTarifa('moto', 10, false), 9300);
});

test('moto, 5km, con tarifa clima (+20%)', () => {
  assert.equal(calcularTarifa('moto', 5, true), 6650);
});

test('bici, 5km, con tarifa clima (+20%)', () => {
  assert.equal(calcularTarifa('bici', 5, true), 5950);
});

test('sin distancia (cliente no envió coords) → solo tarifa base', () => {
  assert.equal(calcularTarifa('bici', null, false), 1200);
  assert.equal(calcularTarifa('moto', null, false), 1800);
});

test('vehiculo desconocido cae a base de bici', () => {
  assert.equal(calcularTarifa('auto', 5, false), 4950);
  assert.equal(calcularTarifa(undefined, 5, false), 4950);
});

test('vehiculo es case-insensitive', () => {
  assert.equal(calcularTarifa('MOTO', 5, false), 5550);
});
