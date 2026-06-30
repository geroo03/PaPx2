/**
 * authMiddleware.js
 *
 * Reemplaza el equivalente de session_start() de PHP en el stack moderno.
 *
 * Flujo:
 *   1. Extrae el token del header Authorization: Bearer <token>
 *   2. Llama a supabase.auth.getUser(token) — Supabase verifica la firma JWT
 *      y su expiración contra la clave secreta del proyecto sin round-trip a DB.
 *   3. Si el token es inválido o expiró → 401 con JSON descriptivo.
 *   4. Si es válido → inyecta `req.user` con el objeto User de Supabase y
 *      llama a next() para continuar hacia el controller.
 *
 * `req.user` contiene entre otros:
 *   id            → UUID del usuario autenticado
 *   email         → email registrado
 *   user_metadata → metadata del JWT (no confiar para roles — usar tabla profiles)
 */

import { supabaseAdmin, supabase } from '../lib/supabaseClient.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers?.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'No autorizado: falta el token Bearer en el header Authorization.',
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      error: 'No autorizado: el token está vacío.',
    });
  }

  // Usar supabaseAdmin (SERVICE_ROLE) para validar el JWT — más fiable que ANON
  // porque la SERVICE_ROLE key está definitivamente configurada en el mismo proyecto
  const client = supabaseAdmin || supabase;
  const { data: { user }, error } = await client.auth.getUser(token);

  if (error || !user) {
    console.error('[Auth] getUser falló:', error?.message, '| token[:20]:', token.slice(0,20));
    return res.status(401).json({
      error: 'No autorizado: token inválido o sesión expirada. Volvé a iniciar sesión.',
    });
  }

  req.user = user;
  next();
}

export async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    try {
      const { data: perfil } = await supabaseAdmin
        .from('perfiles')
        .select('rol')
        .eq('usuario_id', req.user.id)
        .maybeSingle();
      if (perfil?.rol !== 'admin') {
        return res.status(403).json({ error: 'Acceso denegado: se requiere rol admin.' });
      }
      next();
    } catch (e) {
      return res.status(500).json({ error: 'Error verificando permisos.' });
    }
  });
}
