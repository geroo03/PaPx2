/**
 * login.js — Puerta a Puerta X — Módulo de autenticación unificado
 * Arquitectura serverless directa a Supabase.
 *
 * Flujo:
 *   signInWithPassword()
 *     → query perfiles.rol (tabla real)
 *     → fallback a user_metadata.role si perfiles no existe aún
 *     → sessionStorage con uid, rol (y cid para comercios)
 *     → redirect según rol
 */

import { supabase as sb } from './config.js';

// ─── RUTAS POR ROL ────────────────────────────────────────────────────────────
// Paths absolutos para que funcionen desde cualquier subcarpeta del proyecto.
const RUTAS = {
  usuario:   '/cliente/index.html',
  cliente:   '/cliente/index.html',
  comercio:  '/comercio/comercio.html',
  cadete:    '/cadete/cadete.html',
  embajador: '/embajador/dashboard.html',
  admin:     '/admin/admin.html',
};


// No auto-redirect: si el usuario está en login.html, quiere loguearse.
// El redirect solo ocurre después de un login exitoso.

// ─── BIND: cuando el DOM esté listo ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindForm();
  bindPasswordToggle();
  bindRegisterMenu();
  // Mostrar checkbox TyC si no aceptó antes
  if (!localStorage.getItem('pap_tyc_aceptados')) {
    const wrap = document.getElementById('tyc-wrap');
    if (wrap) wrap.style.display = 'block';
  }
});

// Detectar retorno del email de reset de contraseña (Supabase procesa el hash automáticamente)
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    showRecoveryForm();
  }
});

// ─── BIND FORM ────────────────────────────────────────────────────────────────
function bindForm() {
  const btnLogin = document.getElementById('btn-login');
  const inputPass = document.getElementById('input-pass');

  btnLogin?.addEventListener('click', handleLogin);
  // Enter en cualquier input dispara el login
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) handleLogin();
  });

  // Recuperar contraseña
  document.getElementById('link-olvide')?.addEventListener('click', handleForgot);
}

// ─── HANDLER LOGIN ────────────────────────────────────────────────────────────
async function handleLogin() {
  const email = (document.getElementById('input-email')?.value || '').trim();
  const pass  = (document.getElementById('input-pass')?.value  || '');
  const btn   = document.getElementById('btn-login');

  if (!email || !pass) { showError('Completa email y contrasena.'); return; }

  // Verificar TyC si no aceptó antes
  if (!localStorage.getItem('pap_tyc_aceptados')) {
    const chk = document.getElementById('chk-tyc');
    if (chk && !chk.checked) { showError('Debes aceptar los terminos y condiciones para continuar.'); return; }
    localStorage.setItem('pap_tyc_aceptados', new Date().toISOString());
  }

  setLoading(btn, true);
  hideMessages();

  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;

    showOk('Verificando acceso...');
    await redirectPorRol(data.user.id, false);

  } catch (err) {
    setLoading(btn, false);
    if (err.message?.toLowerCase().includes('invalid login') ||
        err.message?.toLowerCase().includes('invalid') ||
        err.message?.toLowerCase().includes('credentials')) {
      showError('Email o contraseña incorrectos.');
    } else if (err.message?.toLowerCase().includes('email not confirmed')) {
      showError('Confirmá tu email antes de ingresar. Revisá tu casilla de correo.');
    } else {
      showError('Error al ingresar. Intentá nuevamente.');
      console.error('[PaP Login]', err.message);
    }
  }
}

// ─── REDIRECT POR ROL (núcleo del módulo) ─────────────────────────────────────
// Consulta la tabla REAL 'perfiles' para obtener el rol del usuario.
// Embajador: redirige a su dashboard. Sus comercios asociados pueden tener campos NULL.
async function redirectPorRol(userId, silencioso = false) {
  // 1. Consultar tabla 'perfiles' — fuente de verdad para el rol
  // usuario_id es el FK a auth.users; 'id' en perfiles es un UUID random (nueva schema)
  const { data: perfil, error: perfErr } = await sb
    .from('perfiles')
    .select('rol')
    .eq('usuario_id', userId)
    .single();

  let rol = perfil?.rol ?? null;

  // 2. Fallback: user_metadata.role (asignado por admin en Supabase Dashboard)
  //    Solo se usa si perfiles aún no tiene la fila (ej: usuario recién creado)
  if (!rol || perfErr) {
    const { data: { user } } = await sb.auth.getUser();
    rol = user?.user_metadata?.role ?? null;
  }

  // 3. Sin rol → sesión inválida, desloguear
  if (!rol) {
    if (!silencioso) showError('Tu cuenta no tiene un rol asignado. Contactá al administrador.');
    await sb.auth.signOut();
    return;
  }

  // 4. Verificar que el rol sea conocido
  if (!RUTAS[rol]) {
    if (!silencioso) showError(`Rol desconocido: "${rol}". Contactá al administrador.`);
    await sb.auth.signOut();
    return;
  }

  // 5. Guardar en sessionStorage para consumo downstream
  try {
    sessionStorage.setItem('pap_rol', rol);
    sessionStorage.setItem('pap_uid', userId);
  } catch (_) {}

  // 6. Si es comercio → también cargar comercio_id para el panel
  if (rol === 'comercio') {
    const { data: com } = await sb
      .from('comercios')
      .select('id, nombre')
      .eq('usuario_id', userId)
      .single();
    if (com) {
      try {
        sessionStorage.setItem('pap_cid',           com.id);
        sessionStorage.setItem('pap_comercio_nombre', com.nombre);
      } catch (_) {}
    }
  }

  // 7. Embajador: sus comercios pueden tener creado_por_embajador_id en NULL
  //    No requiere manejo especial en el login — solo la redirección correcta.

  // 8. Redirigir
  location.href = RUTAS[rol];
}

