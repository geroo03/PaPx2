// Root login page. Usa el cliente Supabase inicializado por el UMD bundle del HTML.
// NO importa config.js para evitar la cadena de sub-módulos ESM que causa 404.
const sb = window.sb;

// currentTab values: 'login' | 'registro' (form mode). We also track selectedRole for redirect: 'cliente'|'comercio'|'cadete'|'admin'
let currentTab = 'login';
let selectedRole = localStorage.getItem('selectedRole') || 'cliente';
let sessionActual = null;

function safeGet(id){ try { return document.getElementById(id); } catch(e) { return null; } }

function setTab(tab) {
  currentTab = tab;
  const tLogin = safeGet('tab-login'); if(tLogin) tLogin.classList.toggle('active', tab==='login');
  const tReg = safeGet('tab-reg'); if(tReg) tReg.classList.toggle('active', tab==='registro');
  const gNombre = safeGet('grupo-nombre'); if(gNombre) gNombre.style.display = tab==='registro' ? 'block' : 'none';
  const forgot = safeGet('forgot-wrap'); if(forgot) forgot.style.display = tab==='login' ? 'block' : 'none';
  const btn = safeGet('btn-submit'); if(btn) btn.textContent = tab==='login' ? 'Ingresar' : 'Crear cuenta';
  const tText = safeGet('toggle-text'); if(tText) tText.textContent = tab==='login' ? '¿No tenés cuenta? ' : '¿Ya tenés cuenta? ';
  const tLink = safeGet('toggle-link'); if(tLink) tLink.textContent = tab==='login' ? 'Registrate gratis' : 'Ingresá acá';
  ocultarMensajes();
}

// Set the visual role tabs (cliente/comercio/cadete/admin) and persist selection
function setRole(role){
  selectedRole = role || 'cliente';
  try{ localStorage.setItem('selectedRole', selectedRole); }catch(e){}
  // Update any visual markers if present
  const roleTabs = document.querySelectorAll('[data-role-tab]');
  roleTabs.forEach(el=> el.classList.toggle('active', el.getAttribute('data-role-tab')===selectedRole));
}

function showError(msg){ const el = safeGet('msg-error'); if(el){ el.textContent = msg; el.style.display='block'; } const ok = safeGet('msg-ok'); if(ok) ok.style.display='none'; }
function showOk(msg){ const el = safeGet('msg-ok'); if(el){ el.textContent = msg; el.style.display='block'; } const err = safeGet('msg-error'); if(err) err.style.display='none'; }
function ocultarMensajes(){ const a = safeGet('msg-error'); const b = safeGet('msg-ok'); if(a) a.style.display='none'; if(b) b.style.display='none'; }

function redirigirSegunRol(rol){
  try{
    // Prefer explicit role from session; otherwise fall back to the UI-selected role
    const r = rol || selectedRole || localStorage.getItem('selectedRole') || 'cliente';
    // Use absolute root-based paths so redirections work from any folder (Netlify)
    if (r === 'cliente' || r === 'usuario') return window.location.href = '/cliente/index.html';
    if (r === 'comercio') return window.location.href = '/comercio/comercio.html';
    if (r === 'cadete') return window.location.href = '/cadete/cadete.html';
    if (r === 'admin') return window.location.href = '/admin/admin.html';
    return showError('Tu cuenta no tiene un rol asignado. Contactá al administrador.');
  }catch(e){ console.error('redirigirSegunRol error', e); }
}

async function loginGoogle(){
  try{
    const origin = (window && window.location && window.location.origin) ? window.location.origin : '';
    let returnUrl = origin + '/cliente/login-usuario.html';
    if(origin.includes('127.0.0.1:8000') || origin.includes('localhost:8000')) returnUrl = origin + '/index.html';
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl } });
    if(error){ console.error('DEBUG SUPABASE: OAuth error', error); try{ alert('Error de Supabase (OAuth): ' + (error?.message || JSON.stringify(error))); }catch(e){} }
  }catch(e){ console.error('DEBUG SUPABASE: loginGoogle catch', e); try{ alert('Error de Supabase (OAuth): ' + String(e)); }catch(_){ } showError('Error al conectar con Google. Intentá de nuevo.'); }
}

