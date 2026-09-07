import { supabaseAdmin }    from '../lib/supabaseClient.js';
import { resolveRol }       from '../lib/roleUtils.js';
import { calcularComision } from '../lib/comisionUtils.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireEmbajador(req, res) {
  const rol = await resolveRol(req.user.id, req.user.user_metadata);
  if (rol !== 'embajador' && rol !== 'admin') {
    res.status(403).json({ error: 'Solo embajadores pueden acceder a este recurso.' });
    return false;
  }
  return true;
}

// ─── getDashboard ─────────────────────────────────────────────────────────────

/**
 * GET /api/embajadores/dashboard
 *
 * Devuelve en una sola llamada:
 *   - billetera (saldo_disponible, saldo_acumulado, saldo_retirado)
 *   - últimas 50 comisiones (con tasa_aplicada para transparencia)
 *   - patrocinios activos con datos del comercio
 *   - solicitudes de retiro pendientes
 */
export async function getDashboard(req, res) {
  if (!await requireEmbajador(req, res)) return;

  const eid = req.user.id;

  try {
    const [billetera, comisiones, patrocinios, retiros] = await Promise.all([

      supabaseAdmin
        .from('billetera_embajador')
        .select('saldo_disponible, saldo_acumulado, saldo_retirado, updated_at')
        .eq('embajador_id', eid)
        .maybeSingle(),

      supabaseAdmin
        .from('historial_comisiones')
        .select('id, pedido_id, comercio_id, monto_pedido, tasa_aplicada, monto_comision, meses_activo, created_at')
        .eq('embajador_id', eid)
        .order('created_at', { ascending: false })
        .limit(50),

      supabaseAdmin
        .from('patrocinios')
        .select('id, comercio_id, fecha_inicio, activo, comercios(nombre, direccion, categoria, estado_registro)')
        .eq('embajador_id', eid)
        .order('fecha_inicio', { ascending: false }),

      supabaseAdmin
        .from('solicitudes_retiro')
        .select('id, monto, estado, cbu_alias, notas_admin, created_at, updated_at')
        .eq('embajador_id', eid)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    return res.json({
      billetera:  billetera.data ?? { saldo_disponible: 0, saldo_acumulado: 0, saldo_retirado: 0 },
      comisiones: comisiones.data ?? [],
      patrocinios: patrocinios.data ?? [],
      retiros:    retiros.data ?? [],
    });

  } catch (err) {
    console.error('[getDashboard] Error:', err?.message ?? err);
    return res.status(500).json({ error: 'Error cargando el dashboard.' });
  }
}

// ─── vincularReferido ─────────────────────────────────────────────────────────

/**
 * POST /api/embajadores/vincular-referido
 *
 * Se llama desde registro-comercio.html justo después de que un comercio se
 * registra solo a través del link de referidos (?ref=<embajador_id>), con la
 * sesión recién creada del propio comercio (no del embajador).
 *
 * `comercios.creado_por_embajador_id` ya quedó seteado en el INSERT del
 * comercio (RLS lo permite porque lo hace el dueño con su propia sesión),
 * pero la tabla `patrocinios` — fuente de verdad real de `registrarComisionSiAplica`
 * para acreditar comisiones — solo se puede insertar con rol 'embajador'
 * (policy `patrocinios_embajador_insert`), así que el comercio nunca puede
 * crearla directamente. Sin este paso, el comercio queda funcional (tiene
 * login) pero el embajador jamás cobra comisión por él. Este endpoint lo
 * hace vía service_role, validando server-side que el comercio realmente
 * fue creado por ese embajador (no confía en nada que mande el body).
 *
 * Body: { comercioId }
 */
export async function vincularReferido(req, res) {
  const comercioId = req.body?.comercioId;
  if (!comercioId) {
    return res.status(400).json({ error: 'comercioId requerido.' });
  }

  try {
    const { data: comercio, error: comErr } = await supabaseAdmin
      .from('comercios')
      .select('id, usuario_id, creado_por_embajador_id, created_at')
      .eq('id', comercioId)
      .maybeSingle();

    if (comErr || !comercio) {
      return res.status(404).json({ error: 'Comercio no encontrado.' });
    }
    if (comercio.usuario_id !== req.user.id) {
      return res.status(403).json({ error: 'No podés vincular un comercio que no es tuyo.' });
    }
    if (!comercio.creado_por_embajador_id) {
      return res.status(200).json({ ok: true, vinculado: false }); // No vino de un link de referido — nada que hacer
    }

    const { error: patErr } = await supabaseAdmin
      .from('patrocinios')
      .insert({
        embajador_id: comercio.creado_por_embajador_id,
        comercio_id:  comercio.id,
        fecha_inicio: comercio.created_at ?? new Date().toISOString(),
        activo:       true,
      });

    if (patErr && patErr.code !== '23505') { // 23505 = ya existía (idempotente, no es error)
      console.error('[vincularReferido] Error insertando patrocinio:', patErr.message);
      return res.status(500).json({ error: 'No se pudo vincular el comercio al embajador.' });
    }

    console.log(`[Embajador] patrocinio vinculado: ${comercio.creado_por_embajador_id} → comercio ${comercio.id}`);
    return res.status(201).json({ ok: true, vinculado: true });

  } catch (err) {
    console.error('[vincularReferido] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── solicitarRetiro ──────────────────────────────────────────────────────────

/**
 * POST /api/embajadores/solicitar-retiro
 *
 * Crea una solicitud de retiro de forma atómica vía RPC de PostgreSQL.
 * Congela el monto del saldo_disponible hasta que el admin confirme o rechace.
 *
 * Body: { monto: number, cbu_alias?: string }
 */
export async function solicitarRetiro(req, res) {
  if (!await requireEmbajador(req, res)) return;

  const { monto, cbu_alias } = req.body ?? {};

  if (!monto || Number(monto) <= 0) {
    return res.status(400).json({ error: 'El monto debe ser un número mayor a 0.' });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('solicitar_retiro_embajador', {
      p_embajador_id: req.user.id,
      p_monto:        Number(monto),
      p_cbu_alias:    cbu_alias?.trim() ?? null,
    });

    if (error) {
      console.error('[solicitarRetiro] RPC error:', error.message);
      return res.status(500).json({ error: 'Error procesando la solicitud.' });
    }

    if (data?.error) {
      return res.status(400).json({ error: data.error, saldo_disponible: data.saldo_disponible });
    }

    console.log(`[Retiro] embajador:${req.user.id} | monto:$${monto} | id:${data.solicitud_id}`);
    return res.status(201).json({ ok: true, solicitud_id: data.solicitud_id, monto: data.monto });

  } catch (err) {
    console.error('[solicitarRetiro] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── confirmarPago ────────────────────────────────────────────────────────────

/**
 * PATCH /api/embajadores/retiro/:id/pagar
 *
 * Solo admin. Marca la solicitud como pagada y acredita en saldo_retirado.
 * Llamar DESPUÉS de haber realizado la transferencia real.
 */
export async function confirmarPago(req, res) {
  const rol = await resolveRol(req.user.id, req.user.user_metadata);
  if (rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden confirmar pagos.' });
  }

  const solicitudId = req.params.id;
  if (!solicitudId) {
    return res.status(400).json({ error: 'ID de solicitud requerido.' });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('confirmar_pago_retiro', {
      p_solicitud_id: solicitudId,
    });

    if (error) {
      console.error('[confirmarPago] RPC error:', error.message);
      return res.status(500).json({ error: 'Error confirmando el pago.' });
    }

    if (data?.error) {
      return res.status(400).json({ error: data.error, estado: data.estado });
    }

    console.log(`[Admin] Retiro ${solicitudId} marcado como pagado — $${data.monto}`);
    return res.json({ ok: true, solicitud_id: data.solicitud_id, monto: data.monto });

  } catch (err) {
    console.error('[confirmarPago] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── rechazarRetiro ───────────────────────────────────────────────────────────

/**
 * PATCH /api/embajadores/retiro/:id/rechazar
 *
 * Solo admin. Rechaza la solicitud y devuelve el saldo al embajador.
 * Body: { motivo?: string }
 */
export async function rechazarRetiro(req, res) {
  const rol = await resolveRol(req.user.id, req.user.user_metadata);
  if (rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden rechazar solicitudes.' });
  }

  const solicitudId = req.params.id;
  const { motivo }  = req.body ?? {};

  try {
    const { data, error } = await supabaseAdmin.rpc('rechazar_retiro', {
      p_solicitud_id: solicitudId,
      p_motivo:       motivo?.trim() ?? null,
    });

    if (error) {
      console.error('[rechazarRetiro] RPC error:', error.message);
      return res.status(500).json({ error: 'Error rechazando la solicitud.' });
    }

    if (data?.error) {
      return res.status(400).json({ error: data.error });
    }

    console.log(`[Admin] Retiro ${solicitudId} rechazado — saldo devuelto: $${data.saldo_devuelto}`);
    return res.json({ ok: true, saldo_devuelto: data.saldo_devuelto });

  } catch (err) {
    console.error('[rechazarRetiro] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

// ─── adminResumenComisiones ───────────────────────────────────────────────────

/**
 * GET /api/embajadores/admin/resumen
 *
 * Solo admin. Resumen de comisiones de TODOS los embajadores (generadas/
 * pagadas/pendientes, total y por embajador) para el panel de admin.
 *
 * Existe porque `billetera_embajador` (la tabla real, ver nota en CLAUDE.md
 * §7 sobre `opciones_items` para el mismo tipo de desvío schema-vs-realidad)
 * solo tiene policies RLS de "el propio embajador" (`embajador_id = auth.uid()`)
 * y "service_role" — nunca una de admin. admin.html leía esta tabla directo
 * con el cliente de Supabase y la query no fallaba, solo devolvía 0 filas, así
 * que el panel mostraba $0 en Disponible/Acumulado/Retirado para todos los
 * embajadores sin ningún error visible. Acá se resuelve pasando por
 * supabaseAdmin (service_role) en vez de tocar RLS.
 */
export async function adminResumenComisiones(req, res) {
  const rol = await resolveRol(req.user.id, req.user.user_metadata);
  if (rol !== 'admin') {
    return res.status(403).json({ error: 'Solo administradores pueden ver este resumen.' });
  }

  try {
    const { data: embajadores, error: eErr } = await supabaseAdmin
      .from('perfiles')
      .select('usuario_id, nombre, email')
      .eq('rol', 'embajador');
    if (eErr) throw eErr;

    const ids = (embajadores ?? []).map(e => e.usuario_id);
    if (!ids.length) {
      return res.json({ embajadores: [], totales: { generadas: 0, pagadas: 0, pendientes: 0 } });
    }

    const [{ data: billeteras }, { data: patrocinios }] = await Promise.all([
      supabaseAdmin.from('billetera_embajador').select('*').in('embajador_id', ids),
      supabaseAdmin.from('patrocinios').select('embajador_id').in('embajador_id', ids),
    ]);

    const billMap = Object.fromEntries((billeteras ?? []).map(b => [b.embajador_id, b]));
    const patCount = {};
    (patrocinios ?? []).forEach(p => { patCount[p.embajador_id] = (patCount[p.embajador_id] ?? 0) + 1; });

    let generadas = 0, pagadas = 0, pendientes = 0;
    const lista = embajadores.map(e => {
      const b = billMap[e.usuario_id] ?? {};
      const disponible = Number(b.saldo_disponible ?? 0);
      const acumulado  = Number(b.saldo_acumulado ?? 0);
      const retirado   = Number(b.saldo_retirado ?? 0);
      generadas  += acumulado;
      pagadas    += retirado;
      pendientes += disponible;
      return {
        usuario_id:       e.usuario_id,
        nombre:           e.nombre,
        email:            e.email,
        comercios:        patCount[e.usuario_id] ?? 0,
        saldo_disponible: disponible,
        saldo_acumulado:  acumulado,
        saldo_retirado:   retirado,
      };
    });

    return res.json({ embajadores: lista, totales: { generadas, pagadas, pendientes } });

  } catch (err) {
    console.error('[adminResumenComisiones] Error:', err?.message ?? err);
    return res.status(500).json({ error: 'Error cargando el resumen de comisiones.' });
  }
}

// ─── registrarComisionSiAplica ────────────────────────────────────────────────

/**
 * Función interna llamada desde pedidoController cuando un pedido se marca
 * como 'entregado'. Busca si el comercio tiene un patrocinio activo y, si
 * existe, registra la comisión y actualiza la billetera del embajador.
 *
 * Es fire-and-forget desde la perspectiva del endpoint — nunca falla la
 * request principal, solo loguea si hay un error.
 *
 * @param {string} pedidoId
 * @param {string} comercioId
 * @param {number} montoBase   — subtotal del pedido (antes del fee de plataforma)
 */
export async function registrarComisionSiAplica(pedidoId, comercioId, montoBase) {
  try {
    // 1. Buscar patrocinio activo para este comercio
    const { data: patrocinio, error: patErr } = await supabaseAdmin
      .from('patrocinios')
      .select('id, embajador_id, fecha_inicio')
      .eq('comercio_id', comercioId)
      .eq('activo', true)
      .maybeSingle();

    if (patErr || !patrocinio) return; // Sin patrocinio → nada que hacer

    // 2. Calcular comisión con la tasa correcta según tiempo transcurrido
    const { tasa, porcentaje, monto, mesesActivo } = calcularComision(
      patrocinio.fecha_inicio,
      montoBase,
    );

    if (monto <= 0) return;

    // 3. Insertar en historial_comisiones (UNIQUE pedido+embajador evita duplicados)
    const { error: histErr } = await supabaseAdmin
      .from('historial_comisiones')
      .insert({
        embajador_id:   patrocinio.embajador_id,
        comercio_id:    comercioId,
        pedido_id:      pedidoId,
        monto_pedido:   montoBase,
        tasa_aplicada:  tasa,
        monto_comision: monto,
        meses_activo:   mesesActivo,
      });

    if (histErr) {
      if (histErr.code === '23505') return; // Ya registrada (idempotente)
      console.error('[Comision] Error insertando historial:', histErr.message);
      return;
    }

    // 4. Upsert billetera (incrementa saldo_disponible y saldo_acumulado)
    const { error: billErr } = await supabaseAdmin.rpc('acreditar_comision', {
      p_embajador_id: patrocinio.embajador_id,
      p_monto:        monto,
    });

    if (billErr) {
      console.error('[Comision] Error actualizando billetera:', billErr.message);
      return;
    }

    console.log(
      `[Comision] pedido:${pedidoId} | ` +
      `comercio:${comercioId} | ` +
      `embajador:${patrocinio.embajador_id} | ` +
      `${porcentaje} (${mesesActivo} meses) | ` +
      `$${monto}`
    );

  } catch (err) {
    console.error('[Comision] Excepción en registrarComisionSiAplica:', err?.message ?? err);
  }
}
