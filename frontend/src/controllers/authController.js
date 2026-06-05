import { supabase } from '../config/supabase.js';

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Campos requeridos' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // supabase returns { error } when auth fails
      return res.status(401).json({ error: error.message || 'Autenticación fallida' });
    }

    // Defensive: ensure data.user exists and has metadata with a role
    const safeUser = (data && data.user) ? { ...data.user } : null;
    if (!safeUser) {
      // This is an unexpected situation but handle it gracefully
      return res.status(500).json({ error: 'Usuario no encontrado en respuesta de autenticación' });
    }

    // Normalize metadata safely: user_metadata may be null/undefined
    const userMetadata = (safeUser.user_metadata && typeof safeUser.user_metadata === 'object') ? safeUser.user_metadata : {};
    const appMetadata = (safeUser.app_metadata && typeof safeUser.app_metadata === 'object') ? safeUser.app_metadata : {};

    // Ensure role exists and defaults to 'cliente'
    const role = (userMetadata.role) ? userMetadata.role : (appMetadata.role ? appMetadata.role : 'cliente');
    // Attach a safe role to the returned user object to avoid frontend NPE
    safeUser.user_metadata = { ...userMetadata, role };

    return res.status(200).json({ user: safeUser, session: data.session || null });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Error in login controller:', err && err.message ? err.message : err);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