async function submitForm(){
  const emailEl = safeGet('input-email'); const passEl = safeGet('input-pass'); const nombreEl = safeGet('input-nombre'); const btn = safeGet('btn-submit');
  const email = emailEl ? emailEl.value.trim() : '';
  const pass  = passEl ? passEl.value : '';
  const nombre = nombreEl ? nombreEl.value.trim() : '';

  if(!email || !pass){ showError('Completá todos los campos.'); return; }
  if(currentTab === 'registro' && !nombre){ showError('Escribí tu nombre completo.'); return; }
  if(pass.length < 6){ showError('La contraseña debe tener al menos 6 caracteres.'); return; }

  if(btn){ btn.disabled = true; btn.textContent = currentTab === 'login' ? 'Ingresando...' : 'Creando cuenta...'; }

  try{
    if(currentTab === 'login'){
      const authBridge = (typeof window !== 'undefined' && window.authService && window.authService.signInWithPassword) ? window.authService : null;
      let res;
      if(authBridge) res = await authBridge.signInWithPassword({ email, password: pass });
      else res = await sb.auth.signInWithPassword({ email, password: pass });
      const { data, error } = res || {};
      if(error){ console.error('DEBUG SUPABASE: signInWithPassword error', error); try{ alert('Error de Supabase (login): ' + (error?.message || JSON.stringify(error))); }catch(e){} throw error; }
      sessionActual = data?.session || null;
      const rol = data?.user?.user_metadata?.role;
      if(!rol){ showError('Tu cuenta no tiene rol asignado. Contactá al administrador para habilitar el acceso.'); if(btn){btn.disabled=false;btn.textContent='Ingresar';} return; }
      try{ localStorage.setItem('role', rol); }catch(e){}
      redirigirSegunRol(rol);
    } else {
      if(window.authService && typeof window.authService.signUpAndAssignRole === 'function'){
        const res = await window.authService.signUpAndAssignRole({ email, password: pass, full_name: nombre, role: 'usuario' });
        if(res.error) throw res.error;
        sessionActual = res.data?.session || null;
        window.location.href = '/index.html';
        return;
      }
      const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { full_name: nombre } } });
      if(error) throw error;
      sessionActual = data?.session || null;
      showOk('Cuenta creada. Esperá que un administrador asigne tu rol para poder ingresar.');
      if(btn){ btn.disabled = false; btn.textContent = 'Crear cuenta'; }
    }
  }catch(e){
    const msg = (e && e.message) ? e.message : 'Algo salió mal. Intentá de nuevo.';
    if(msg.includes && (msg.includes('Invalid login')||msg.includes('invalid'))) showError('Email o contraseña incorrectos.');
    else if(msg.includes && msg.includes('Email not confirmed')) showError('Confirmá tu email antes de ingresar.');
    else if(msg.includes && msg.includes('already registered')) showError('Este email ya tiene cuenta. Ingresá con tu contraseña.');
    else showError(msg);
    if(btn){ btn.disabled = false; btn.textContent = currentTab === 'login' ? 'Ingresar' : 'Crear cuenta'; }
  }
}

async function olvideClave(){
  const emailEl = safeGet('input-email'); const email = emailEl ? emailEl.value.trim() : '';
  if(!email){ showError('Escribí tu email primero.'); return; }
  try{ await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href }); showOk('Te enviamos un email para restablecer tu contraseña.'); }
  catch(e){ console.error('resetPasswordForEmail error', e); showError('Error al enviar el email.'); }
}

function attachFormListener(){
  const form = safeGet('loginForm'); if(form) form.addEventListener('submit', function(e){ e.preventDefault(); submitForm(); });
}

async function initSessionCheck(){
  try{
    if(sb && sb.auth && typeof sb.auth.getSession === 'function'){
      const resp = await sb.auth.getSession();
      const session = resp?.data?.session || null;
      if(session){ sessionActual = session; const rol = session.user?.user_metadata?.role; if(!rol) { showError('Tu cuenta no tiene rol asignado. Contactá al administrador para habilitar el acceso.'); } else redirigirSegunRol(rol); }
    }
  }catch(e){ console.error('initSessionCheck error', e); }
}

// Initialize DOM-related handlers safely after DOM is ready
if(typeof window !== 'undefined'){
  window.addEventListener('DOMContentLoaded', ()=>{
    try{ attachFormListener(); initSessionCheck(); }
    catch(e){ console.error('login-root init error', e); }
  });

  // Expose minimal API for inline handlers
  window.setTab = function(tab){ try{ setTab(tab); }catch(e){console.error('setTab error', e);} };
  window.loginGoogle = function(){ try{ return loginGoogle(); }catch(e){console.error('loginGoogle error', e);} };
  window.olvideClave = function(){ try{ return olvideClave(); }catch(e){console.error('olvideClave error', e);} };
  window.setRole = function(role){ try{ return setRole(role); }catch(e){console.error('setRole error', e);} };
}
