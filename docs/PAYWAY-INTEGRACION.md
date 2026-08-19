# Payway — estado de la integración (WIP)

> ⚠️ **Esto NO está activo.** MercadoPago sigue siendo la única pasarela de
> pago real de la app (ver `CLAUDE.md` §5/§6). Este documento y el código que
> referencia son un esqueleto preparado en la branch
> `work/2026-08-18-payway-integracion`, para no arrancar de cero el día que
> se decida seguir adelante — **no reemplaza la decisión de negocio**, que
> según `CLAUDE.md` (pendiente #4) es de Fabri. No mergear a `main` ni
> activar en producción sin confirmar con él primero.
>
> Última actualización: 2026-08-18.

---

## 1. Por qué esto no es un simple "cambiar de pasarela"

MercadoPago y Payway usan modelos de integración distintos:

| | MercadoPago (actual) | Payway |
|---|---|---|
| Checkout | Hospedado por MP (`init_point`) — el cliente nunca ve un formulario de tarjeta nuestro | No hay checkout hospedado documentado públicamente. Hay que construir el formulario de tarjeta propio |
| Confirmación de pago | Asíncrona — webhook HMAC (`POST /api/mp/webhook`) | Sincrónica — la respuesta de `ExecutePayment()` ya trae el estado final |
| Alcance PCI | Mínimo (nunca tocamos datos de tarjeta) | SAQ A como mínimo (tokenización client-side con el SDK JS de Payway, pero el formulario es nuestro) |
| SDK Node.js oficial | Sí (`mercadopago` en npm) | No — solo hay SDKs oficiales de PHP/.NET/Java (`payway-ar` en GitHub). Este esqueleto pega directo a la API REST con `fetch` nativo |
| Split marketplace | No lo usamos hoy (todo entra a una sola cuenta, comercio/cadete se liquidan por fuera vía `comercios.deuda`, etc.) | Tampoco tiene API de marketplace documentada — encajaría en el mismo modelo de cuenta única que ya usamos |

Fuente de esta comparación: investigación en vivo del 2026-08-18 contra
`developers.payway.com.ar`, `github.com/payway-ar/sdk-php-ventaonline` y
research general de comisiones de pasarelas AR — ver memoria de sesión
`project_payway_evaluation.md` para el detalle completo con links.

---

## 2. Qué se preparó en esta branch

- **`backend/src/lib/paywayUtils.js`** — funciones puras (conversión de
  montos al formato Payway, mapeo de estados) + tests
  (`backend/test/paywayUtils.test.js`). Esto sí está verificado — no depende
  de credenciales.
- **`backend/src/lib/paywayClient.js`** — cliente REST mínimo (tokenización,
  cobro, consulta de estado, reembolso). ⚠️ Endpoints/headers **no
  verificados** contra la API real — están inferidos del parentesco técnico
  con Decidir (mismo SDK, `\Decidir\Connector`). Ver el checklist de la
  sección 4 antes de confiar en esto.
- **`backend/src/controllers/paywayController.js`** + **`paywayRoutes.js`** —
  misma forma que `mpController.js`/`mpRoutes.js`, montado en `server.js`
  bajo `/api/payway`. Sin `PAYWAY_PRIVATE_KEY` configurada, devuelve `501`
  siempre — no hace nada mientras no esté configurado.
- **`frontend/assets/js/payway.js`** — módulo de tokenización client-side.
  ⚠️ El nombre del objeto global del SDK y la URL del script **no están
  confirmados** — falla con un error explícito si `window.PAYWAY_JS_SDK_URL`
  no está seteada, en vez de adivinar.
- **`frontend/payway-test.html`** — página de prueba manual aislada (no
  linkeada desde ningún login/menú de la app) para probar tokenización +
  cobro una vez que haya credenciales de sandbox.
- **`supabase/migrations/migration-payway-wip.sql`** — agrega
  `pedidos.payway_payment_id` (espejo de `mp_payment_id`). **No corrida en
  Supabase.**
- Placeholders de configuración documentados en `backend/.env.example` y
  `frontend/env.js.template` (todos vacíos por defecto).

**Nada de esto está enganchado al flujo real de pedidos** —
`cliente.js`/`pago.html` siguen usando exclusivamente MercadoPago.

---

## 3. Qué falta conseguir (no técnico, pasos de negocio/cuenta)

1. **Cuenta comercial de Payway.** Alta como comercio/desarrollador —
   probablemente requiere KYC bancario (Payway está respaldado por
   Santander), más pesado que el alta self-service de MercadoPago. Sin esto
   no hay credenciales de ningún tipo, ni siquiera sandbox.
2. **Acceso a `developers.payway.com.ar` con la cuenta ya creada** — la doc
   pública es una SPA que no expone contenido sin sesión/JS real; no se pudo
   scrapear desde acá. Hace falta entrar con la cuenta real y confirmar:
   - Base URL real de la API (sandbox y producción) — hoy `paywayClient.js`
     asume la de Decidir por parentesco técnico, sin confirmar.
   - Nombre exacto del header de autenticación (`apikey` es un supuesto).
   - Forma exacta del payload/response de `POST /payments` (o el path que
     sea) — la de `paywayClient.js` está armada a partir del SDK PHP, no de
     la REST API documentada directamente.
   - URL real del SDK JS de tokenización y nombre del objeto global
     (`window.Decidir` es un supuesto en `payway.js`).
3. **Credenciales de sandbox** (public + private key) para poder probar algo
   real por primera vez — hasta entonces, todo lo de esta branch es teórico.
4. **Tarjetas de prueba** que documente Payway para el ambiente sandbox.
5. **Definición de negocio con Fabri**: ¿Payway reemplaza a MercadoPago, o
   coexisten (ej. Payway para volumen alto/cuentas grandes, MP como
   default)? Esto cambia bastante el alcance — coexistencia es más simple de
   shippear (agregar un método de pago más) que reemplazo (retirar MP).

---

## 4. Checklist técnico antes de activar esto de verdad

- [ ] Confirmar base URL, header de auth y forma de payload/response contra
      la doc real (paso 2 arriba) — actualizar `paywayClient.js`.
- [ ] Confirmar URL del SDK JS + objeto global — actualizar `payway.js` y
      completar `window.PAYWAY_JS_SDK_URL` en `env.js` real (no en el
      template).
- [ ] Correr un pago de prueba end-to-end contra sandbox usando
      `frontend/payway-test.html` y verificar que `mapEstadoPayway()`
      (`paywayUtils.js`) mapea bien los estados reales que devuelve Payway —
      hoy están tomados de la doc de Decidir, sin verificar contra una
      respuesta real.
- [ ] Correr `migration-payway-wip.sql` en Supabase.
- [ ] Decidir si Payway reemplaza o coexiste con MercadoPago (ver punto 5
      arriba) y ajustar `cliente.js`/`pago.html` según corresponda — hoy no
      tienen ningún cambio.
- [ ] Revisar cumplimiento de red (Visa/Mastercard) si en algún momento se
      usa el guardado de token para cobros recurrentes/repetidos — hay
      reglas específicas de consentimiento para "merchant-initiated
      transactions" que no se investigaron acá (no hay caso de uso de
      recurrencia hoy en la app, cada pedido es un cobro único).
- [ ] Pedirle a Fabri luz verde antes de mergear a `main` — ver
      `CLAUDE.md` pendiente #4.

---

## 5. Cómo correr los tests de lo que sí está verificado hoy

```bash
cd backend
npm test -- --test-name-pattern=paywayUtils
```

Estos tests (montos, mapeo de estados) no requieren ninguna credencial ni
red — son los únicos que se pueden confiar hoy sin acceso real a Payway.
