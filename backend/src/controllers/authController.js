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
    await supabaseAdmin
      .from('perfiles')
      .upsert(
        { usuario_id: req.user.id, rol: rolNormalizado },
        { onConflict: 'usuario_id', ignoreDuplicates: false },
      );

    // Para cadetes: crear fila placeholder en 'cadetes' si aún no existe.
    // El cadete completa el resto (vehículo, patente, etc.) desde su perfil en el dashboard.
    if (role === 'cadete') {
      await supabaseAdmin
        .from('cadetes')
        .upsert(
          { auth_uid: req.user.id, email: req.user.email ?? '' },
          { onConflict: 'auth_uid', ignoreDuplicates: true },
        );
    }

    return res.status(200).json({ ok: true, role });

  } catch (err) {
    console.error('[setRole] Excepción:', err?.message ?? err);
    return res.status(500).json({ error: 'Error interno del servidor.' });
  }
}
