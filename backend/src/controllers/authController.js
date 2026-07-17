import { supabaseAdmin } from '../lib/supabaseClient.js';

// Roles que un usuario puede asignarse al registrarse.
// 'admin' y 'embajador' solo los asigna un administrador manualmente.
// 'cliente' es el nombre actual; 'usuario' se acepta por compatibilidad con flujos viejos.
const ROLES_AUTOREGISTRO = new Set(['cliente', 'usuario', 'comercio', 'cadete']);

/**
 * POST /api/auth/set-role
 *
 * Asigna el rol de un usuario recién registrado.
 * El backend valida el rol antes de escribirlo, impidiendo auto-asignación de
 * roles privilegiados ('admin', 'embajador') desde el cliente.
 *
 * Body: { role: string }
 * Requiere: Bearer token válido (req.user inyectado por authMiddleware)
 */
/**
 * POST /api/auth/register
 *
 * Crea un usuario nuevo usando admin.createUser (sin confirmacion de email).
 * Body: { email, password, full_name?, role? }
 * Role permitido: cliente, usuario, comercio, cadete. Default: cliente.
 */
export async function register(req, res) {
  const { email, password, full_name, role } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos.' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  const rolFinal = (role && ROLES_AUTOREGISTRO.has(role)) ? role : 'cliente';
  const rolNormalizado = rolFinal === 'usuario' ? 'cliente' : rolFinal;

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: rolNormalizado, full_name: full_name ?? '' },
    });

    if (error) {
      console.error('[register] Error:', error.message);
      if (error.message.includes('already')) {
        return res.status(409).json({ error: 'Este email ya tiene una cuenta registrada.' });
      }
      return res.status(400).json({ error: error.message });
    }

    // Sincronizar en perfiles
    const { error: perfilErr } = await supabaseAdmin.from('perfiles').upsert(
      { usuario_id: data.user.id, email, rol: rolNormalizado, nombre: full_name ?? '' },
      { onConflict: 'usuario_id', ignoreDuplicates: false },
    );
    if (perfilErr) {
      console.error('[register] Error sincronizando perfil:', perfilErr.message);
    }

    // Para cadetes: crear fila placeholder
    if (rolNormalizado === 'cadete') {
      const { error: cadeteErr } = await supabaseAdmin.from('cadetes').upsert(
        { auth_uid: data.user.id, email, nombre: full_name ?? '' },
        { onConflict: 'auth_uid', ignoreDuplicates: true },
      );
      if (cadeteErr) {
        console.error('[register] Error sincronizando cadete:', cadeteErr.message);
      }
    }

    console.log(`[register] ${email} → rol '${rolNormalizado}'`);
    return res.status(201).json({ ok: true, user: { id: data.user.id, email, role: rolNormalizado } });

  } catch (err) {
    console.error('[register] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

/**
 * POST /api/auth/admin/crear-usuario
 * Solo admin. Crea cualquier rol incluyendo embajador.
 */
export async function crearUsuarioAdmin(req, res) {
  const { email, password, nombre, role } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
  }

  const ROLES_VALIDOS = new Set(['cliente', 'comercio', 'cadete', 'embajador']);
  const rolFinal = ROLES_VALIDOS.has(role) ? role : 'cliente';

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { role: rolFinal, full_name: nombre ?? '' },
    });

    if (error) {
      if (error.message.includes('already')) {
        return res.status(409).json({ error: 'Este email ya tiene una cuenta.' });
      }
      return res.status(400).json({ error: error.message });
    }

    const { error: perfilErr2 } = await supabaseAdmin.from('perfiles').upsert(
      { usuario_id: data.user.id, email, rol: rolFinal, nombre: nombre ?? '' },
      { onConflict: 'usuario_id', ignoreDuplicates: false },
    );
    if (perfilErr2) {
      console.error('[crearUsuarioAdmin] Error sincronizando perfil:', perfilErr2.message);
    }

    if (rolFinal === 'cadete') {
      const { error: cadeteErr2 } = await supabaseAdmin.from('cadetes').upsert(
        { auth_uid: data.user.id, email, nombre: nombre ?? '' },
        { onConflict: 'auth_uid', ignoreDuplicates: true },
      );
      if (cadeteErr2) {
        console.error('[crearUsuarioAdmin] Error sincronizando cadete:', cadeteErr2.message);
      }
    }

    console.log(`[crearUsuarioAdmin] ${email} → rol '${rolFinal}' creado por admin ${req.user.email}`);
    return res.status(201).json({ ok: true, user: { id: data.user.id, email, role: rolFinal } });
  } catch (err) {
    console.error('[crearUsuarioAdmin]', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}

export async function setRole(req, res) {
  const { role } = req.body ?? {};

  if (!role) {
    return res.status(400).json({ error: 'Falta el campo: role.' });
  }

  if (!ROLES_AUTOREGISTRO.has(role)) {
    return res.status(403).json({
      error: `El rol '${role}' no puede asignarse mediante auto-registro.`,
    });
  }

  if (!supabaseAdmin) {
    console.error('[setRole] supabaseAdmin no inicializado. Verificá SUPABASE_SERVICE_ROLE_KEY en .env');
    return res.status(500).json({ error: 'Error de configuración del servidor.' });
  }

  try {
    // Actualizar user_metadata vía Admin API (no expuesto al cliente)
    const { error: authErr } = await supabaseAdmin.auth.admin.updateUserById(
      req.user.id,
      { user_metadata: { role } },
    );

    if (authErr) {
      console.error('[setRole] Error al actualizar user_metadata:', authErr.message);
      return res.status(500).json({ error: 'No se pudo asignar el rol.' });
    }

    // Normalizar: si el cliente envió 'usuario' (nombre viejo), guardamos 'cliente'
    const rolNormalizado = role === 'usuario' ? 'cliente' : role;

    // Sincronizar en 'perfiles' usando usuario_id (FK a auth.users, no la PK random)
    const { error: perfilErr3 } = await supabaseAdmin
      .from('perfiles')
      .upsert(
        { usuario_id: req.user.id, email: req.user.email ?? '', rol: rolNormalizado },
        { onConflict: 'usuario_id', ignoreDuplicates: false },
      );
    if (perfilErr3) {
      console.error('[setRole] Error sincronizando perfil:', perfilErr3.message);
    }

    // Para cadetes: crear fila placeholder en 'cadetes' si aún no existe.
    // El cadete completa el resto (vehículo, patente, etc.) desde su perfil en el dashboard.
    if (role === 'cadete') {
      const { error: cadeteErr3 } = await supabaseAdmin
        .from('cadetes')
        .upsert(
          { auth_uid: req.user.id, email: req.user.email ?? '' },
          { onConflict: 'auth_uid', ignoreDuplicates: true },
        );
      if (cadeteErr3) {
        console.error('[setRole] Error sincronizando cadete:', cadeteErr3.message);
      }
    }

    return res.status(200).json({ ok: true, role });

  } catch (err) {
    console.error('[setRole] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
