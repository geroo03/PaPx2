import { supabaseAdmin } from '../lib/supabaseClient.js';

/**
 * adminController — panel de depósitos manuales.
 *
 * Responde "¿cuánta plata tengo que depositarle hoy a cada uno?" para los tres
 * destinatarios que cobran por fuera de la app (embajadores, cadetes y
 * comercios), y registra los depósitos ya hechos para que dejen de aparecer.
 *
 * Todo pasa por supabaseAdmin (service_role): varias de estas tablas
 * (billetera_embajador, por ejemplo) solo tienen policies RLS de "el propio
 * dueño", nunca de admin — leerlas desde el frontend con el cliente anon no
 * falla, simplemente devuelve 0 filas, que fue justo el bug que hacía que el
 * panel mostrara $0 para todos los embajadores sin ningún error visible.
 */

// Supabase corta las queries en 1000 filas por defecto. Como acá se agrega en
// JS (supabase-js no expone GROUP BY), hay que paginar de verdad: si no, a
// partir del pedido 1001 los totales empiezan a mentir en silencio, que es la
// peor forma de fallar para algo que decide cuánta plata se transfiere.
const PAGINA = 1000;

async function traerTodo(construirQuery) {
  const filas = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await construirQuery().range(desde, desde + PAGINA - 1);
    if (error) throw error;
    if (!data?.length) break;
    filas.push(...data);
    if (data.length < PAGINA) break;
  }
  return filas;
}

const aNumero = (v) => Number(v ?? 0) || 0;

// ─── GET /api/admin/depositos ────────────────────────────────────────────────

/**
 * Devuelve las tres listas de "a quién hay que depositarle", cada una con el
 * monto, los datos bancarios de destino y el detalle de qué la compone.
 *
 * Criterio de cada monto:
 *
 *   CADETE    Σ pago_cadete de sus pedidos entregados todavía no liquidados,
 *             menos su deuda_efectivo (la plata que él ya cobró en mano y le
 *             debe a la plataforma). Puede dar negativo: en ese caso no hay
 *             que depositarle, es él quien tiene que liquidar.
 *
 *   COMERCIO  Σ subtotal de sus pedidos entregados y cobrados por medios
 *             electrónicos (la plata la recibió la plataforma), menos
 *             comercios.deuda (las comisiones que quedaron a deber por los
 *             pedidos cobrados en efectivo). Los pedidos en efectivo no suman:
 *             esa plata nunca pasó por la plataforma.
 *
 *   EMBAJADOR billetera_embajador.saldo_disponible. Si además tiene
 *             solicitudes de retiro pendientes, vienen aparte para poder
 *             confirmarlas por el circuito que ya existe.
 */
export async function getDepositos(req, res) {
  try {
    const [cadetes, comercios, embajadores] = await Promise.all([
      calcularCadetes(),
      calcularComercios(),
      calcularEmbajadores(),
    ]);

    const totalAPagar = [...cadetes, ...comercios, ...embajadores]
      .reduce((acc, d) => acc + Math.max(0, d.monto), 0);

    res.json({ cadetes, comercios, embajadores, totalAPagar });
  } catch (e) {
    console.error('[getDepositos] Error:', e?.message ?? e);
    res.status(500).json({ error: 'No se pudo calcular los depósitos pendientes.' });
  }
}

async function calcularCadetes() {
  const pedidos = await traerTodo(() => supabaseAdmin
    .from('pedidos')
    .select('id, cadete_id, pago_cadete, numero, created_at')
    .eq('estado', 'entregado')
    .eq('liquidado', false)
    .not('cadete_id', 'is', null));

  if (!pedidos.length) return [];

  const porCadete = new Map();
  for (const p of pedidos) {
    const actual = porCadete.get(p.cadete_id) ?? { bruto: 0, pedidoIds: [], pedidos: [] };
    actual.bruto += aNumero(p.pago_cadete);
    actual.pedidoIds.push(p.id);
    actual.pedidos.push({ id: p.id, numero: p.numero, monto: aNumero(p.pago_cadete), fecha: p.created_at });
    porCadete.set(p.cadete_id, actual);
  }

  const { data: datos } = await supabaseAdmin
    .from('cadetes')
    .select('auth_uid, nombre, cvu, deuda_efectivo')
    .in('auth_uid', [...porCadete.keys()]);

  const porUid = new Map((datos ?? []).map((c) => [c.auth_uid, c]));

  return [...porCadete.entries()].map(([uid, acc]) => {
    const c = porUid.get(uid) ?? {};
    const deuda = aNumero(c.deuda_efectivo);
    return {
      tipo: 'cadete',
      destinatario_id: uid,
      nombre: c.nombre ?? '(cadete sin perfil)',
      destino: { cvu: c.cvu ?? null },
      bruto: acc.bruto,
      descuento: deuda,
      descuentoConcepto: 'deuda en efectivo',
      monto: acc.bruto - deuda,
      pedido_ids: acc.pedidoIds,
      detalle: acc.pedidos.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
    };
  }).sort((a, b) => b.monto - a.monto);
}

