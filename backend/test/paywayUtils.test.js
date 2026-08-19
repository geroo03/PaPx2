import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pesosToPaywayAmount, paywayAmountToPesos, mapEstadoPayway } from '../src/lib/paywayUtils.js';

test('pesosToPaywayAmount: monto entero simple', () => {
  assert.equal(pesosToPaywayAmount(500), 50000);
});

test('pesosToPaywayAmount: con centavos', () => {
  assert.equal(pesosToPaywayAmount(19.99), 1999);
});

test('pesosToPaywayAmount: no arrastra error de punto flotante', () => {
  assert.equal(pesosToPaywayAmount(1234.5), 123450);
});

test('pesosToPaywayAmount: cero es válido', () => {
  assert.equal(pesosToPaywayAmount(0), 0);
});

test('pesosToPaywayAmount: rechaza negativos', () => {
  assert.throws(() => pesosToPaywayAmount(-1));
});

test('pesosToPaywayAmount: rechaza no-numéricos', () => {
  assert.throws(() => pesosToPaywayAmount('abc'));
});

test('paywayAmountToPesos: inversa de pesosToPaywayAmount', () => {
  assert.equal(paywayAmountToPesos(50000), 500);
  assert.equal(paywayAmountToPesos(1999), 19.99);
});

test('paywayAmountToPesos↔pesosToPaywayAmount: round-trip', () => {
  for (const pesos of [0, 1, 99.99, 500, 1234.5, 78000]) {
    assert.equal(paywayAmountToPesos(pesosToPaywayAmount(pesos)), pesos);
  }
});

test('mapEstadoPayway: approved → aprobado', () => {
  assert.equal(mapEstadoPayway('approved'), 'aprobado');
});

test('mapEstadoPayway: pending/in_process/authorized → pendiente', () => {
  assert.equal(mapEstadoPayway('pending'), 'pendiente');
  assert.equal(mapEstadoPayway('in_process'), 'pendiente');
  assert.equal(mapEstadoPayway('authorized'), 'pendiente');
});

test('mapEstadoPayway: rejected/cancelled → rechazado', () => {
  assert.equal(mapEstadoPayway('rejected'), 'rechazado');
  assert.equal(mapEstadoPayway('cancelled'), 'rechazado');
});

test('mapEstadoPayway: valor desconocido → rechazado (nunca aprobado por default)', () => {
  assert.equal(mapEstadoPayway('algo_no_documentado'), 'rechazado');
  assert.equal(mapEstadoPayway(undefined), 'rechazado');
});

test('mapEstadoPayway: case-insensitive', () => {
  assert.equal(mapEstadoPayway('APPROVED'), 'aprobado');
});
