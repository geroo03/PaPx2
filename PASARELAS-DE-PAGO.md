# 💳 Pasarelas de pago — automatización de cobros y pagos a comercios/cadetes

> Notas para no perder el hilo de la charla del 2026-08-20 sobre cómo
> automatizar el flujo de plata (cobro al cliente → reparto a comercios y
> cadetes) "como las otras apps del rubro". **No se tocó código de pagos
> para armar esto** — es solo el panorama, a propósito, porque este tema
> pisa una decisión que no es nuestra: ver "Quién decide esto" al final.

---

## 1. Cómo está hoy (confirmado en el código, no es una suposición)

Toda la plata de un pedido pago con MercadoPago —precio del comercio +
envío del cadete + el 20% de recargo de la plataforma— entra a **una
sola cuenta de MercadoPago**: la del `MP_ACCESS_TOKEN` configurado en
`backend/.env`. Revisé `mpController.js` y no hay ningún `collector_id`,
`application_fee` ni lógica de marketplace/split — es un cobro simple a
una cuenta única.

No existe ningún pago automático de la plataforma hacia afuera:

- **Comercios:** no hay ninguna tabla ni endpoint de payout. Lo que sí
  existe es lo contrario — `comercios.deuda` acumula lo que el comercio
  le debe a la plataforma cuando cobra en efectivo (el 20% que no pasó
  por MP). Ver CLAUDE.md §8, paso 7.
- **Cadetes:** `solicitar-liquidacion` (`/api/cadete/solicitar-liquidacion`)
  tampoco es un pago de la plataforma al cadete — es la deuda que el
  cadete le debe a la plataforma por haber cobrado pedidos en efectivo.
