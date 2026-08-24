import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  pesosToGetnetAmount,
  getnetAmountToPesos,
  mapEstadoGetnet,
  verificarFirmaWebhook,
} from '../src/lib/getnetUtils.js';

test('pesosToGetnetAmount: identidad (formato sin confirmar, ver disclaimer)', () => {
  assert.equal(pesosToGetnetAmount(500), 500);
  assert.equal(pesosToGetnetAmount(19.99), 19.99);
});

test('pesosToGetnetAmount: cero es válido', () => {
  assert.equal(pesosToGetnetAmount(0), 0);
});

test('pesosToGetnetAmount: rechaza negativos', () => {
  assert.throws(() => pesosToGetnetAmount(-1));
});

test('pesosToGetnetAmount: rechaza no-numéricos', () => {
  assert.throws(() => pesosToGetnetAmount('abc'));
});

test('getnetAmountToPesos↔pesosToGetnetAmount: round-trip', () => {
  for (const pesos of [0, 1, 99.99, 500, 1234.5, 78000]) {
    assert.equal(getnetAmountToPesos(pesosToGetnetAmount(pesos)), pesos);
  }
});

test('mapEstadoGetnet: approved/paid/confirmed → aprobado', () => {
  assert.equal(mapEstadoGetnet('approved'), 'aprobado');
  assert.equal(mapEstadoGetnet('paid'), 'aprobado');
  assert.equal(mapEstadoGetnet('confirmed'), 'aprobado');
});

test('mapEstadoGetnet: pending/processing/in_process/authorized → pendiente', () => {
  assert.equal(mapEstadoGetnet('pending'), 'pendiente');
  assert.equal(mapEstadoGetnet('processing'), 'pendiente');
  assert.equal(mapEstadoGetnet('in_process'), 'pendiente');
  assert.equal(mapEstadoGetnet('authorized'), 'pendiente');
});

test('mapEstadoGetnet: denied/declined/cancelled/refused → rechazado', () => {
  assert.equal(mapEstadoGetnet('denied'), 'rechazado');
  assert.equal(mapEstadoGetnet('declined'), 'rechazado');
  assert.equal(mapEstadoGetnet('cancelled'), 'rechazado');
  assert.equal(mapEstadoGetnet('refused'), 'rechazado');
});

test('mapEstadoGetnet: valor desconocido → rechazado (nunca aprobado por default)', () => {
  assert.equal(mapEstadoGetnet('algo_no_documentado'), 'rechazado');
  assert.equal(mapEstadoGetnet(undefined), 'rechazado');
});

test('mapEstadoGetnet: case-insensitive', () => {
  assert.equal(mapEstadoGetnet('APPROVED'), 'aprobado');
});

test('verificarFirmaWebhook: acepta una firma HMAC-SHA256 válida', () => {
  const secret  = 'test-secret';
  const body    = JSON.stringify({ order_id: '123', status: 'approved' });
  const firma   = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verificarFirmaWebhook(body, firma, secret), true);
});

test('verificarFirmaWebhook: rechaza una firma inválida', () => {
  const secret = 'test-secret';
  const body   = JSON.stringify({ order_id: '123', status: 'approved' });
  assert.equal(verificarFirmaWebhook(body, 'firma-cualquiera', secret), false);
});

test('verificarFirmaWebhook: rechaza si falta body, firma o secret', () => {
  assert.equal(verificarFirmaWebhook('', 'firma', 'secret'), false);
  assert.equal(verificarFirmaWebhook('body', '', 'secret'), false);
  assert.equal(verificarFirmaWebhook('body', 'firma', ''), false);
});

test('verificarFirmaWebhook: no revienta con una firma no-hex', () => {
  assert.equal(verificarFirmaWebhook('body', 'no-es-hex-válido!!', 'secret'), false);
});
