import { supabase } from './config.js';
// Reuse the configured supabase client (frontend should only use the public anon key)
window.sb = supabase;