async function calcularComercios() {
  const pedidos = await traerTodo(() => supabaseAdmin
    .from('pedidos')
    .select('id, comercio_id, subtotal, numero, created_at, metodo_pago')
    .eq('estado', 'entregado')
    .eq('liquidado_comercio', false)
    .eq('estado_pago', 'aprobado')
    .neq('metodo_pago', 'efectivo'));

  if (!pedidos.length) return [];

  const porComercio = new Map();
  for (const p of pedidos) {
    const actual = porComercio.get(p.comercio_id) ?? { bruto: 0, pedidoIds: [], pedidos: [] };
    actual.bruto += aNumero(p.subtotal);
    actual.pedidoIds.push(p.id);
    actual.pedidos.push({ id: p.id, numero: p.numero, monto: aNumero(p.subtotal), fecha: p.created_at });
    porComercio.set(p.comercio_id, actual);
  }

  const { data: datos } = await supabaseAdmin
    .from('comercios')
    .select('id, nombre, cbu_alias, titular_bancario, cuit, deuda')
    .in('id', [...porComercio.keys()]);

  const porId = new Map((datos ?? []).map((c) => [c.id, c]));

  return [...porComercio.entries()].map(([id, acc]) => {
    const c = porId.get(id) ?? {};
    const deuda = aNumero(c.deuda);
    return {
      tipo: 'comercio',
      destinatario_id: id,
      nombre: c.nombre ?? '(comercio sin datos)',
      destino: { cbu_alias: c.cbu_alias ?? null, titular: c.titular_bancario ?? null, cuit: c.cuit ?? null },
      bruto: acc.bruto,
      descuento: deuda,
      descuentoConcepto: 'comisiones adeudadas',
      monto: acc.bruto - deuda,
      pedido_ids: acc.pedidoIds,
      detalle: acc.pedidos.sort((a, b) => (a.numero ?? 0) - (b.numero ?? 0)),
    };
  }).sort((a, b) => b.monto - a.monto);
}

async function calcularEmbajadores() {
  const { data: perfiles } = await supabaseAdmin
    .from('perfiles')
    .select('usuario_id, nombre, email')
    .eq('rol', 'embajador');

  const ids = (perfiles ?? []).map((p) => p.usuario_id);
  if (!ids.length) return [];

  const [{ data: billeteras }, { data: solicitudes }] = await Promise.all([
    supabaseAdmin.from('billetera_embajador').select('*').in('embajador_id', ids),
    supabaseAdmin.from('solicitudes_retiro')
      .select('id, embajador_id, monto, cbu_alias, created_at')
      .in('embajador_id', ids)
      .eq('estado', 'pendiente'),
  ]);

  const porId = new Map((billeteras ?? []).map((b) => [b.embajador_id, b]));

  return (perfiles ?? []).map((p) => {
    const b = porId.get(p.usuario_id) ?? {};
    const pendientes = (solicitudes ?? []).filter((s) => s.embajador_id === p.usuario_id);
    return {
      tipo: 'embajador',
      destinatario_id: p.usuario_id,
      nombre: p.nombre ?? p.email ?? '(embajador)',
      // El CBU del embajador solo se conoce cuando pidió un retiro: no se
      // guarda en su perfil, viaja en cada solicitud.
      destino: { cbu_alias: pendientes[0]?.cbu_alias ?? null },
      bruto: aNumero(b.saldo_disponible),
      descuento: 0,
      descuentoConcepto: null,
      monto: aNumero(b.saldo_disponible),
      acumulado: aNumero(b.saldo_acumulado),
      retirado: aNumero(b.saldo_retirado),
      solicitudes: pendientes,
    };
  })
    .filter((e) => e.monto > 0 || e.solicitudes.length)
    .sort((a, b) => b.monto - a.monto);
}

// ─── POST /api/admin/depositos ───────────────────────────────────────────────

/**
 * Registra un depósito ya hecho a mano y cierra el circuito según el tipo:
 *
 *   cadete    marca los pedidos incluidos como liquidados
 *   comercio  ídem, con la bandera propia del comercio
 *   embajador si viene solicitud_id, confirma esa solicitud por el RPC que ya
 *             existe (confirmar_pago_retiro); si no, descuenta el saldo
 *             disponible de la billetera y lo suma a lo retirado
 *
 * Body: { tipo, destinatario_id, monto, metodo?, referencia?, notas?,
 *         pedido_ids?, solicitud_id? }
 */
