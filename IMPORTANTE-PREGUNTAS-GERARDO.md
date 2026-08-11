# ⚠️ IMPORTANTE — Preguntas para Gerardo (reunión 12 de agosto 2026)

> Gerardo se encarga de toda la parte legal del proyecto. Esta reunión es
> para destrabar el alta de la cuenta de Google Play Console (en curso) y
> cerrar varios temas legales pendientes antes del lanzamiento. Preparado
> el 11 de agosto de 2026 — cruzando lo que pide Google Play con el estado
> real de `frontend/legal.html` y del código.

---

## 🔴 Urgente — bloquea lo que estamos haciendo ahora mismo

### 1. Entidad legal registrada
¿Ya existe una entidad (monotributista, SRL, etc.) a nombre del negocio,
o hay que crearla?

De esto depende si conviene armar la cuenta de Google Play como
**Organización** (aparece el nombre del negocio públicamente, no el
nombre personal de quien la crea) o seguir como **Individual** por ahora
y migrar más adelante — el cambio de Individual a Organización **sí es
posible después sin perder nada** (no hay que crear cuenta nueva, no se
pierde el track de Closed Testing ya iniciado). Si Gerardo confirma que
la entidad existe o se va a crear ya, vale la pena frenar un toque el
alta de Google Play para hacerlo bien de una sola vez.

---

## 🔴 Bloquea la publicación real en Play Store (requisito duro de Google, no opcional)

### 2. Eliminación de cuenta y datos
Google exige, desde abril 2026, que toda app con creación de cuenta
tenga una forma de pedir el borrado **tanto dentro de la app como por
una URL web** — y hay que declarar esa URL en el formulario "Data
Safety" de Play Console.

- **Ya cubierto:** `legal.html` sección 9 ("Tus Derechos") dice que se
  puede pedir por mail a `puertaapuertax@gmail.com`, con respuesta en 10
  días hábiles — eso cubre la parte "web".
- **Falta:** no hay ningún botón "Eliminar mi cuenta" en ningún panel de
  la app (cliente, comercio, cadete). Esa parte "in-app" no existe hoy.

**Decisión que necesito de Gerardo:** ¿el proceso sigue siendo 100%
manual (alguien lo borra a mano al recibir el mail) o hace falta
automatizarlo? Cualquiera de las dos opciones es válida para Google,
pero hay que definir cuál para poder construir el flujo y completar el
formulario de Play Console.

---

## 🟡 Conviene cerrar antes del lanzamiento público amplio

### 3. Cadetes como prestadores independientes
Dado el historial de reclamos laborales a plataformas de delivery en
Argentina (Rappi, PedidosYa), ¿el "Acuerdo de Cadete Independiente" (ya
implementado, se acepta en el onboarding de `cadete.html`) fue revisado
por un abogado laboralista? ¿Hay algo en cómo operamos (asignación de
ofertas, horarios, etc.) que debería ajustarse para reforzar la
independencia del vínculo?

### 4. Contrato específico de comercios
Hoy el comercio solo acepta el ToS genérico al registrarse. La sección
8.1 de `legal.html` ya describe la deuda por comisión cobrada en
efectivo — ¿alcanza con eso, o hace falta un contrato de adhesión más
específico para comercios?

*(Dato técnico: existía un bloque de "Contrato" en el panel de comercio
que se sacó por ser código muerto — nunca se le mostraba de verdad al
usuario, `loadContratoData()` lo pisaba siempre antes de que se viera.
Si hace falta un contrato real, se arma de cero, no se reactiva el
viejo.)*

### 5. Marca registrada
¿"Puerta a Puerta X" está registrado en el INPI? Antes de que la ficha
de Play Store le dé mucha más visibilidad pública al nombre, vale la
pena confirmar que no hay conflicto y evaluar si conviene iniciar el
trámite ahora.

### 6. Payway
¿En qué estado está la relación contractual? Si se suma como pasarela
alternativa a MercadoPago, hay que actualizar `legal.html` sección 5
("Métodos de Pago") para incluirlo — hoy solo menciona MercadoPago y
efectivo.

---

## 🟢 Para tener en el radar, sin apuro

### 7. Reembolsos
El flujo de reporte del cliente dice textualmente "tu pedido fue anulado
y recibís el reembolso" con un timer de 10 minutos — ¿ese reembolso es
automático vía MercadoPago o lo procesa alguien a mano? ¿Está bien
encuadrado como política formal en algún lado?

### 8. Menores de edad
`legal.html` (sección 11) dice que la plataforma no está dirigida a
menores de 18 y que se elimina cualquier cuenta detectada — ¿alcanza con
esa cláusula de exención, o Google/la ley pide algo más activo
(verificación de edad real)?

---

## Después de la reunión

Actualizar con lo que se defina:
- `frontend/legal.html` (si cambia algo de lo de arriba)
- `PENDIENTES-LANZAMIENTO.md` (el ítem de la cuenta de Google Play y
  cualquier tarea nueva que salga de acá)
- Este archivo se puede borrar una vez resueltos todos los puntos.
