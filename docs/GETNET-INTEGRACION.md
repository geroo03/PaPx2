# Getnet — estado de la integración (WIP)

> ⚠️ **Esto NO está activo.** MercadoPago sigue siendo la única pasarela de
> pago real de la app (ver `CLAUDE.md` §5/§6). Este documento y el código que
> referencia son un esqueleto preparado en la branch
> `work/2026-08-24-getnet-integracion`, para no arrancar de cero el día que
> se decida seguir adelante — **no reemplaza la decisión de negocio**, que
> según `CLAUDE.md` y `PASARELAS-DE-PAGO.md` es de Fabri (con quien, según
> el usuario, este candidato ya se habló). No mergear a `main` ni activar en
> producción sin confirmarlo primero.
>
> Última actualización: 2026-08-24.

---

## 0. Por qué esto existe

El usuario trajo una comparativa interna de Santander/Getnet ("Comparativa
de costos", nota al pie "Comunicación interna — no compartir fuera de
Santander y Getnet") donde Getnet muestra las comisiones más bajas frente a
Payway, Fiserv, MercadoPago, Openpay y Nave en QR, débito, crédito (1 pago y
en cuotas) y tasas de financiación. Getnet es la marca adquirente de
**Santander** — un gateway distinto de **Payway** (procesadora sobre
infraestructura Decidir/Prisma), que ya tenía su propio esqueleto WIP
preparado antes de esto (`work/2026-08-18-payway-integracion`, ver
`docs/PAYWAY-INTEGRACION.md`). No se confunden entre sí en el código: cada
uno vive en su propia rama, con su propio prefijo de archivos.

---

## 1. Qué es Getnet y cómo se da de alta

- Plataforma de cobros de **Getnet Argentina S.A.U.**, brazo de adquirencia
  de Banco Santander Argentina.
- Alta 100% online: mayor de 18 años, DNI argentino, cuenta bancaria propia,
  email — más un contacto telefónico de cierre. No hace falta ser cliente
  Santander para operar. AFIP no es obligatorio (se puede operar como
  "venta eventual"), pero declarar actividad comercial sube el tope de
  montos que se pueden procesar.
- **Desde noviembre de 2025, acredita a cualquier CBU o CVU** (no solo
  cuentas Santander) — dato relevante porque simplifica el onboarding
  frente a lo que se podía asumir antes.
- Fuentes: [efete.ar](https://efete.ar/getnet-santander-que-es-como-funciona-opiniones), [FinDoctor](https://findoctor.com.ar/getnet-que-es/), [Centro de ayuda Santander](https://ayuda.santander.com.ar/X06M4D6G4R-1/article/XVY4A5J70I-como-me-doy-alta-getnet/), [Revista Mercado (acreditación a cualquier banco)](https://mercado.com.ar/finanzas/getnet-habilita-acreditacion-de-ventas-en-cualquier-cuenta-bancaria-o-billetera-virtual-en-argentina/).

---

## 2. Cómo se integra online — dos caminos, y cuál eligió este esqueleto

Getnet ofrece integraciones directas con plataformas de e-commerce armadas
(Tiendanube, WooCommerce, Magento, VTEX) — no aplican acá, porque este
backend es Node/Express a medida. Para eso hay dos APIs propias:

| | Get Checkout / Web Checkout | Regional API (Getnet SEP) |
|---|---|---|
| Qué es | Checkout **hospedado** por Getnet, 3 modos: embebido (iframe), lightbox (popup) o redirect a página de Getnet | API REST directa, un solo esquema de integración para Argentina/Brasil/Chile/México/Colombia/Portugal/España/Uruguay |
| Complejidad | "Low integration complexity" — pensado para no reinventar el formulario de tarjeta | Mayor control, pero más superficie propia |
| Confirmación de pago | Asíncrona — webhook a una URL configurada por el comercio, firma SHA-256 | Mismo modelo de webhook (es la misma infraestructura de notificaciones) |

Fuentes: [Get Checkout](https://www.getnet.net/ar/ayuda/integraciones-ecommerce/get-checkout), [Web Checkout docs](https://docs.globalgetnet.com/en/products/online-payments/web-checkout), [Regional API docs](https://docs.globalgetnet.com/en/products/online-payments/regional-api).

**Este esqueleto asume Get Checkout** (checkout hospedado + webhook async):
es arquitectónicamente el más parecido a la integración actual de
MercadoPago (`crearPreferencia` + `mpWebhook`), así que `getnetController.js`
está armado como espejo de `mpController.js`, no de `paywayController.js`
(que es síncrono, con tokenización propia — modelo de Payway, no de
Getnet). Esto es una decisión de diseño de este esqueleto, no un hecho
confirmado contra la doc real — si en algún momento se confirma que
conviene la Regional API directa en su lugar, el cliente (`getnetClient.js`)
es la única pieza que cambiaría de fondo.

### Autenticación — esto sí está confirmado

- OAuth2 `client_credentials`. `POST` a
  `/authentication/oauth2/access_token` con HTTP Basic Auth
  (`client_id:client_secret` en base64) → devuelve `access_token` (JWT),
  `token_type: Bearer`, expira en 3599 segundos.
- Sandbox: `https://api-sbx.globalgetnet.com`. Producción: **no
  confirmada** (`getnetClient.js` asume `api.globalgetnet.com`, marcado
  como TODO).
- Cada request autenticado además lleva el header `x-seller-id`.
- Fuente: [Regional API — Authentication](https://docs.globalgetnet.com/en/products/online-payments/regional-api?doc=first-step-authentication).

### Lo que NO se pudo confirmar desde afuera

El developer portal (`docs.globalgetnet.com` / `developer.globalgetnet.com`)
tiene contenido JS-rendered / detrás de cuenta real para los detalles finos
— mismo bloqueo que hubo investigando Payway (`developers.payway.com.ar`).
Sin cuenta comercial no se pudo confirmar:

- Path exacto para crear una orden/checkout (`getnetClient.js` asume
  `POST /v1/orders`, sin verificar).
- Forma exacta del payload/response de esa creación.
- Formato del monto — ¿decimal ARS o entero escalado como Payway/Decidir?
  (`getnetUtils.js` usa identidad por ahora, sin asumir centavos).
- Nombre del header de firma del webhook y la fórmula exacta de la firma
  SHA-256 (`getnetController.js`/`getnetUtils.js` asumen HMAC-SHA256, mismo
  patrón que ya usa este backend para MercadoPago, pero no confirmado).
- URL del SDK JS para el modo embebido/lightbox del checkout.
- Sin SDK oficial de Node.js publicado (mismo caso que Payway) — se integra
  con `fetch` nativo.

---

## 3. Qué se preparó en esta branch

- **`backend/src/lib/getnetUtils.js`** — funciones puras (mapeo de
  estados, verificación de firma) + tests
  (`backend/test/getnetUtils.test.js`, 15 tests). Esto sí está verificado —
  no depende de credenciales.
- **`backend/src/lib/getnetClient.js`** — cliente REST con `fetch` nativo:
  OAuth2 client_credentials con caché de token en memoria, creación de
  checkout, consulta de orden. ⚠️ Path/payload de creación de orden **no
  verificados** — ver sección 2.
- **`backend/src/controllers/getnetController.js`** + **`getnetRoutes.js`**
  — misma forma que `mpController.js`/`mpRoutes.js`, montado en
  `server.js` bajo `/api/getnet`. Sin `GETNET_CLIENT_ID`/
  `GETNET_CLIENT_SECRET`, `crear-checkout` y `estado` devuelven `501`
  siempre. El mapeo `order_id → datos del pedido` hoy vive en un `Map` en
  memoria del proceso — **placeholder explícito**, no sobrevive un
  restart/redeploy ni funciona con `WEB_CONCURRENCY>1` (ver comentario en
  el archivo). Antes de activar esto de verdad, reemplazar por una tabla en
  Supabase.
- **`frontend/assets/js/getnet.js`** — a diferencia de `payway.js`, no
  tokeniza tarjeta (Get Checkout es hospedado) — solo llama al backend y
  redirige a la `checkout_url` que devuelve. El modo "embebido" está
  deliberadamente sin implementar (tira error explícito) hasta confirmar
  el SDK real.
- **`frontend/getnet-test.html`** — página de prueba manual aislada (no
  linkeada desde ningún login/menú de la app).
- **`supabase/migrations/migration-getnet-wip.sql`** — agrega
  `pedidos.getnet_payment_id`. **No corrida en Supabase.**
- Placeholders de configuración en `backend/.env.example` y
  `frontend/env.js.template` (todos vacíos por defecto).

**Nada de esto está enganchado al flujo real de pedidos** —
`cliente.js`/`pago.html` siguen usando exclusivamente MercadoPago.

---

## 4. Qué falta conseguir (pasos de negocio/cuenta, no técnicos)

1. **Cuenta comercial de Getnet.** Alta self-service (ver sección 1) — más
   liviana que la de Payway (que requiere KYC bancario más pesado por
   estar más ligada al lado banco-a-banco), pero de cualquier forma sin
   esto no hay credenciales de ningún tipo, ni siquiera sandbox.
2. **Acceso real al developer portal** (`developer.globalgetnet.com` /
   `docs.globalgetnet.com` con sesión) para confirmar todo lo listado en
   la sección 2 ("Lo que NO se pudo confirmar desde afuera").
3. **Credenciales de sandbox** (`client_id`/`client_secret`/`seller_id`).
4. **Tarjetas de prueba** que documente Getnet para el ambiente sandbox.
5. **Definición de negocio con Fabri**: ¿Getnet reemplaza a MercadoPago, o
   coexisten? ¿Qué pasa con el esqueleto de Payway ya preparado — se
   descarta, queda en pausa, o se evalúan los dos antes de decidir? Esto
   cambia el alcance real del trabajo que sigue.

---

## 5. Checklist técnico antes de activar esto de verdad

- [ ] Confirmar path/payload/response de creación de orden y actualizar
      `getnetClient.js`.
- [ ] Confirmar formato del monto y actualizar `pesosToGetnetAmount()`/
      `getnetAmountToPesos()` en `getnetUtils.js` si hace falta escalar.
- [ ] Confirmar nombre del header y fórmula exacta de la firma del webhook
      — actualizar `getnetController.js`/`getnetUtils.js`.
- [ ] Reemplazar el `Map` en memoria de `getnetController.js` por una tabla
      real en Supabase (órdenes pendientes de confirmación).
- [ ] Confirmar URL del SDK embebido si se decide usar el modo "embebido"
      en vez de "redirect" — actualizar `getnet.js` y
      `window.GETNET_CHECKOUT_SDK_URL` en `env.js` real.
- [ ] Correr un pago de prueba end-to-end contra sandbox usando
      `frontend/getnet-test.html`.
- [ ] Correr `migration-getnet-wip.sql` en Supabase.
- [ ] Decidir si Getnet reemplaza o coexiste con MercadoPago (y qué pasa
      con Payway) y ajustar `cliente.js`/`pago.html` según corresponda —
      hoy no tienen ningún cambio.
- [ ] Pedirle a Fabri luz verde final antes de mergear a `main`.

---

## 6. Cómo correr los tests de lo que sí está verificado hoy

```bash
cd backend
npm test -- --test-name-pattern=getnetUtils
```

Estos tests (mapeo de estados, verificación de firma HMAC-SHA256) no
requieren ninguna credencial ni red — son los únicos que se pueden confiar
hoy sin acceso real a Getnet.
