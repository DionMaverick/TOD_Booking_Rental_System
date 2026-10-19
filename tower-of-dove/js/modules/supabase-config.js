// Captured BEFORE the client starts, because supabase-js removes the #hash
// (access_token / error info) from the address bar while it reads it.
export const INITIAL_HASH = window.location.hash;

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://bfzrqrcyrztsvyghfrlo.supabase.co';
// Publishable key: safe for the browser. Row Level Security protects the data.
// NEVER put a service_role key or an SMTP password in frontend code.
const SUPABASE_KEY = 'sb_publishable_0ppfE6nPy-NOgV8_9zTu2Q_TcEFnsYf';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
