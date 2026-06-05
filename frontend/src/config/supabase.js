import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('Warning: SUPABASE_URL or SUPABASE_ANON_KEY missing in environment. Supabase client will be a safe stub.');
}

let _supabase = null;
let _supabaseAdmin = null;

if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
} else {
  // Safe stub to avoid throwing during server start. Methods return a predictable error object.
  _supabase = {
    auth: {
      signInWithPassword: async () => ({ data: null, error: { message: 'Supabase not configured on server' } }),
      // keep a placeholder for other auth methods if used elsewhere
    }
  };
}

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  _supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
} else {
  _supabaseAdmin = null;
}

export const supabase = _supabase;
export const supabaseAdmin = _supabaseAdmin;

export default supabase;
