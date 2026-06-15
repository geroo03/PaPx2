import { supabaseAdmin } from './supabaseClient.js';

/**
 * Resuelve el rol del usuario desde la tabla 'perfiles' (fuente de verdad).
 * Fallback a user_metadata solo si perfiles no tiene fila aún.
 *
 * IMPORTANTE: usa usuario_id (FK a auth.users), NO id (PK random de perfiles).
 */
export async function resolveRol(userId, userMetadata = {}) {
  try {
    const { data: perfil } = await supabaseAdmin
      .from('perfiles')
      .select('rol')
      .eq('usuario_id', userId)
      .maybeSingle();
    if (perfil?.rol) return perfil.rol;
  } catch { /* fallback */ }
  return userMetadata?.role ?? null;
}
