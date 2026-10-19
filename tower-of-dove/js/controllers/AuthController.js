// Login, register, forgot password and reset password screens.
import * as Auth from '../services/AuthService.js';
import { $, $$, toast, mountChrome, navigate } from '../modules/shared.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[\d\s+()-]{7,20}$/;

const showMessage = (id, text) => { const box = $(id); box.textContent = text; box.hidden = !text; };
function setBusy(button, busy, label) { button.disabled = busy; if (label) button.textContent = busy ? label.busy : label.idle; }

/* Eye button inside every password box */
const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94M9.9 4.24A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M2 2l20 20"/></svg>';
function addPasswordToggles() {
  $$('input[type="password"]').forEach(input => {
    const wrap = document.createElement('div');
    wrap.className = 'pw';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'pw-toggle'; t.setAttribute('aria-label', 'Show password'); t.innerHTML = EYE;
    t.onclick = () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      t.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      t.innerHTML = show ? EYE_OFF : EYE;
    };
    wrap.appendChild(t);
  });
}

/* ============================ LOGIN PAGE ============================ */
export async function initLogin() {
  const recovering = Auth.isRecoveryLink() || Auth.recoveryError();
  const session = recovering ? null : await Auth.getSession().catch(() => null);
  if (session) { navigate('book'); return; }                    // already signed in

  mountChrome({ active: 'login', user: null });
  addPasswordToggles();

  const views = { login: '#v-login', forgot: '#v-forgot', reset: '#v-reset', expired: '#v-expired' };
  const show = name => Object.entries(views).forEach(([k, sel]) => { $(sel).hidden = k !== name; });

  /* ---- Opened from a recovery email? ---- */
  const linkError = Auth.recoveryError();
  if (linkError) {
    $('#expired-msg').textContent = linkError.message;
    show('expired');
  } else if (Auth.isRecoveryLink()) {
    const s = await Auth.getSession().catch(() => null);        // waits for supabase to read the link
    if (s) show('reset');
    else { $('#expired-msg').textContent = 'This reset link is not valid anymore. Request a new one.'; show('expired'); }
  } else {
    show('login');
  }
  Auth.onPasswordRecovery(() => show('reset'));

  /* ---- Log in ---- */
  $('#f-login').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#lu').value.trim().toLowerCase(), password = $('#lp').value;
    if (!EMAIL_RE.test(email)) return showMessage('#login-err', 'Enter a valid email address.');
    if (!password) return showMessage('#login-err', 'Enter your password.');
    showMessage('#login-err', ''); showMessage('#login-ok', '');
    const btn = e.target.querySelector('button[type="submit"]');
    setBusy(btn, true, { busy: 'Logging in...', idle: 'Log in' });
    try {
      const result = await Auth.signIn(email, password);
      navigate(result.isStaff ? 'admin' : 'book');
    } catch (err) { showMessage('#login-err', err.message); setBusy(btn, false, { busy: '', idle: 'Log in' }); }
  });

  /* ---- Forgot password: ask for the email ---- */
  $('#forgot').addEventListener('click', () => {
    $('#fe').value = $('#lu').value.trim();
    showMessage('#forgot-err', ''); showMessage('#forgot-ok', '');
    show('forgot');
  });
  $$('[data-back-login]').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', location.pathname); show('login'); }));
  $$('[data-to-forgot]').forEach(b => b.addEventListener('click', () => { history.replaceState(null, '', location.pathname); showMessage('#forgot-err', ''); showMessage('#forgot-ok', ''); show('forgot'); }));

  $('#f-forgot').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#fe').value.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return showMessage('#forgot-err', 'Enter the email you registered with.');
    showMessage('#forgot-err', ''); showMessage('#forgot-ok', '');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Auth.sendRecovery(email);
      // Supabase does not reveal whether the email exists, so the wording stays neutral.
      showMessage('#forgot-ok', `If an account exists for ${email}, a reset link is on its way. Check your inbox and spam folder. The link expires, so use it soon.`);
      let wait = 60;                                            // avoid hitting email rate limits
      const timer = setInterval(() => {
        btn.textContent = `Send again in ${--wait}s`;
        if (wait <= 0) { clearInterval(timer); btn.textContent = 'Send reset link'; btn.disabled = false; }
      }, 1000);
      btn.textContent = `Send again in ${wait}s`;
    } catch (err) {
      showMessage('#forgot-err', /rate limit/i.test(err.message) ? 'Too many requests. Please wait a few minutes and try again.' : err.message);
      btn.disabled = false;
    }
  });

  /* ---- Reset password: enter the new one ---- */
  $('#f-reset').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = $('#rp1').value, pw2 = $('#rp2').value;
    if (pw.length < 8) return showMessage('#reset-err', 'Use a password with at least 8 characters.');
    if (pw !== pw2) return showMessage('#reset-err', 'The two passwords do not match.');
    showMessage('#reset-err', '');
    const btn = e.target.querySelector('button[type="submit"]');
    setBusy(btn, true, { busy: 'Saving...', idle: 'Save new password' });
    try {
      await Auth.updatePassword(pw);
      await Auth.signOut();                                     // end the temporary recovery session
      history.replaceState(null, '', location.pathname);
      e.target.reset();
      showMessage('#login-ok', 'Password updated. Log in with your new password.');
      show('login');
    } catch (err) {
      showMessage('#reset-err', /session|expired|missing/i.test(err.message)
        ? 'Your reset session expired. Request a new link.' : err.message);
    }
    setBusy(btn, false, { busy: '', idle: 'Save new password' });
  });
}

/* ============================ REGISTER PAGE ============================ */
export async function initRegister() {
  const session = await Auth.getSession().catch(() => null);
  if (session) { navigate('book'); return; }
  mountChrome({ active: 'register', user: null });
  addPasswordToggles();

  $('#f-reg').addEventListener('submit', async e => {
    e.preventDefault();
    const first = $('#rg-fn').value.trim(), last = $('#rg-ln').value.trim(), phone = $('#rg-phone').value.trim();
    const email = $('#rg-email').value.trim().toLowerCase(), pass = $('#rg-pass').value, pass2 = $('#rg-pass2').value;
    if (!first) return showMessage('#reg-err', 'Enter your first name.');
    if (!last) return showMessage('#reg-err', 'Enter your last name.');
    if (!PHONE_RE.test(phone)) return showMessage('#reg-err', 'Enter a valid phone number (7 to 20 characters).');
    if (!EMAIL_RE.test(email)) return showMessage('#reg-err', 'Enter a valid email address. It is used to reset your password.');
    if (pass.length < 8) return showMessage('#reg-err', 'Use a password with at least 8 characters.');
    if (pass !== pass2) return showMessage('#reg-err', 'The two passwords do not match.');
    showMessage('#reg-err', '');
    const btn = e.target.querySelector('button[type="submit"]');
    setBusy(btn, true, { busy: 'Creating account...', idle: 'Create account' });
    try {
      const { needsConfirm } = await Auth.signUp({ first, last, phone, email, password: pass });
      if (needsConfirm) {
        e.target.hidden = true;
        showMessage('#reg-ok', `Account created. We sent a confirmation link to ${email}. Open it, then log in.`);
      } else {
        navigate('book');
      }
    } catch (err) {
      showMessage('#reg-err', err.message);
      setBusy(btn, false, { busy: '', idle: 'Create account' });
    }
  });
}