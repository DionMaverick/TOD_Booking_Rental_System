// Authentication and session operations. No DOM code in services.
import { supabase, INITIAL_HASH } from '../modules/supabase-config.js';

/* ---- What the address bar contained when the page opened ---- */
const hashParams = new URLSearchParams(INITIAL_HASH.replace(/^#/, ''));
export const isRecoveryLink = () => hashParams.get('type') === 'recovery';

/* Supabase puts #error=access_denied&error_code=otp_expired&... on bad or expired links. */
export function recoveryError() {
  if (!hashParams.get('error') && !hashParams.get('error_code')) return null;
  const code = hashParams.get('error_code');
  return {
    code,
    message: code === 'otp_expired'
      ? 'This reset link has expired or was already used. Request a new one.'
      : (hashParams.get('error_description') || 'This reset link is not valid. Request a new one.')
  };
}

/* ---- Session ---- */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

/* The customer row linked to the logged-in user (null for staff or unknown users). */
export async function getCustomer() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('customer')
    .select('customer_id, first_name, last_name, number, backup_number, status')
    .eq('auth_user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

/* The staff_profile row linked to the logged-in user (null for customers or unknown users). */
export async function getStaff() {
  const session = await getSession();
  if (!session) return null;
  const { data, error } = await supabase.from('staff_profile')
    .select('user_id, first_name, last_name, role, status')
    .eq('auth_user_id', session.user.id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function signOut() {
  await supabase.auth.signOut();
}

/* ---- Register / log in ---- */
export async function signUp({ first, last, phone, email, password }) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: {
      emailRedirectTo: new URL('login.html', window.location.href).href,
      // a database trigger turns this metadata into a row in `customer`
      data: { kind: 'customer', first_name: first, last_name: last, number: phone }
    }
  });
  if (error) throw new Error(/already/i.test(error.message) ? 'That email is already registered. Try logging in.' : error.message);
  // With "Confirm email" ON, Supabase returns a user with no identities for an existing email.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    throw new Error('That email is already registered. Try logging in.');
  }
  return { needsConfirm: !data.session };
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login/i.test(error.message)) throw new Error('Wrong email or password.');
    if (/not confirmed/i.test(error.message)) throw new Error('Confirm your email first. Check your inbox (and spam).');
    throw new Error(error.message);
  }

  // Check staff first (owner / staff), then customer.
  const staff = await getStaff();
  if (staff) {
    if (staff.status !== 'Active') {
      await signOut();
      throw new Error('This staff account is inactive. Please contact the studio owner.');
    }
    return { role: staff.role, label: staff.first_name, isStaff: true };
  }

  const customer = await getCustomer();
  if (!customer) {
    await signOut();
    throw new Error('No profile found for this account. Contact the studio if this is unexpected.');
  }
  if (customer.status !== 'Active') {
    await signOut();
    throw new Error('This account is inactive. Please contact the studio.');
  }
  return { ...customer, isStaff: false };
}

/* ---- Password recovery ---- */
export async function sendRecovery(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL('login.html', window.location.href).href   // must be in Supabase Redirect URLs
  });
  if (error) throw new Error(error.message);
}

export function onPasswordRecovery(callback) {
  supabase.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') callback(); });
}

export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}