export async function registrarDeposito(req, res) {
  const { tipo, destinatario_id, monto, metodo, referencia, notas, pedido_ids, solicitud_id } = req.body ?? {};

  if (!['embajador', 'cadete', 'comercio'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo inválido: embajador | cadete | comercio.' });
  }
  if (!destinatario_id || typeof destinatario_id !== 'string') {
    return res.status(400).json({ error: 'Falta destinatario_id.' });
  }
  const montoNum = Number(monto);
  if (!Number.isFinite(montoNum) || montoNum <= 0) {
    return res.status(400).json({ error: 'El monto tiene que ser un número mayor a 0.' });
  }
  if ((tipo === 'cadete' || tipo === 'comercio') && !Array.isArray(pedido_ids)) {
    return res.status(400).json({ error: 'Faltan los pedido_ids que cubre el depósito.' });
  }

  try {
    // El efecto colateral va PRIMERO: si falla, no queda registrado un
    // depósito que en realidad no cerró nada. Al revés (registrar y que
    // después falle el marcado) el mismo dinero volvería a aparecer como
    // pendiente y se podría pagar dos veces.
    if (tipo === 'cadete' && pedido_ids.length) {
      const { error } = await supabaseAdmin
        .from('pedidos').update({ liquidado: true })
        .in('id', pedido_ids).eq('estado', 'entregado');
      if (error) throw error;
    }

    if (tipo === 'comercio' && pedido_ids.length) {
      const { error } = await supabaseAdmin
        .from('pedidos').update({ liquidado_comercio: true })
        .in('id', pedido_ids).eq('estado', 'entregado');
      if (error) throw error;
    }

    // Monto que se va a registrar. Para el caso del embajador con solicitud
    // de retiro manda el servidor, no el cliente: el RPC mueve exactamente el
    // monto de la solicitud, así que registrar el saldo disponible completo
    // (que puede ser mayor) dejaría el registro contable mintiendo.
    let montoRegistrado = montoNum;

    if (tipo === 'embajador') {
      if (solicitud_id) {
        const { data: sol, error: eSol } = await supabaseAdmin
          .from('solicitudes_retiro')
          .select('monto, estado')
          .eq('id', solicitud_id)
          .maybeSingle();
        if (eSol) throw eSol;
        if (!sol) return res.status(404).json({ error: 'La solicitud de retiro no existe.' });
        if (sol.estado !== 'pendiente') {
          return res.status(409).json({ error: `La solicitud ya está ${sol.estado}.` });
        }

        const { error } = await supabaseAdmin.rpc('confirmar_pago_retiro', { p_solicitud_id: solicitud_id });
        if (error) throw error;
        montoRegistrado = aNumero(sol.monto);
      } else {
        const { data: bill, error: eBill } = await supabaseAdmin
          .from('billetera_embajador')
          .select('saldo_disponible, saldo_retirado')
          .eq('embajador_id', destinatario_id)
          .maybeSingle();
        if (eBill) throw eBill;

        const disponible = aNumero(bill?.saldo_disponible);
        if (montoNum > disponible) {
          return res.status(400).json({
            error: `El monto ($${montoNum}) supera el saldo disponible del embajador ($${disponible}).`,
          });
        }
        const { error } = await supabaseAdmin
          .from('billetera_embajador')
          .update({
            saldo_disponible: disponible - montoNum,
            saldo_retirado:   aNumero(bill?.saldo_retirado) + montoNum,
          })
          .eq('embajador_id', destinatario_id);
        if (error) throw error;
      }
    }

    const { data: pago, error: ePago } = await supabaseAdmin
      .from('pagos_manuales')
      .insert({
        tipo,
        destinatario_id,
        monto: montoRegistrado,
        metodo: metodo || 'transferencia',
        referencia: referencia || null,
        notas: notas || null,
        pagado_por: req.user.id,
      })
      .select()
      .single();
    if (ePago) throw ePago;

    res.json({ ok: true, pago });
  } catch (e) {
    console.error('[registrarDeposito] Error:', e?.message ?? e);
    res.status(500).json({ error: 'No se pudo registrar el depósito.' });
  }
}

// ─── GET /api/admin/depositos/historial ──────────────────────────────────────

/** Últimos depósitos registrados, para poder auditar lo ya pagado. */
export async function getHistorialDepositos(_req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('pagos_manuales')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ pagos: data ?? [] });
  } catch (e) {
    console.error('[getHistorialDepositos] Error:', e?.message ?? e);
    res.status(500).json({ error: 'No se pudo cargar el historial de depósitos.' });
  }
}
