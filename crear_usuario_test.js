/**
 * crear_usuario_test.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Script de Node.js para crear (o reparar) el usuario de prueba en Supabase.
 *
 * PRERREQUISITO:
 *   npm install @supabase/supabase-js
 *
 * USO:
 *   node crear_usuario_test.js
 *
 * CÓMO OBTENER LA SERVICE_ROLE_KEY:
 *   Supabase Dashboard → Settings → API → "service_role" (secret)
 *   ⚠️  NUNCA expongas esta key en el frontend ni la commitees al repo.
 *
 * ALTERNATIVAS si no querés usar service_role:
 *   1. Ir a Supabase → Authentication → Settings → "Disable email confirmation"
 *      Luego usar solo la anon key.
 *   2. Ir a Supabase → Authentication → Users → confirmar manualmente el usuario.
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ─── 1. LEER CREDENCIALES ─────────────────────────────────────────────────────
// Intenta leer automáticamente desde env.js del proyecto.
// Si no está, usá las constantes manuales de abajo.

let SUPABASE_URL      = '';
let SUPABASE_ANON_KEY = '';

try {
  const envContent = fs.readFileSync(path.join(__dirname, 'env.js'), 'utf8');
  const matchUrl  = envContent.match(/SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/);
  const matchKey  = envContent.match(/SUPABASE_ANON_KEY\s*=\s*['"]([^'"]+)['"]/);
  if (matchUrl?.[1]) SUPABASE_URL      = matchUrl[1];
  if (matchKey?.[1]) SUPABASE_ANON_KEY = matchKey[1];
  console.log('✅ Keys leídas de env.js');
} catch (_) {
  console.log('⚠️  No se encontró env.js — usando constantes manuales.');
}

// ─── COMPLETÁ ESTA SECCIÓN SI env.js NO FUNCIONA ─────────────────────────────
// O si necesitás la service_role key para admin operations
if (!SUPABASE_URL)      SUPABASE_URL      = process.env.SUPABASE_URL      || '';
if (!SUPABASE_ANON_KEY) SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('❌ SUPABASE_URL y SUPABASE_ANON_KEY son requeridas.');
  console.error('   Definílas en backend/.env o en un archivo env.js local (no lo commitees).');
  process.exit(1);
}

// SERVICE_ROLE_KEY: obtenerla de Supabase Dashboard → Settings → API → service_role
// Esta key permite crear usuarios SIN confirmación de email y hacer inserts directos.
// NUNCA commitear este valor — leerlo siempre desde process.env.
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
// ─────────────────────────────────────────────────────────────────────────────

// ─── 2. DATOS DEL USUARIO DE PRUEBA ──────────────────────────────────────────
// Usar variables de entorno o valores genéricos que NO correspondan a usuarios reales.
// Ejemplo de variables: TEST_EMAIL, TEST_PASSWORD, TEST_NOMBRE en tu .env local.
const TEST = {
  email:      process.env.TEST_EMAIL    || 'test-comercio@example.com',
  password:   process.env.TEST_PASSWORD || 'test-password-local-2024',
  nombre:     process.env.TEST_NOMBRE   || 'Comercio de Prueba',
  categoria:  'comida',
  direccion:  'Av. de Prueba 123, Ciudad',
  ciudad:     'Ciudad de Prueba',
  telefono:   '3800000000',
};
// ─────────────────────────────────────────────────────────────────────────────

let sb;   // cliente con anon key (para login verify)
let sbAdmin; // cliente con service_role (para admin ops)

async function main() {
  // Cargar supabase-js dinámicamente (CJS compat)
  let createClient;
  try {
    ({ createClient } = require('@supabase/supabase-js'));
  } catch (_) {
    try {
      // Intentar desde node_modules del proyecto
      ({ createClient } = require(path.join(__dirname, 'node_modules/@supabase/supabase-js')));
    } catch (e) {
      console.error('\n❌ @supabase/supabase-js no está instalado.');
      console.error('   Ejecutá: npm install @supabase/supabase-js');
      console.error('   O desde este directorio: npm install --prefix . @supabase/supabase-js\n');
      process.exit(1);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  PaP — Crear Usuario de Prueba');
  console.log('═══════════════════════════════════════════════════════');
  console.log('  URL:   ', SUPABASE_URL);
  console.log('  Email: ', TEST.email);
  console.log('═══════════════════════════════════════════════════════\n');

  // Cliente anon (para sign-in/sign-up regulares)
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tieneServiceKey = SUPABASE_SERVICE_KEY && !SUPABASE_SERVICE_KEY.startsWith('TU_');

  if (tieneServiceKey) {
    sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    console.log('✅ Modo ADMIN con service_role key (sin confirmación de email)\n');
    await crearConAdmin(createClient);
  } else {
    console.log('⚠️  Sin service_role key — usando signUp (puede requerir confirmar email)');
    console.log('   Para evitar esto: añadí SUPABASE_SERVICE_KEY al principio del script.\n');
    await crearConSignUp();
  }
}

// ─── MODO ADMIN (service_role) ────────────────────────────────────────────────
async function crearConAdmin() {
  // Paso 1: Buscar si el usuario ya existe
  let userId = null;

  console.log('⏳ Buscando usuario en Auth...');
  const { data: listData, error: listErr } = await sbAdmin.auth.admin.listUsers({ perPage: 1000 });

  if (listErr) {
    console.error('❌ Error listando usuarios:', listErr.message);
    console.error('   Verificá que la service_role key sea correcta.');
    process.exit(1);
  }

  const existing = listData?.users?.find(u => u.email?.toLowerCase() === TEST.email.toLowerCase());

  if (existing) {
    userId = existing.id;
    console.log('✅ Usuario ya existe en Auth. ID:', userId);
    // Actualizar contraseña y metadata por si cambió
    const { error: updErr } = await sbAdmin.auth.admin.updateUserById(userId, {
      password:      TEST.password,
      email_confirm: true,
      user_metadata: { role: 'comercio', nombre: TEST.nombre },
    });
    if (updErr) console.warn('   ⚠️  No se pudo actualizar el usuario:', updErr.message);
    else        console.log('✅ Contraseña y metadata actualizados.');
  } else {
    console.log('⏳ Creando usuario en Auth...');
    const { data: newUser, error: createErr } = await sbAdmin.auth.admin.createUser({
      email:          TEST.email,
      password:       TEST.password,
      email_confirm:  true,   // ← sin necesidad de confirmar email
      user_metadata:  { role: 'comercio', nombre: TEST.nombre },
    });

    if (createErr) {
      console.error('❌ Error creando usuario:', createErr.message);
      process.exit(1);
    }
    userId = newUser.user.id;
    console.log('✅ Usuario creado. ID:', userId);
  }

  await upsertPerfilesYComercio(userId);
  await verificarLogin();
}

// ─── MODO ANON (signUp) ───────────────────────────────────────────────────────
async function crearConSignUp() {
  console.log('⏳ Ejecutando signUp...');

  const { data, error } = await sb.auth.signUp({
    email:    TEST.email,
    password: TEST.password,
    options:  { data: { role: 'comercio', nombre: TEST.nombre } },
  });

  if (error) {
    if (error.message.includes('already') || error.message.includes('registered')) {
      console.log('⚠️  El usuario ya existe. Intentando login directo...');
    } else {
      console.error('❌ Error en signUp:', error.message);
      console.log('\n💡 Si el problema es "Email not confirmed":');
      console.log('   1. Ir a Supabase → Authentication → Settings → desactivar "Confirm email"');
      console.log('   2. O confirmar manualmente en Supabase → Authentication → Users');
      process.exit(1);
    }
  } else if (data?.user?.identities?.length === 0) {
    console.log('⚠️  El email ya está registrado (identity vacía). Probando login...');
  } else {
    console.log('✅ signUp OK. ID:', data?.user?.id);
    console.log('\n📧 IMPORTANTE: Si email confirmation está habilitado en Supabase,');
    console.log('   el usuario NO podrá loguearse hasta confirmar el email.');
    console.log('   Opciones:');
    console.log('   A) Supabase Dashboard → Auth → Users → clic en el usuario → "Confirm"');
    console.log('   B) Supabase Dashboard → Auth → Settings → desactivar "Confirm email"');
    console.log('   C) Usá service_role key al inicio del script (recomendado para testing)\n');
  }

  if (data?.user?.id) {
    await upsertPerfilesYComercio(data.user.id);
  }

  await verificarLogin();
}

// ─── UPSERT PERFILES + COMERCIOS ─────────────────────────────────────────────
async function upsertPerfilesYComercio(userId) {
  const client = sbAdmin || sb;

  // perfiles
  console.log('\n⏳ Upsert en tabla perfiles...');
  const { error: perfErr } = await client
    .from('perfiles')
    .upsert(
      { id: userId, rol: 'comercio', email: TEST.email },
      { onConflict: 'id' }
    );

  if (perfErr) {
    // Si es un error de permisos, es porque el trigger ya lo creó y RLS impide el update
    if (perfErr.code === '42501' || perfErr.message.includes('violates row-level')) {
      console.log('   ⚠️  RLS bloqueó el upsert en perfiles (el trigger ya lo creó). OK.');
    } else {
      console.error('   ❌ Error en perfiles:', perfErr.message);
    }
  } else {
    console.log('✅ perfiles.rol = "comercio" insertado/actualizado');
  }

  // comercios — verificar si ya existe
  console.log('⏳ Verificando comercio...');
  const { data: existCom } = await client
    .from('comercios')
    .select('id, nombre, estado_registro')
    .eq('usuario_id', userId)
    .single();

  if (existCom) {
    console.log('✅ Comercio ya existe:');
    console.log('   ID:     ', existCom.id);
    console.log('   Nombre: ', existCom.nombre);
    console.log('   Estado: ', existCom.estado_registro);
  } else {
    console.log('⏳ Creando comercio...');
    const { data: newCom, error: comErr } = await client
      .from('comercios')
      .insert({
        nombre:                TEST.nombre,
        categoria:             TEST.categoria,
        descripcion:           'Comercio de testing',
        direccion:             TEST.direccion,
        telefono:              TEST.telefono,
        email:                 TEST.email,
        usuario_id:            userId,
        estado_registro:       'activo',        // activo para poder testear el panel
        tipo_delivery_defecto: 'app',
        activo:                true,
        abierto_ahora:         true,
        deuda:                 0,
        rating:                0,
        total_pedidos:         0,
        // creado_por_embajador_id: NULL (desacoplado, permitido por schema)
      })
      .select('id')
      .single();

    if (comErr) {
      console.error('❌ Error creando comercio:', comErr.message);
    } else {
      console.log('✅ Comercio creado. ID:', newCom.id);
    }
  }
}

// ─── VERIFICAR QUE EL LOGIN FUNCIONA ─────────────────────────────────────────
async function verificarLogin() {
  console.log('\n⏳ Verificando login con signInWithPassword...');

  const { data: loginData, error: loginErr } = await sb.auth.signInWithPassword({
    email:    TEST.email,
    password: TEST.password,
  });

  if (loginErr) {
    console.error('❌ Login FALLÓ:', loginErr.message);
    console.log('\n💡 Posibles causas:');
    if (loginErr.message.includes('Invalid login') || loginErr.message.includes('credentials')) {
      console.log('   - La contraseña en Supabase no coincide con TEST.password');
      console.log('   - Solucion: Supabase → Auth → Users → Reset password del usuario');
    }
    if (loginErr.message.includes('Email not confirmed')) {
      console.log('   - Email sin confirmar. Ver instrucciones arriba (sección signUp).');
    }
  } else {
    console.log('✅ LOGIN EXITOSO');
    console.log('   User ID: ', loginData.user?.id);
    console.log('   Email:   ', loginData.user?.email);
    console.log('   Rol meta:', loginData.user?.user_metadata?.role);
    console.log('   Sesión:  ', loginData.session?.access_token?.slice(0, 30) + '...');
    await sb.auth.signOut();
    console.log('   (sesión cerrada luego del test)');
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  Resumen de credenciales de prueba:');
  console.log('  Email:    ', TEST.email);
  console.log('  Password: ', TEST.password);
  console.log('  URL login: http://localhost:8080/login.html');
  console.log('             http://localhost:8080/comercio/login.html');
  console.log('═══════════════════════════════════════════════════════\n');
}

// ─── ARRANCAR ─────────────────────────────────────────────────────────────────
main().catch(err => {
  console.error('\n💥 Error fatal:', err.message);
  process.exit(1);
});
