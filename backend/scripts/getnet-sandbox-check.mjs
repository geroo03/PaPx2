#!/usr/bin/env node
/**
 * getnet-sandbox-check.mjs — Diagnóstico manual contra el sandbox real de Getnet.
 *
 * ⚠️ WIP — para usar el día que exista una cuenta comercial de Getnet con
 * credenciales de sandbox (`GETNET_CLIENT_ID`/`GETNET_CLIENT_SECRET`/
 * `GETNET_SELLER_ID` en `backend/.env`). Ver docs/GETNET-INTEGRACION.md y
 * docs/GETNET-SANDBOX-TESTING.md para el plan completo de pruebas — esto es
 * solo el primer paso automatizado: confirma auth + creación de orden antes
 * de pasar a las pruebas manuales con tarjetas de prueba.
 *
 * A diferencia de qa-e2e.mjs (que pega contra producción real sin tocar
 * datos existentes), este script pega contra el AMBIENTE SANDBOX de Getnet
 * — no mueve plata real ni toca Supabase (no crea pedidos; eso solo pasa
 * cuando el webhook real confirma un pago, que este script no simula).
 *
 * Qué hace, en orden, deteniéndose en el primer paso que falle:
 *   1. Verifica que las 3 variables de entorno necesarias estén seteadas.
 *   2. Pide un access_token (OAuth2 client_credentials) — esto SÍ está
 *      confirmado contra la doc pública, así que un fallo acá casi seguro
 *      es un problema de credenciales, no del código.
 *   3. Intenta crear un checkout de prueba ($100 ARS) — esto NO está
 *      verificado contra la API real (ver disclaimer en getnetClient.js).
 *      Si falla acá, es información valiosa: hay que ajustar el path/
 *      payload de crearCheckout() según lo que responda la API real.
 *   4. Si el paso 3 dio un order_id, intenta reconsultarlo.
 *   5. Prueba la verificación de firma de webhook con datos simulados
 *      (esto es 100% local/puro, no depende de la red — confirma que la
 *      lógica de verificarFirmaWebhook() funciona, no que el formato real
 *      de Getnet coincida).
 *
 * Uso:
 *   cd backend && npm run test:getnet-sandbox
 *   (o: node scripts/getnet-sandbox-check.mjs — necesita backend/.env con
 *   GETNET_ENV=sandbox y las credenciales de sandbox reales)
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { obtenerAccessToken, crearCheckout, consultarOrden } from '../src/lib/getnetClient.js';
import { verificarFirmaWebhook, mapEstadoGetnet } from '../src/lib/getnetUtils.js';

let pasosOk = 0;
let pasosFail = 0;

function log(msg) { console.log(msg); }
function ok(msg)  { pasosOk++; console.log(`✅ ${msg}`); }
function fail(msg, detalle) {
  pasosFail++;
  console.log(`❌ ${msg}`);
  if (detalle !== undefined) console.log(`   → ${detalle}`);
}
function warn(msg) { console.log(`⚠️  ${msg}`); }

async function main() {
  log('=== Getnet — diagnóstico de sandbox ===\n');

  // ─── Paso 1: variables de entorno ────────────────────────────────────────
  const requeridas = ['GETNET_CLIENT_ID', 'GETNET_CLIENT_SECRET', 'GETNET_SELLER_ID'];
  const faltantes  = requeridas.filter(k => !process.env[k]);

  if (faltantes.length > 0) {
    fail(
      `Faltan variables de entorno: ${faltantes.join(', ')}`,
      'Completalas en backend/.env con las credenciales de sandbox reales (ver docs/GETNET-INTEGRACION.md §4) y volvé a correr este script.'
    );
    imprimirResumen();
    process.exit(1);
  }
  ok('Variables de entorno presentes (GETNET_CLIENT_ID, GETNET_CLIENT_SECRET, GETNET_SELLER_ID)');

  if ((process.env.GETNET_ENV ?? 'sandbox') === 'production') {
    warn('GETNET_ENV=production — este script está pensado para sandbox. Si es a propósito, ignorá este aviso.');
  }

  // ─── Paso 2: obtener access_token ────────────────────────────────────────
  let token;
  try {
    token = await obtenerAccessToken();
    ok(`access_token obtenido (${token.slice(0, 12)}...) — auth OAuth2 funcionando`);
  } catch (err) {
    fail('No se pudo obtener access_token', err?.data ? JSON.stringify(err.data) : err.message);
    warn('Sin token no tiene sentido seguir — revisá GETNET_CLIENT_ID/SECRET y GETNET_API_BASE.');
    imprimirResumen();
    process.exit(1);
  }

  // ─── Paso 3: crear checkout de prueba ────────────────────────────────────
  const orderId = `test-sandbox-${Date.now()}`;
  let checkoutResult;
  try {
    checkoutResult = await crearCheckout({
      orderId,
      amount:           100,
      currency:          'ARS',
      notificationUrl:   `${process.env.SERVER_URL ?? 'http://localhost:3000'}/api/getnet/webhook`,
      returnUrl:         `${process.env.FRONTEND_URL ?? 'http://localhost:8000'}/cliente/pago.html?estado=success`,
    });
    ok(`crearCheckout() respondió OK — order_id local: ${orderId}`);
    log(`   Respuesta cruda de Getnet:\n   ${JSON.stringify(checkoutResult, null, 2).split('\n').join('\n   ')}`);
  } catch (err) {
    fail(
      'crearCheckout() falló — path/payload de getnetClient.js probablemente no coinciden con la API real',
      err?.data ? JSON.stringify(err.data) : err.message
    );
    warn('Este es el paso esperable que rompa primero (ver disclaimer en getnetClient.js) — actualizá el path/payload con lo que confirme el developer portal y volvé a correr.');
  }

  // ─── Paso 4: reconsultar la orden (solo si el paso 3 dio algo reconsultable) ──
  if (checkoutResult) {
    const idReconsulta = checkoutResult.order_id ?? checkoutResult.id ?? orderId;
    try {
      const consulta = await consultarOrden(idReconsulta);
      ok(`consultarOrden("${idReconsulta}") respondió OK → status: ${consulta?.status} → mapeado: ${mapEstadoGetnet(consulta?.status)}`);
    } catch (err) {
      fail('consultarOrden() falló', err?.data ? JSON.stringify(err.data) : err.message);
    }
  } else {
    warn('Paso 4 (consultarOrden) salteado — no hay order_id del paso 3.');
  }

  // ─── Paso 5: verificación de firma (100% local, sin red) ────────────────
  const secretDePrueba = 'secreto-de-prueba-local';
  const bodyDePrueba   = JSON.stringify({ order_id: orderId, status: 'approved' });
  const firmaCorrecta  = crypto.createHmac('sha256', secretDePrueba).update(bodyDePrueba).digest('hex');

  if (verificarFirmaWebhook(bodyDePrueba, firmaCorrecta, secretDePrueba) === true &&
      verificarFirmaWebhook(bodyDePrueba, 'firma-incorrecta', secretDePrueba) === false) {
    ok('verificarFirmaWebhook() acepta firmas válidas y rechaza inválidas (lógica local — no confirma el formato real de Getnet)');
  } else {
    fail('verificarFirmaWebhook() no se comportó como se esperaba — revisar getnetUtils.js');
  }

  imprimirResumen();
  process.exit(pasosFail > 0 ? 1 : 0);
}

function imprimirResumen() {
  log(`\n=== Resumen: ${pasosOk} OK, ${pasosFail} fallidos ===`);
  if (pasosFail > 0) {
    log('Ver docs/GETNET-SANDBOX-TESTING.md para qué hacer con cada tipo de falla.');
  } else {
    log('Los pasos automatizados pasaron — seguí con las pruebas manuales de docs/GETNET-SANDBOX-TESTING.md (tarjetas de prueba, webhook real, etc.).');
  }
}

main().catch(err => {
  console.error('\n💥 Error inesperado corriendo el diagnóstico:', err);
  process.exit(1);
});
