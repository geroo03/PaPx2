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

// Sign up and (client-side) assign a default role to the newly-created user.
// Note: this updates the authenticated user's user_metadata from the client.
// It attempts to sign the user in after signup (if a session isn't already provided)
// so updateUser can run. If your Supabase project requires email confirmations
// this flow may need an Edge Function to set roles server-side instead.
export async function signUpAndAssignRole({ email, password, full_name, role = 'usuario' }){
  if(!sbClient) initAuthClient();
  // create account
  const signUpRes = await sbClient.auth.signUp({ email, password, options: { data: { full_name } } });
  if (signUpRes.error) return signUpRes;

  // If signUp returned a session, use it. Otherwise try to sign in to obtain a session.
  let session = signUpRes.data?.session || null;
  if (!session) {
    const signInRes = await sbClient.auth.signInWithPassword({ email, password });
    if (signInRes.error) {
      // Return signUp result and the signIn error so caller can decide.
      return { data: { signUp: signUpRes.data, session: null }, error: signInRes.error };
    }
    session = signInRes.data?.session || null;
  }

  // With a valid session, update the user's metadata to set the role.
  try {
    const updateRes = await sbClient.auth.updateUser({ data: { role } });
    return { data: { signUp: signUpRes.data, session, update: updateRes.data }, error: updateRes.error || null };
  } catch (err) {
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