// ─── HANDLER FORGOT PASSWORD ──────────────────────────────────────────────────
async function handleForgot() {
  const email = (document.getElementById('input-email')?.value || '').trim();
  if (!email) { showError('Escribí tu email para recuperar la contraseña.'); return; }

  try {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/login.html',
    });
    if (error) throw error;
    showOk('Te enviamos un email para restablecer tu contraseña. Revisá tu casilla.');
  } catch (err) {
    showError('No pudimos enviar el email. Verificá la dirección.');
  }
}

// ─── PASSWORD TOGGLE ──────────────────────────────────────────────────────────
function bindPasswordToggle() {
  const btn    = document.getElementById('toggle-pass');
  const pass   = document.getElementById('input-pass');
  const eyeOpen   = btn?.querySelector('.eye-open');
  const eyeClosed = btn?.querySelector('.eye-closed');
  if (!btn || !pass) return;

  btn.addEventListener('click', () => {
    const isPass = pass.type === 'password';
    pass.type = isPass ? 'text' : 'password';
    if (eyeOpen)   eyeOpen.style.display   = isPass ? 'none'  : 'block';
    if (eyeClosed) eyeClosed.style.display = isPass ? 'block' : 'none';
    btn.setAttribute('aria-label', isPass ? 'Ocultar contraseña' : 'Mostrar contraseña');
    pass.focus();
  });
}

// ─── REGISTER MENU ────────────────────────────────────────────────────────────
function bindRegisterMenu() {
  const btnReg = document.getElementById('btn-register');
  const menu   = document.getElementById('register-menu');
  if (!btnReg || !menu) return;

  btnReg.addEventListener('click', e => {
    e.stopPropagation();
    menu.classList.toggle('is-hidden');
  });

  // Cerrar al clicar fuera
  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== btnReg) {
      menu.classList.add('is-hidden');
    }
  });

  // Botones dentro del menú — cada uno navega a su registro
  menu.querySelectorAll('[data-register]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.register;
      if (tipo === 'comercio') location.href = '/comercio/registro-comercio.html';
      else if (tipo === 'cadete')  location.href = '/cadete/registro-cadete.html';
      else                          location.href = '/cliente/login-usuario.html?tab=registro';
    });
  });
}

// ─── PASSWORD RECOVERY FORM ───────────────────────────────────────────────────
function showRecoveryForm() {
  const card = document.querySelector('.card');
  if (!card) return;
  card.innerHTML = `
    <div style="text-align:center;margin-bottom:20px;">
      <div style="font-size:36px;margin-bottom:8px;">🔑</div>
      <div style="font-size:20px;font-weight:800;color:#111;margin-bottom:4px;">Nueva contraseña</div>
      <div style="font-size:13px;color:#888;">Elegí una contraseña nueva para tu cuenta.</div>
    </div>
    <div class="form-group">
      <label class="form-label">Nueva contraseña <span style="color:#FF6B35">*</span></label>
      <input class="form-input" id="rec-pass" type="password" placeholder="Mínimo 6 caracteres" autocomplete="new-password">
    </div>
    <div class="form-group">
      <label class="form-label">Repetir contraseña <span style="color:#FF6B35">*</span></label>
      <input class="form-input" id="rec-pass2" type="password" placeholder="Repetí la contraseña" autocomplete="new-password">
    </div>
    <button class="btn-login" id="btn-rec" onclick="submitRecovery()">Guardar contraseña</button>
    <div class="error-msg"   id="error-msg"  style="display:none"></div>
    <div class="success-msg" id="success-msg" style="display:none"></div>
  `;
}

window.submitRecovery = async function() {
  const pass  = document.getElementById('rec-pass')?.value || '';
  const pass2 = document.getElementById('rec-pass2')?.value || '';
  const btn   = document.getElementById('btn-rec');

  if (pass.length < 8) { showError('La contraseña debe tener al menos 8 caracteres.'); return; }
  if (pass !== pass2)  { showError('Las contraseñas no coinciden.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
  try {
    const { error } = await sb.auth.updateUser({ password: pass });
    if (error) throw error;
    showOk('Contraseña actualizada. Redirigiendo...');
    setTimeout(async () => {
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        await redirectPorRol(user.id, true);
      } else {
        location.href = '/login.html';
      }
    }, 1500);
  } catch (err) {
    showError('No se pudo actualizar la contraseña. Intentá de nuevo.');
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar contraseña'; }
  }
};

// ─── UI HELPERS ───────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('error-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  const ok = document.getElementById('success-msg');
  if (ok) ok.style.display = 'none';
}

function showOk(msg) {
  const el = document.getElementById('success-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  const err = document.getElementById('error-msg');
  if (err) err.style.display = 'none';
}

function hideMessages() {
  ['error-msg','success-msg'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.display = 'none';
  });
}

function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? 'Ingresando...' : 'Ingresar';
}
