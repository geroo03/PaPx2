# Getnet — plan de pruebas de sandbox

> ⚠️ **Esto se ejecuta recién cuando exista una cuenta comercial de Getnet
> con credenciales de sandbox.** Hasta entonces es un plan, no algo que se
> pueda correr. Ver `docs/GETNET-INTEGRACION.md` para el estado general de
> la integración (qué está confirmado, qué falta, checklist de negocio).
>
> Última actualización: 2026-08-25.

Este documento es la guía paso a paso para la primera vez que se prueba
Getnet contra su ambiente sandbox real — el objetivo es confirmar (o
corregir) todos los supuestos marcados como `TODO(verificar)` en
`getnetClient.js`/`getnetUtils.js`/`getnetController.js`, sin arriesgar
nada de producción ni tocar el flujo real de pedidos en ningún momento.

---

## 0. Antes de arrancar

1. Completar en `backend/.env` (nunca commitear este archivo):
   ```
   GETNET_CLIENT_ID=...
   GETNET_CLIENT_SECRET=...
   GETNET_SELLER_ID=...
   GETNET_WEBHOOK_SECRET=...
   GETNET_ENV=sandbox
   ```
2. Si el developer portal de Getnet confirmó una base URL de sandbox
   distinta a la asumida en `getnetClient.js`
   (`https://api-sbx.globalgetnet.com`), setear `GETNET_API_BASE` también.
3. Para que el webhook (asíncrono) le pueda llegar a tu máquina en
   desarrollo local, necesitás un túnel público (ngrok o similar) — mismo
   caso que ya está documentado para MercadoPago en `backend/.env.example`
   (`SERVER_URL=... # o URL de ngrok si necesitás webhooks`). Sin esto, los
   pasos que dependen del webhook (sección 3 en adelante) no se pueden
   probar en local — se puede seguir usando `getnetController.js` deployado
   en un ambiente accesible públicamente (ej. Railway con un
   `GETNET_ENV=sandbox` temporal) si se prefiere no instalar ngrok.

---

## 1. Diagnóstico automatizado — primer paso, siempre

```bash
cd backend
npm run test:getnet-sandbox
```

Corre `backend/scripts/getnet-sandbox-check.mjs`: verifica credenciales,
pide un `access_token` real, intenta crear un checkout de $100 ARS de
prueba, lo reconsulta, y valida la lógica de firma localmente. **Se espera
que el paso de `crearCheckout()` sea el primero en fallar** — el path/
payload de esa llamada es un supuesto, no algo confirmado (ver disclaimer
en `getnetClient.js`). Eso es información útil, no un error del script.

### Qué hacer según lo que falle

| Falla en... | Qué mirar |
|---|---|
| Variables de entorno | Completar `backend/.env` (paso 0) |
| `obtenerAccessToken()` | Credenciales mal copiadas, o la base URL de sandbox no es la asumida — confirmar contra el developer portal |
| `crearCheckout()` | **Esperable.** Anotar el error exacto (status HTTP + body de respuesta) y contrastarlo contra la doc real del developer portal — actualizar el path (`/v1/orders` es un supuesto) y la forma del payload en `getnetClient.js` |
| `consultarOrden()` | Mismo criterio que `crearCheckout()` — path/forma sin confirmar |

Iterar: ajustar `getnetClient.js` con lo que la API real vaya devolviendo,
volver a correr `npm run test:getnet-sandbox`, hasta que los pasos 2-4
pasen en verde.

---

## 2. Prueba manual del checkout — `getnet-test.html`

Una vez que `npm run test:getnet-sandbox` pasa completo:

1. Levantar el backend local (`npm run dev` en `backend/`) y el frontend
   (`npx serve -l 8000` en `frontend/`, o el método que uses).
2. Loguearte con cualquier usuario de prueba en otra pestaña de la misma
   app (para tener un `access_token` real en `localStorage` — el endpoint
   usa `requireAuth`).
3. Abrir `http://localhost:8000/getnet-test.html`.
4. Click en "Crear checkout" — debería redirigir a la página de pago real
   de Getnet (`checkout_url` devuelta por el backend).
5. Completar el pago con una **tarjeta de prueba de sandbox** — Getnet las
   documenta en el developer portal una vez logueado con cuenta real (no
   hay lista pública). Anotarlas acá cuando se consigan, para no tener que
   volver a buscarlas cada vez.

### Escenarios a cubrir (repetir el paso 4 con cada uno)

| Escenario | Qué confirmar |
|---|---|
| **Pago aprobado** | El webhook llega, la firma se valida OK, se crea el pedido en `pedidos` con `estado_pago='aprobado'` y `getnet_payment_id` seteado |
| **Pago rechazado** | El webhook llega (o no — confirmar si Getnet notifica rechazos), y si llega, `mapEstadoGetnet()` lo mapea a `'rechazado'` — no se crea ningún pedido |
| **Pago pendiente** (si el medio de pago usado lo soporta — ej. algún método asincrónico) | Se recibe `'pendiente'`, no se crea el pedido todavía |
| **Webhook duplicado** | Reenviar manualmente la misma notificación (mismo `order_id`) — no debe crear un segundo pedido (idempotencia, ver `getnetController.js`) |
| **Firma inválida** | Mandar un POST a `/api/getnet/webhook` a mano con una firma cualquiera — debe responder `401`, nunca procesar el pago |
| **Monto** | Confirmar que el monto que Getnet efectivamente cobró coincide con el `total` armado — si no coincide, `pesosToGetnetAmount()`/`getnetAmountToPesos()` en `getnetUtils.js` necesitan dejar de ser identidad (ver disclaimer ahí) |
| **Reconciliación** | `GET /api/getnet/estado/:orderId` (con JWT) devuelve el mismo estado que ya se vio por webhook |

---

## 3. Qué actualizar en el código a medida que se confirman cosas

Cada vez que un supuesto se confirma o se corrige, actualizar el archivo
correspondiente y volver a correr `npm test -- --test-name-pattern=getnetUtils`
(para lo que sea testeable sin red) y `npm run test:getnet-sandbox` (para lo
que necesita la API real):

- Path/payload de creación de orden → `getnetClient.js` (`crearCheckout`)
- Formato del monto → `getnetUtils.js` (`pesosToGetnetAmount`/`getnetAmountToPesos`) + todos los callers
- Nombre del header y fórmula de la firma del webhook → `getnetUtils.js` (`verificarFirmaWebhook`) + `getnetController.js` (nombre del header)
- Valores reales de `status` → `getnetUtils.js` (`mapEstadoGetnet`)
- Dónde vive el mapeo `order_id → datos del pedido` → reemplazar el `Map`
  en memoria de `getnetController.js` por una tabla real en Supabase (ver
  TODO explícito ahí)

Cuando todo lo de arriba esté verificado y en verde, `docs/GETNET-INTEGRACION.md`
§5 (checklist técnico) es la referencia de qué más falta antes de
considerar esto listo para conectar al flujo real — esa decisión (¿Getnet
reemplaza a MercadoPago o coexiste?) sigue siendo aparte, a confirmar antes
de tocar `cliente.js`/`pago.html`.
