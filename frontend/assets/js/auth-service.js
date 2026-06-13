// Lightweight Supabase auth wrapper (production - browser globals)
// This file intentionally contains NO service-role secrets. It uses the global `window.supabase` client provided by the CDN.

let sbClient = null;
export function initAuthClient() {
  if (!sbClient) {
    sbClient = window.supabase || window.sb || null;
    if (!sbClient) console.warn('auth-service: no supabase client available; ensure supabase is loaded via CDN');
  }
  return sbClient;
}

export function getClient(){ return sbClient || initAuthClient(); }

export async function signInWithPassword({ email, password }){
  if(!sbClient) initAuthClient();
  return await sbClient.auth.signInWithPassword({ email, password });
}

export async function signUp({ email, password, options }){
  if(!sbClient) initAuthClient();
  return await sbClient.auth.signUp({ email, password, options });
}

// Sign up y asignación de rol delegada al backend.
//
// SEGURIDAD: auth.updateUser({ data: { role } }) fue eliminado intencionalmente.
// Llamarlo desde el cliente permite que cualquier usuario se auto-asigne 'admin'.
// El rol se asigna ahora exclusivamente en el servidor via POST /api/auth/set-role.
//
// Flujo:
//   1. signUp → crea la cuenta (el trigger DB asigna 'usuario' por defecto).
//   2. Si role !== 'usuario', llama al backend con el Bearer token de la sesión.
//   3. El backend valida el rol, actualiza user_metadata via Admin API y upsert perfiles.
export async function signUpAndAssignRole({ email, password, full_name, role = 'usuario' }){
  if(!sbClient) initAuthClient();

  // Paso 1: crear la cuenta sin metadata de rol (el trigger DB se encarga del default)
  const signUpRes = await sbClient.auth.signUp({
    email,
    password,
    options: { data: { full_name } },
  });
  if (signUpRes.error) return signUpRes;

  // Roles que no requieren llamada al backend (el trigger DB los asigna por defecto)
  if (role === 'usuario') {
    return { data: { signUp: signUpRes.data, session: signUpRes.data?.session ?? null }, error: null };
  }

  // Paso 2: obtener sesión para poder autenticarse contra el backend
  let session = signUpRes.data?.session ?? null;
  if (!session) {
    const signInRes = await sbClient.auth.signInWithPassword({ email, password });
    if (signInRes.error) {
      return { data: { signUp: signUpRes.data, session: null }, error: signInRes.error };
    }
    session = signInRes.data?.session ?? null;
  }

  if (!session?.access_token) {
    return { data: { signUp: signUpRes.data, session: null }, error: null };
  }

  // Paso 3: delegar la asignación de rol al backend
  try {
    const backendUrl = (typeof window !== 'undefined' && window.BACKEND_URL)
      ? window.BACKEND_URL
      : '';

    if (!backendUrl) {
      console.warn('[auth-service] BACKEND_URL no definido — rol no asignado. Definilo en env.js.');
      return { data: { signUp: signUpRes.data, session }, error: null };
    }

    const roleRes = await fetch(`${backendUrl}/api/auth/set-role`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ role }),
    });

    if (!roleRes.ok) {
      const errBody = await roleRes.json().catch(() => ({}));
      console.error('[auth-service] set-role falló:', errBody.error ?? roleRes.status);
      return {
        data:  { signUp: signUpRes.data, session },
        error: { message: errBody.error ?? 'No se pudo asignar el rol en el servidor' },
      };
    }

    return { data: { signUp: signUpRes.data, session }, error: null };

  } catch (err) {
    console.error('[auth-service] Error llamando set-role:', err?.message ?? err);
    return { data: { signUp: signUpRes.data, session }, error: err };
  }
}

export async function signInWithOAuth(provider, opts){
  if(!sbClient) initAuthClient();
  // If running on localhost:8000, ensure redirectTo points to a root page that exists locally.
  try {
    const safeOpts = Object.assign({}, opts || {});
    // If no explicit redirectTo provided, and we're on localhost:8000, set a sensible default
    if((!safeOpts.redirectTo && !safeOpts?.options?.redirectTo) || (safeOpts.options && !safeOpts.options.redirectTo)){
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : null;
      if(origin && origin.indexOf('127.0.0.1:8000') !== -1 || origin && origin.indexOf('localhost:8000') !== -1){
        // prefer a generic index landing; callers should still validate their flows
        safeOpts.options = Object.assign({}, safeOpts.options || {}, { redirectTo: origin + '/index.html' });
      }
    }
    return await sbClient.auth.signInWithOAuth({ provider, options: safeOpts.options || safeOpts });
  } catch (err) {
    // Surface debug information to the console and to the user
    console.error('DEBUG SUPABASE: signInWithOAuth error', err && err.message ? err.message : err);
    try { alert('Error de Supabase (OAuth): ' + (err && err.message ? err.message : String(err))); } catch(e){}
    throw err;
  }
}

export async function getSession(){
  if(!sbClient) initAuthClient();
  return await sbClient.auth.getSession();
}

export async function resetPasswordForEmail(email, opts){
  if(!sbClient) initAuthClient();
  return await sbClient.auth.resetPasswordForEmail(email, opts);
}

export async function signOut(){ if(!sbClient) initAuthClient(); return await sbClient.auth.signOut(); }

// verifyUserRole reads the role strictly from the Supabase session metadata
export function verifyUserRole(session){
  return session?.user?.user_metadata?.role || null;
}

// Expose a tiny global bridge for pages that rely on window.authService
if (typeof window !== 'undefined') {
  window.authService = window.authService || {};
  window.authService.initAuthClient = initAuthClient;
  window.authService.getClient = getClient;
  window.authService.signInWithPassword = signInWithPassword;
  window.authService.signUp = signUp;
  window.authService.signUpAndAssignRole = signUpAndAssignRole;
  window.authService.getSession = getSession;
  window.authService.signOut = signOut;
  window.authService.verifyUserRole = verifyUserRole;
}
