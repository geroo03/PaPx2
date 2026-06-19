/**
 * supabaseClient.js
 *
 * Exporta DOS clientes Supabase con scopes de acceso distintos:
 *
 *   supabase      → clave ANON_KEY.  Usado en el authMiddleware para validar
 *                   JWTs de usuarios. Respeta RLS.
 *
 *   supabaseAdmin → clave SERVICE_ROLE.  Usado en controllers para operaciones
 *                   del servidor que requieren bypassear RLS (aceptar pedidos,
 *                   generar códigos, congelar tarifas, etc.).
 *                   NUNCA exponer esta clave al frontend.
 *
 * Ambos clientes tienen `persistSession: false` porque en un servidor stateless
 * no hay sesión de usuario que mantener — cada request trae su propio JWT.
 */

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    '[supabaseClient] SUPABASE_URL y SUPABASE_ANON_KEY son obligatorias. ' +
    'Verificá tu archivo .env'
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[supabaseClient] SUPABASE_SERVICE_ROLE_KEY no definida. ' +
    'supabaseAdmin no estará disponible — los controllers fallarán.'
  );
}

// Node 20 no tiene WebSocket nativo — se usa el paquete 'ws' como polyfill
const BASE_OPTIONS = {
  auth: {
    persistSession:   false,
    autoRefreshToken: false,
  },
  realtime: {
    transport: WebSocket,
  },
};

/** Cliente estándar — valida tokens, respeta RLS */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, BASE_OPTIONS);

/** Cliente admin — service_role, bypasea RLS. Solo para uso en el servidor. */
export const supabaseAdmin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BASE_OPTIONS)
  : null;
