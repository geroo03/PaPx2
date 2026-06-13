// ─── config.js — Shim UMD ────────────────────────────────────────────────────
// NO importa desde la CDN ESM para evitar la cadena de sub-módulos (auth-js,
// realtime-js, tslib, iceberg-js…) que causa 404 en servidores locales.
// El cliente real lo provee el bundle UMD cargado en cada HTML mediante:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.43.4/dist/umd/supabase.js">
// y luego: window.sb = window.supabase.createClient(URL, KEY)

// ─── BANDERA DE MODO MOCK ─────────────────────────────────────────────────────
export const USE_MOCK = false;

// ─── COORDENADAS DE SUPABASE ──────────────────────────────────────────────────
export const SUPA_URL = (typeof window !== 'undefined' && window.SUPABASE_URL)     ? window.SUPABASE_URL     : '';
export const SUPA_KEY = (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) ? window.SUPABASE_ANON_KEY : '';

// ─── CLIENTE SUPABASE ─────────────────────────────────────────────────────────
// Lee window.sb (inicializado por el guard de sesión del HTML).
// Si no existe aún, lo crea desde el UMD global window.supabase.createClient.
function _resolveClient() {
  if (typeof window === 'undefined') return null;
  if (window.sb) return window.sb;
  const factory = window.supabase && window.supabase.createClient;
  if (factory && SUPA_URL && SUPA_KEY) {
    window.sb = factory(SUPA_URL, SUPA_KEY);
    return window.sb;
  }
  console.warn('[PaP config] Cliente Supabase no disponible aún. Asegurate de cargar el UMD bundle antes de este módulo.');
  return null;
}

export const supabase = _resolveClient();

// Log de validación (no arroja, solo informa)
(function validateSupabaseConfig(){
  try{
    const ok = !!(supabase && SUPA_URL && SUPA_URL.indexOf('supabase.co') !== -1);
    if (typeof window !== 'undefined') window.SUPABASE_CONFIG_OK = ok;
    if (!ok) console.warn('⚠️ [PaP] Supabase client no inicializado correctamente. Verificá env.js y el UMD bundle.');
  }catch(e){ /* no-op */ }
})();

// ─── MOTOR CENTRAL DE DATOS MOCK ─────────────────────────────────────────────
// Fuente de verdad única cuando USE_MOCK = true.
// Todos los módulos importan y mutan este objeto — los cambios son visibles
// de inmediato en toda la app sin recargar ni copiar datos entre módulos.
//
// IMPORTANTE: Este objeto NO debe contener credenciales reales.
// Para desarrollo local con USE_MOCK = true, usá las credenciales genéricas
// de abajo o creá un usuario de prueba en tu proyecto Supabase de staging.
export const MOCK_DATABASE = {

  // ── USUARIOS ────────────────────────────────────────────────────────────────
  // Roles soportados: 'comercio' | 'admin' | 'cadete' | 'usuario'
  // Credenciales de demo — NUNCA usar emails o passwords reales aquí.
  usuarios: [
    {
      email:  'comercio-demo@example.com',
      pass:   'demo-comercio-2024',
      rol:    'comercio',
      uid:    'mock-uid-comercio-001',
      cid:    'mock-cid-comercio-001',
      nombre: 'Comercio Demo',
    },
    {
      email:  'admin-demo@example.com',
      pass:   'demo-admin-2024',
      rol:    'admin',
      uid:    'mock-uid-admin-001',
      cid:    null,
      nombre: 'Admin Demo',
    },
  ],

  // ── PEDIDOS ─────────────────────────────────────────────────────────────────
  // Array mutable — aceptarPedido / marcarListo / rechazarPedido lo mutan directamente.
  // Estados mixtos: nuevo → preparando → listo → entregado | cancelado
  pedidos: [
    {
      id: 'ped-001', numero: 1042,
      usuario_id: 'usr-cli-001', comercio_id: 'comercio_habibi_123', cadete_id: null,
      estado: 'nuevo', tipo_delivery: 'app',
      items: [{ nombre: 'Pizza Muzza', cantidad: 2, precio_cliente_snapshot: 1150 }],
      subtotal: 2300, costo_envio: 800, total: 3100,
      metodo_pago: 'efectivo', direccion_entrega: 'Av. San Martín 456',
      created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    },
    {
      id: 'ped-002', numero: 1041,
      usuario_id: 'usr-cli-002', comercio_id: 'comercio_habibi_123', cadete_id: null,
      estado: 'preparando', tipo_delivery: 'app',
      items: [
        { nombre: 'Pizza Calabresa', cantidad: 1, precio_cliente_snapshot: 1380 },
        { nombre: 'Coca-Cola 1.5L',  cantidad: 1, precio_cliente_snapshot: 690  },
      ],
      subtotal: 2070, costo_envio: 800, total: 2870,
      metodo_pago: 'mercadopago', direccion_entrega: 'Calle Urquiza 789',
      created_at: new Date(Date.now() - 15 * 60_000).toISOString(),
    },
    {
      id: 'ped-003', numero: 1040,
      usuario_id: 'usr-cli-003', comercio_id: 'comercio_habibi_123', cadete_id: 'cad-001',
      estado: 'listo', tipo_delivery: 'app',
      items: [{ nombre: 'Pizza Muzza', cantidad: 1, precio_cliente_snapshot: 1150 }],
      subtotal: 1150, costo_envio: 800, total: 1950,
      metodo_pago: 'efectivo', direccion_entrega: 'Av. Belgrano 123',
      created_at: new Date(Date.now() - 45 * 60_000).toISOString(),
    },
    {
      id: 'ped-004', numero: 1039,
      usuario_id: 'usr-cli-004', comercio_id: 'comercio_habibi_123', cadete_id: 'cad-001',
      estado: 'entregado', tipo_delivery: 'app',
      items: [{ nombre: 'Pizza Muzza', cantidad: 1, precio_cliente_snapshot: 1150 }],
      subtotal: 1150, costo_envio: 800, total: 1950,
      metodo_pago: 'mercadopago', direccion_entrega: 'Salta 234',
      created_at: new Date(Date.now() - 4 * 3_600_000).toISOString(),
    },
    {
      id: 'ped-005', numero: 1038,
      usuario_id: 'usr-cli-005', comercio_id: 'comercio_habibi_123', cadete_id: 'cad-002',
      estado: 'entregado', tipo_delivery: 'propio',
      items: [{ nombre: 'Pizza Muzza', cantidad: 3, precio_cliente_snapshot: 1150 }],
      subtotal: 3450, costo_envio: 800, total: 4250,
      metodo_pago: 'efectivo', direccion_entrega: 'Mitre 567',
      created_at: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    },
  ],
};
