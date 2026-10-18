// Shared UI helpers, dates, toast and the sidebar. No booking rules here.

export const ROOT = new URL('../../', import.meta.url).href;   // site root
const LOGO = ROOT + 'assets/img/logo.png';

export const ROUTES = {
  home: 'pages/index.html',
  book: 'pages/customer.html#book',
  rent: 'pages/customer.html#rent',
  mybook: 'pages/customer.html#my-bookings',
  myrent: 'pages/customer.html#my-rentals',
  login: 'pages/login.html',
  register: 'pages/register.html'
};

/* ---------- DOM and formatting ---------- */
export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const peso = n => '₱' + (Number(n) || 0).toLocaleString('en-US');
export const badge = status => `<span class="b ${String(status).toLowerCase().replace(/ /g, '')}">${esc(status)}</span>`;
export const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- Dates (studio runs on Manila time, UTC+8) ---------- */
export const pad = n => String(n).padStart(2, '0');
export const toISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return toISO(d); };
export const TODAY = dayOffset(0);
export const longDate = iso => new Date(iso + 'T00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = iso => new Date(iso + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const manilaTS = (dateISO, hour) => `${dateISO}T${pad(hour)}:00:00+08:00`;
export function manilaParts(ts) {
  const m = new Date(new Date(ts).getTime() + 8 * 3600e3);
  return { date: m.toISOString().slice(0, 10), hour: m.getUTCHours() };
}

/* Bookable start times: 10:00 AM to 9:00 PM (studio closes 10:00 PM). */
export const SLOTS = ['10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM', '2:00 PM', '3:00 PM',
                      '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'];
export function endTime(startLabel, hours) {
  const h = 10 + SLOTS.indexOf(startLabel) + hours;
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
}
export const STUDIO_COLORS = [['#C92C3E', '#3D0C14'], ['#C98512', '#33220A'], ['#8E161F', '#1E0A0F'], ['#4A4A55', '#16161A']];
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Toast ---------- */
let toastTimer;
export function toast(message) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4500);
}

/* ---------- Navigation ---------- */
export function navigate(key, params = {}) {
  const [path, hash = ''] = ROUTES[key].split('#');
  const q = new URLSearchParams(params).toString();
  const target = new URL(ROOT + path + (q ? '?' + q : '') + (hash ? '#' + hash : ''), location.href);
  if (target.pathname === location.pathname && target.search === location.search) {
    if (target.hash && target.hash !== location.hash) location.hash = target.hash;
    else scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  location.href = target.href;
}

/* ---------- Sidebar and mobile drawer ---------- */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  login: '<path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  logout: '<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>'
};
const icon = n => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;

const NAV_ITEMS = [
  ['home', 'Home', 'home'], ['book', 'Book a Studio', 'cal'], ['rent', 'Rent Equipment', 'music'],
  ['mybook', 'My Bookings', 'list'], ['myrent', 'My Rentals', 'box']
];

/* user = { label } when signed in, or null. onLogout runs when "Log out" is clicked. */
export function mountChrome({ active, user, onLogout }) {
  document.body.classList.add('hasside');
  document.body.insertAdjacentHTML('afterbegin', `
    <div class="mbar">
      <button id="mb-open" aria-label="Open menu">${icon('menu')}</button>
      <span class="mb-brand"><img src="${LOGO}" alt=""> Tower of Dove</span>
      <button id="mb-user" aria-label="${user ? 'Account' : 'Log in'}" ${user ? '' : 'data-route="login"'}>${icon('user')}</button>
    </div>
    <div class="scrim" id="scrim"></div>
    <aside class="pubside" id="pubside" aria-label="Main navigation">
      <button class="ps-x" id="ps-x" aria-label="Close menu">${icon('x')}</button>
      <div class="ps-menu" id="ps-toggle" role="button" tabindex="0" aria-label="Expand or collapse menu" aria-expanded="true">${icon('menu')}</div>
      <ul class="ps-links" id="ps-main">
        ${NAV_ITEMS.map(([key, label, ic]) => `
        <li data-side="${key}"><div class="curve-top"></div>
          <a href="#" data-route="${key}"><span class="ico">${icon(ic)}</span><span class="lbl">${label}</span></a>
          <div class="curve-bottom"></div></li>`).join('')}
      </ul>
      <ul class="ps-links ps-auth">
        ${user ? `
        <li><a href="#" data-route="mybook"><span class="ico">${icon('user')}</span><span class="lbl">${esc(user.label)}</span></a></li>
        <li><a href="#" id="logout"><span class="ico">${icon('logout')}</span><span class="lbl">Log out</span></a></li>` : `
        <li data-side="login"><a href="#" data-route="login"><span class="ico">${icon('login')}</span><span class="lbl">Log in</span></a></li>
        <li data-side="register"><a href="#" data-route="register"><span class="ico">${icon('edit')}</span><span class="lbl">Register</span></a></li>`}
      </ul>
      <div class="ps-logo"><img src="${LOGO}" alt="Tower of Dove logo"><div class="ps-title">Tower of Dove</div></div>
    </aside>`);

  const setDrawer = open => { $('#pubside').classList.toggle('open', open); $('#scrim').classList.toggle('on', open); };
  const toggleSidebar = () => {
    const collapsed = $('#pubside').classList.toggle('collapsed');
    document.body.classList.toggle('sc', collapsed);
    $('#ps-toggle').setAttribute('aria-expanded', String(!collapsed));
  };
  $('#ps-toggle').addEventListener('click', toggleSidebar);
  $('#ps-toggle').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleSidebar(); } });
  $('#mb-open').addEventListener('click', () => setDrawer(true));
  $('#ps-x').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#pubside').addEventListener('click', e => { if (e.target.closest('a')) setDrawer(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-route]');
    if (!el) return;
    e.preventDefault();
    navigate(el.dataset.route);
  });
  const lo = $('#logout');
  if (lo) lo.addEventListener('click', e => { e.preventDefault(); if (onLogout) onLogout(); });
  setActiveNav(active);
}

export function setActiveNav(key) {
  $$('.ps-links li[data-side]').forEach(li => li.classList.toggle('active', li.dataset.side === key));
}
