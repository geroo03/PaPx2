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

import { supabase } from '../lib/supabaseClient.js';

export async function requireAuth(req, res, next) {
  const authHeader = req.headers?.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'No autorizado: falta el token Bearer en el header Authorization.',
    });
  }

  const token = authHeader.slice(7).trim(); // remueve 'Bearer '

  if (!token) {
    return res.status(401).json({
      error: 'No autorizado: el token está vacío.',
    });
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({
      error: 'No autorizado: token inválido o sesión expirada. Volvé a iniciar sesión.',
    });
  }

  // Inyectar el usuario validado en la request para que los controllers lo consuman
  req.user = user;
  next();
}
