import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generarCodigo4Digitos, codigosIguales } from '../src/lib/codigoUtils.js';

test('generarCodigo4Digitos siempre devuelve 4 dígitos', () => {
  for (let i = 0; i < 1000; i++) {
    const codigo = generarCodigo4Digitos();
    assert.match(codigo, /^\d{4}$/);
  }
});

test('codigosIguales: mismos códigos → true', () => {
  assert.equal(codigosIguales('1234', '1234'), true);
  assert.equal(codigosIguales('0000', '0000'), true);
});

test('codigosIguales: códigos distintos → false', () => {
  assert.equal(codigosIguales('1234', '5678'), false);
});

test('codigosIguales: longitudes distintas → false', () => {
  assert.equal(codigosIguales('12', '1200'), false);
});

test('codigosIguales: nunca tira excepción con input raro', () => {
  assert.doesNotThrow(() => codigosIguales(undefined, '1234'));
  assert.doesNotThrow(() => codigosIguales(12345678901234, '1234'));
});
