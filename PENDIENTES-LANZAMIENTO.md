# Pendientes de lanzamiento — checklist para vos

> Esto es solo para vos (y para Fabri). No es documentación técnica del
> proyecto — para eso está `CLAUDE.md`. Acá va nada más lo que falta hacer
> a mano para lanzar, en orden de prioridad. Lo que dice "hecho" ya está
> resuelto en el código, no hace falta que lo toques.

---

## 1. 🔴 Crear la cuenta de Google Play Console — HACELO YA

Es lo más urgente de toda la lista, aunque no parezca "técnico". Google exige
a las cuentas de desarrollador **nuevas** pasar un track de **Closed Testing**
(mínimo ~20 testers que acepten, 14 días corridos) antes de habilitar
Production. Como todavía no existe la cuenta, esos 14 días ni arrancaron —
es lo que más atrasa la fecha real en que la app puede estar pública en Play
Store, más que cualquier otra cosa de esta lista.

- Entrá a [play.google.com/console](https://play.google.com/console) y creá
  la cuenta ($25, pago único).
- Elegí cuenta **Personal** (no Organización — esa pide D-U-N-S y tarda
  semanas), salvo que ya tengan una entidad legal registrada para esto.
- La verificación de identidad de Google puede tardar de horas a días.
- Apenas esté creada, avisame — ahí arranca el resto del workstream de Play
  Store (ficha, capturas, Data Safety, etc.), y hay varias cosas que puedo
  redactar por vos (descripción de la ficha, texto del formulario de Data
  Safety) en cuanto me confirmes que existe la cuenta.

## 2. 🔴 Confirmar el backup del keystore de firma

Ubicación: `C:\Users\Usser\puertaapuertax-android-keystore\`

Copiá **toda esa carpeta** (no solo el `.jks`) a por lo menos uno de estos
lugares, fuera de esta compu:
- Google Drive / Dropbox
- Un pendrive o disco externo
- Un gestor de contraseñas que soporte adjuntar archivos (1Password, etc.)

**Si se pierde ese archivo, no hay forma de recuperarlo ni de pedirle a
Google que lo resetee** — significa no poder subir nunca más una
actualización a la misma ficha de Play Store. El archivo `LEEME-CRITICO.txt`
en esa misma carpeta tiene el detalle completo (contraseña, alias, etc.).

## 3. 🟡 Cargar las claves VAPID en Railway

Ya te las pasé en el chat anterior (no las repito acá para no dejarlas
guardadas en un archivo del repo). Entrá a Railway → tu servicio backend →
pestaña **Variables** y cargá las 3: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_EMAIL`. Confirmá que Railway redeployó después de guardarlas.

Sin esto, las notificaciones push por web (avisos de pedido, oferta, etc.)
no llegan — no rompe nada más, pero es una feature muerta hasta que lo
hagas.

## 4. 🟡 Probar el APK en un dispositivo real

Ya generé un `.apk` de debug con todo el código de julio (matching
automático, horarios automáticos, edición de productos, recargo 20%, todo).
Instalalo en un celular Android real (o pasáselo a Fabri) y probá a mano:

- Login con Google (el flow nativo con deep link) — confirmá que redirige
  bien de vuelta a la app.
- Un pedido de punta a punta: cliente → comercio acepta con tiempo de
  preparación → cadete recibe la oferta automáticamente → retiro → entrega.
- Permisos de GPS y cámara.

`qa-e2e.mjs` ya prueba todo el backend (56/56 la última vez) pero **no**
prueba el shell nativo — este paso a mano no es opcional antes de mandar
nada a Play Store.

## 5. 🟢 Diseñar el "feature graphic" de Play Store (1024×500 px)

Es el único gráfico que falta para la ficha — el ícono de 512×512 ya existe.
Si querés, te ayudo con el texto/concepto, pero el diseño en sí (imagen)
no lo puedo generar yo.

## 6. 🟢 Cuando tengan Payway resuelto (Fabri)

No toqué nada de esto a propósito. Cuando Fabri termine su parte, avisame y
lo integramos/probamos junto con todo lo demás antes del lanzamiento final.

## 7. 🟢 `saveCierre()` (panel comercio) no persiste nada

Detectado en la auditoría de código muerto del 7 de agosto. El botón
"Guardar cierre especial" muestra el toast de éxito pero no escribe nada en
la base — no existe ninguna columna/tabla en el schema para "cierre
especial por fecha" (lo más parecido, `pausado_manual`/`pausado_desde`, es
un concepto distinto: pausa instantánea que se autolimpia, no una fecha
futura programada). No lo arreglé porque inventar el schema por mi cuenta
no me pareció correcto — decime si querés que diseñe la migración.

## 8. 🟢 Duplicación de lógica entre archivos (deuda técnica, no urgente)

También del 7 de agosto: la misma lógica está reimplementada en varios
archivos en vez de compartirse — login (3 veces), toggle de mostrar/ocultar
contraseña (3 veces), sanitización HTML (4 veces), inicialización del
cliente Supabase (5 veces). Funciona todo bien, no bloquea el lanzamiento,
pero es un buen candidato para una tarea de refactor aparte.

---

### Lo que ya está resuelto (no necesitás hacer nada más acá)
- Todo el backend/flujo de pedido (matching automático, clima automático,
  tiempo de preparación, horarios automáticos, edición de productos) —
  shippeado y verificado en producción.
- `android/` sincronizado con el código de julio.
- `capacitor.config.json` limpio (sacamos una referencia a un keystore que
  no correspondía).
- `CLAUDE.md` al día con todo lo de arriba.