- **Embajadores:** `solicitar-retiro` es 100% manual — alguien hace la
  transferencia bancaria de verdad fuera de la app, y recién después un
  admin la marca como pagada en el sistema (`embajadorController.js`,
  comentario: *"Llamar DESPUÉS de haber realizado la transferencia
  real"*).

**Conclusión:** hoy "depositar a otras cuentas cada determinados días"
es 100% manual, fuera del código. Automatizarlo es una feature nueva de
punta a punta, no un ajuste chico.

---

## 2. Cómo lo resuelven otras apps del rubro (Mercado Pago, en general)

- **Split de Pagos / Marketplace API de MP:** cada comercio conecta SU
  PROPIA cuenta de MercadoPago (OAuth, "Mercado Pago Connect"). En la
  misma transacción, MP le manda un `application_fee` (nuestra
  comisión) a nuestra cuenta y el resto directo a la cuenta del
  comercio. Esto implica que **cada comercio pasa por el alta/KYC de
  MP** — no es invisible para ellos, es un paso de onboarding real.
- **Los días de espera para liberar la plata no los define la
  plataforma** — los define MP según su propia política de riesgo por
  cuenta/rubro/historial. Lo que sí definimos nosotros es cada cuánto
  corremos el *payout* hacia afuera de nuestra propia cuenta.
- **Los cadetes casi nunca se pagan vía split de MP** (eso es más para
  el lado "merchant"/comercio). Necesitan efectivo semanal/quincenal a
  su CBU/alias — normalmente es una transferencia bancaria por lote (o
  manual, como ya tenemos hoy), no parte del split de la pasarela.
- **Interés por cuotas de tarjeta de crédito:** si es el interés propio
  de financiar en cuotas, **MP ya lo calcula y lo cobra solo** en su
  propio checkout — se activa/configura en el dashboard de la cuenta MP,
  no es código nuestro. Si en cambio la idea es un **recargo fijo propio**
  por pagar con crédito vs. débito/efectivo (algo aparte del interés que
  ya cobra MP), eso sí sería lógica nueva de la app — mismo patrón que
  ya existe para el recargo del 20% (`cliente.js`, aplicado según el
  método de pago elegido antes de crear la preferencia).

---

## 3. Lo que se puede construir ya, sin pisar la decisión de pasarela

Un **ledger interno** de "cuánto le debemos a cada comercio y cada
cadete" — mismo patrón que ya existe con `comercios.deuda` /
`liquidaciones`, pero para plata que la plataforma les debe a ellos
(no al revés). Es útil pase lo que pase con MercadoPago/Payway, porque
el split automático de cualquiera de las dos pasarelas se conecta
*encima* de esa contabilidad, no la reemplaza. Si en algún momento se
decide avanzar, este es el punto natural para arrancar.

---

## 3b. Ya existe un esqueleto WIP de Payway (encontrado 2026-08-20)

No lo sabía hasta que apareció revisando ramas locales: `work/2026-08-18-payway-integracion`
tiene una preparación completa hecha **a pedido tuyo, en una sesión
anterior** (18 de agosto) — 889 líneas, 13 archivos, 53/53 tests OK.
Nunca se pusheó a GitHub hasta hoy (mismo riesgo de "solo en esta
máquina" que el keystore de Android) — ya está respaldado.

- Cliente REST + controller + rutas de Payway, montado en `/api/payway`
  pero **sin `PAYWAY_PRIVATE_KEY` devuelve 501 siempre** — inerte por
  diseño mientras no haya credenciales reales.
- `frontend/payway-test.html` — página de prueba manual aislada, no
  linkeada desde ningún login real.
- Migración de Supabase preparada (`pedidos.payway_payment_id`) pero
  **no corrida**.
- `docs/PAYWAY-INTEGRACION.md` — arquitectura completa y diferencias
  vs. MercadoPago (checkout hospedado + webhook async vs. tokenización
  propia + API sync), con checklist de qué falta conseguir antes de
  activarlo de verdad.
- Nada de esto toca el flujo real de pedidos — MercadoPago sigue
  siendo la única pasarela activa.

Sigue sin mergearse a `main` a propósito — es preparación, no una
decisión tomada. Cuando Fabri avance con la relación contractual real
(ver ítem 6 de `IMPORTANTE-PREGUNTAS-GERARDO.md`), este esqueleto es el
punto de partida técnico, no hay que empezar de cero.

---

## 3c. Getnet entra en escena (2026-08-24)

El usuario trajo una comparativa interna de Santander/Getnet ("Comparativa
de costos", nota al pie "Comunicación interna — no compartir fuera de
Santander y Getnet") comparando comisiones de Getnet contra Payway, Fiserv,
MercadoPago, Openpay y Nave — Getnet aparece con las tarifas más bajas en
casi todas las categorías (QR, débito, crédito en 1 pago y en cuotas, tasas
de financiación). No se reproduce la tabla completa acá por el pie de
confidencialidad del documento original; el resumen y las fuentes públicas
usadas para investigar Getnet quedan en `docs/GETNET-INTEGRACION.md`.

**Getnet y Payway son gateways distintos** (Getnet es la marca adquirente
de Santander; Payway corre sobre infraestructura Decidir/Prisma) — esto no
reemplaza ni se confunde con el punto 3b, cada uno tiene su propia rama y
su propio esqueleto de código con prefijo propio (`getnet*` / `payway*`).

Según el usuario, Fabri ya está al tanto de este chart y el foco pasa a
estar en Getnet — por eso se preparó el mismo tipo de esqueleto WIP inerte
que ya existía para Payway: rama `work/2026-08-24-getnet-integracion`,
`docs/GETNET-INTEGRACION.md` con el detalle completo (qué se confirmó de
la API pública, qué queda pendiente de confirmar con cuenta real, y el
checklist de negocio). Igual que con Payway: **nada de esto está activo ni
enganchado al flujo real** — MercadoPago sigue siendo la única pasarela que
cobra de verdad. La rama de Payway no se tocó ni se descartó — queda tal
cual estaba.

---

## 4. Quién decide esto

- `CLAUDE.md` §5 (alerta para IAs): MercadoPago es la pasarela actual,
  pero se está evaluando migrar a **Payway** y, desde el 2026-08-24,
  también a **Getnet** — ninguna de las dos es una decisión firme
  todavía. No asumir que MP es definitivo, no empezar una migración de
  pasarela por cuenta propia.
- `PENDIENTES-LANZAMIENTO.md` ítem 8 y `README.md` ítem 5: **Payway está
  a cargo de Fabri — no tocar sin que él avance.** Según el usuario, Fabri
  también está al tanto de Getnet (ver 3c) — pero la decisión de negocio
  final (¿cuál de las dos, o coexisten? ¿reemplaza a MP?) sigue sin estar
  tomada; esto sigue siendo terreno de Fabri, no una decisión tomada acá.
- `IMPORTANTE-PREGUNTAS-GERARDO.md` ítem 6 ya tiene pendiente confirmar
  en qué estado está la relación contractual con Payway — falta agregar la
  misma pregunta para Getnet.

Un sistema de split/payout automático es una decisión de pasarela, no
un detalle de implementación — por eso esto quedó en notas y no en
código. Antes de construir nada acá, hablarlo con Fabri (y de paso
cerrar la pregunta de Payway que ya está pendiente para Gerardo).

---

*Este archivo se puede borrar una vez que la decisión de pasarela esté
tomada y el flujo de payout, definido — en ese momento lo que quede
vigente pasa a `CLAUDE.md`.*
