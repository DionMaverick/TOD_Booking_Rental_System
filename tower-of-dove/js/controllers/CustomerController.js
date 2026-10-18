// Customer portal: Book, Rent Equipment, My Booking, My Rentals.
import * as Auth from '../services/AuthService.js';
import * as Booking from '../services/BookingService.js';
import * as Equipment from '../services/EquipmentService.js';
import { supabase } from '../modules/supabase-config.js';
import { $, $$, esc, peso, badge, pl, pad, TODAY, SLOTS, dayOffset, longDate, shortDate, endTime, manilaTS, manilaParts,
         mountChrome, setActiveNav, navigate, toast, STUDIO_COLORS } from '../modules/shared.js';

/* ============================ 1. STATE ============================ */
let customer = null, userId = null, member = false, eqFilter = 'All';
let STUDIOS = [], EQUIPMENT = [], BUSY = {}, MY_BOOKINGS = [], MY_RENTALS = [];
let selStudio = 0, selDate = TODAY, calMonth = new Date(), draft = null, rentMode = 'addon', cart = {};
calMonth.setDate(1);

const TABS = { 'book': 'c-book', 'rent': 'c-rent', 'my-bookings': 'c-bk', 'my-rentals': 'c-rental' };
const NAV_KEY = { 'book': 'book', 'rent': 'rent', 'my-bookings': 'mybook', 'my-rentals': 'myrent' };
const BK_LABEL = { 'Approved': 'Confirmed', 'In Progress': 'Active' };
const RN_LABEL = { 'Active': 'In Use' };
const isClosed = s => s.status !== 'Available';
const taken = d => BUSY[d] || new Set();
const table = (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const IMAGE_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>';

function showTab() {
  const name = TABS[location.hash.slice(1)] ? location.hash.slice(1) : 'book';
  $$('.pg').forEach(p => p.classList.toggle('on', p.id === TABS[name]));
  setActiveNav(NAV_KEY[name]);
  scrollTo(0, 0);
}

const dlg = $('#dlg');
function showDialog(html) { dlg.innerHTML = `<div class="in">${html}</div>`; dlg.showModal(); }
dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); });

/* ============================ START ============================ */
export async function initCustomer() {
  // Guests can browse everything public. Booking and renting need an active customer account.
  try {
    const session = await Auth.getSession();
    if (session) { userId = session.user.id; customer = await Auth.getCustomer(); }
  } catch (err) { console.error(err); }
  if (userId && (!customer || customer.status !== 'Active')) {
    // signed in, but not as an active customer (for example a staff account): browse as a guest
    await Auth.signOut().catch(() => {});
    customer = null; userId = null;
  }
  member = !!customer;

  mountChrome({
    active: NAV_KEY[location.hash.slice(1)] || 'book',
    user: member ? { label: customer.first_name } : null,
    onLogout: async () => { await Auth.signOut(); navigate('home'); }
  });
  applyAccessMode();

  try {
    const [studios, equipment] = await Promise.all([Booking.listStudios(), Equipment.listEquipment()]);
    STUDIOS = studios.map((s, i) => ({ id: s.studio_id, name: s.name, letter: s.name.replace(/^studio\s*/i, ''), desc: s.description || '',
      rate: Number(s.hourly_rate), status: s.status, img: s.image, c1: STUDIO_COLORS[i % 4][0], c2: STUDIO_COLORS[i % 4][1] }));
    EQUIPMENT = equipment.map(e => ({ id: e.equipment_id, name: e.name, category: e.equipment_category ? e.equipment_category.category_name : '',
      desc: e.description, img: e.image, flat: e.pricing_type === 'Flat',
      addon: e.allow_addon, outside: e.allow_outside, addonPrice: Number(e.add_on_rate) || 0, outsidePrice: Number(e.outside_rate) || 0,
      stock: e.status === 'Available' ? Math.max(e.total_quantity - e.in_use, 0) : 0 }));
  } catch (err) { console.error(err); toast('Could not load studios and equipment: ' + (err.message || 'check your connection.')); }

  selStudio = Math.max(0, STUDIOS.findIndex(s => !isClosed(s)));
  initBookTab(); initRentTab(); initBookingsTab(); initGuestLookups();
  window.addEventListener('hashchange', showTab);
  showTab();
  renderFilters(); renderEquipment(); renderCart(); renderRentMode();
  if (member) { await loadMyBookings(); await loadMyRentals(); }
  await applyUrlParams();
}

async function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  const sid = Number(q.get('studio')), idx = STUDIOS.findIndex(s => s.id === sid);
  if (idx >= 0) selStudio = idx;
  const date = q.get('date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date || '') && date >= TODAY) { selDate = date; calMonth = new Date(date + 'T00:00'); calMonth.setDate(1); }
  await refreshBook();
  const time = q.get('time');
  if (member && time && SLOTS.includes(time) && STUDIOS[selStudio] && !isClosed(STUDIOS[selStudio])) openBook(SLOTS.indexOf(time));
  const item = q.get('item');
  if (item) { const card = $(`#eq [data-eq="${Number(item)}"]`); if (card) { card.classList.add('hl'); if (location.hash === '#rent') card.scrollIntoView({ block: 'center' }); } }
}

/* ---- guest mode ---- */
function applyAccessMode() {
  $('#guest-bar').hidden = member;
  $('#guest-rent').hidden = member;
  $('#bk-member').hidden = !member;  $('#bk-guest').hidden = member;
  $('#rt-member').hidden = !member;  $('#rt-guest').hidden = member;
  if (!member) {
    $('#bk-sub').textContent = 'Log in to see your bookings, or look one up with its reference code.';
    $('#rt-sub').textContent = 'Log in to see your rentals, or look one up with its reference code.';
    $('#fo-id').hidden = true; $('#fp').hidden = true;
    $('#lb').innerHTML = '<option value="">Log in to attach to a booking</option>';
  }
}

function askToLogIn(what) {
  showDialog(`<h2>Log in to ${esc(what)}</h2>
    <p class="mut">You can browse studios, prices and availability without an account. To ${esc(what)}, log in or create a free account.</p>
    <div class="acts"><button class="btn line" data-close>Not now</button>
      <button class="btn line" data-route="register">Register</button><button class="btn gold" data-route="login">Log in</button></div>`);
}

const normRef = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
const notFound = (ref, what) => `<p class="mut">${ref ? `No ${what} was found for <b>${esc(ref)}</b>.` : `Enter your ${what} reference code.`} Check the code and try again, or ask the studio for help.</p>`;

function initGuestLookups() {
  $('#gb-form').addEventListener('submit', async e => {
    e.preventDefault();
    const ref = normRef($('#gb-ref').value), box = $('#gb-res'), btn = e.target.querySelector('button');
    box.hidden = false;
    if (!ref) { box.innerHTML = notFound('', 'booking'); return; }
    btn.disabled = true; box.innerHTML = '<p class="mut">Looking up...</p>';
    try {
      const data = await Booking.lookupBooking(ref);
      if (!data) { box.innerHTML = notFound(ref, 'booking'); return; }
      const a = manilaParts(data.start_at), z = manilaParts(data.end_at), hrs = z.hour - a.hour, start = SLOTS[a.hour - 10] || '';
      box.innerHTML = `<div class="row"><h3>${esc(data.booking_ref)}</h3>${badge(BK_LABEL[data.status] || data.status)}</div>
        <dl class="dl"><dt>Studio</dt><dd>${esc(data.studio)}${data.studio_description ? ', ' + esc(data.studio_description) : ''}</dd>
        <dt>Date</dt><dd>${longDate(a.date)}</dd>
        <dt>Time</dt><dd>${start} to ${endTime(start, hrs)} (${pl(hrs, 'hr')})</dd>
        <dt>Studio price</dt><dd>${peso(data.studio_total)}</dd>
        ${(data.addons || []).map(x => `<dt>Add-on</dt><dd>${esc(x.equipment)} x${x.quantity} (${peso(x.price)})</dd>`).join('')}
        <dt>Total</dt><dd><b>${peso(data.grand_total)}</b></dd>
        <dt>Payment</dt><dd>${badge(data.payment_status || 'Pending')}</dd></dl>
        <p class="mut">Bookings are confirmed after staff verify your payment. To change or cancel, log in to your account.</p>`;
    } catch (err) { console.error(err); box.innerHTML = `<div class="alert">Could not look up the booking: ${esc(err.message)}</div>`; }
    finally { btn.disabled = false; }
  });

  $('#gr-form').addEventListener('submit', async e => {
    e.preventDefault();
    const ref = normRef($('#gr-ref').value), box = $('#gr-res'), btn = e.target.querySelector('button');
    box.hidden = false;
    if (!ref) { box.innerHTML = notFound('', 'rental'); return; }
    btn.disabled = true; box.innerHTML = '<p class="mut">Looking up...</p>';
    try {
      const list = await Equipment.lookupRental(ref);
      if (!list || !list.length) { box.innerHTML = notFound(ref, 'rental'); return; }
      const orders = [];                                   // one row per rental order, items listed inside it
      list.forEach(r => {
        let o = orders.find(x => x.rental_ref === r.rental_ref);
        if (!o) { o = { ...r, items: [] }; orders.push(o); }
        o.items.push(`${esc(r.equipment)} x${r.quantity}`);
      });
      const day = ts => ts ? shortDate(manilaParts(ts).date) : '';
      const head = ['Reference', 'Items', 'Rent type', 'Session or dates', 'Return by', 'Status'];
      box.innerHTML = `<div class="tw"><table><thead><tr>${head.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>` + orders.map(o => {
        const addon = o.rental_type === 'Add-on', note = whyRejected(RN_LABEL[o.status] || o.status, o.rejection_reason);
        const when = addon ? (o.start_at ? `${day(o.start_at)}, ${SLOTS[manilaParts(o.start_at).hour - 10] || ''}` : '') : `${day(o.start_at)} to ${day(o.return_by)}`;
        const cells = [esc(o.rental_ref), o.items.join('<br>'), addon ? '<span class="b addon">Add-on</span>' : '<span class="b out">Outside</span>', esc(when), day(o.return_by), badge(RN_LABEL[o.status] || o.status)];
        return `<tr class="${note ? 'has-why' : ''}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>` + (note ? `<tr class="why-row"><td colspan="${head.length}">${note}</td></tr>` : '');
      }).join('') + '</tbody></table></div>';
    } catch (err) { console.error(err); box.innerHTML = `<div class="alert">Could not look up the rental: ${esc(err.message)}</div>`; }
    finally { btn.disabled = false; }
  });
}

/* ============================ 2. BOOK A STUDIO ============================ */
function renderBook() {
  if (!STUDIOS.length) { $('#cs').innerHTML = '<p class="mut">No studios are listed yet.</p>'; $('#bk-now').disabled = true; return; }
  $('#cs').innerHTML = STUDIOS.map((s, i) => {
    const thumb = s.img ? `<div class="ph has"><img src="${esc(s.img)}" alt="${esc(s.name)}" loading="lazy"></div>`
                        : `<div class="ph" style="background:linear-gradient(135deg,${s.c1},${s.c2})">${esc(s.letter)}</div>`;
    return `<div class="card pick ${i === selStudio ? 'sel' : ''}" data-i="${i}">${thumb}
      <div class="row"><h3>${esc(s.name)}</h3>${badge(s.status)}</div><p class="mut">${esc(s.desc)}</p>
      <p style="margin-top:6px"><b>${peso(s.rate)}</b> <span class="mut">per hour</span></p></div>`;
  }).join('');

  const y = calMonth.getFullYear(), m = calMonth.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
  $('#cal-t').textContent = calMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ', ' + STUDIOS[selStudio].name;
  let html = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<small class="mut">${d}</small>`).join('') + '<span></span>'.repeat(first);
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, n = taken(ds).size;
    const cls = ds === selDate ? 'sel' : n >= SLOTS.length ? 'full' : n ? 'part' : '';
    html += `<button class="cd ${cls}" data-d="${ds}" ${ds < TODAY ? 'disabled' : ''}>${d}<i>${n ? n + 'h' : ''}</i></button>`;
  }
  $('#cal').innerHTML = html;
  const occ = [...taken(selDate)].sort((a, b) => a - b);
  $('#dayocc').innerHTML = `<h3 style="font-size:14px">${longDate(selDate)}</h3>` +
    (occ.length ? `<p class="mut">Occupied: ${occ.map(i => SLOTS[i]).join(', ')}</p>` : '<p class="mut">No occupied times. The whole day is open.</p>');
  $('#bk-now').disabled = isClosed(STUDIOS[selStudio]);
}

async function refreshBook() {
  if (STUDIOS[selStudio]) {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    try { BUSY = await Booking.getBusy(STUDIOS[selStudio].id, `${y}-${pad(m + 1)}-01`, `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`); }
    catch (err) { console.error(err); toast('Could not load availability.'); }
  }
  renderBook();
}

function initBookTab() {
  $('#c-book').addEventListener('click', e => {
    const pick = e.target.closest('.pick'), day = e.target.closest('.cd');
    if (pick) selStudio = +pick.dataset.i;
    else if (day) selDate = day.dataset.d;
    else if (e.target.closest('#cal-p')) calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    else if (e.target.closest('#cal-n')) calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    else if (e.target.closest('#bk-now')) return openBook();
    else return;
    (day ? renderBook : refreshBook)();
  });
}

/* ---- success pop-up ---- */
const okDlg = $('#okdlg');
function showSuccess({ title, label, ref, lines, note }) {
  okDlg.innerHTML = `<div class="in ok">
    <div class="okic" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>
    <h2>${esc(title)}</h2><p class="mut">${esc(label)}</p><div class="okref">${esc(ref)}</div>
    <button type="button" class="btn line sm" id="ok-copy">Copy code</button>
    ${(lines && lines.length) ? `<dl class="dl" style="text-align:left;margin-top:14px">${lines.map(l => `<dt>${esc(l[0])}</dt><dd>${esc(l[1])}</dd>`).join('')}</dl>` : ''}
    <p class="mut" style="margin-top:12px">${esc(note)}</p>
    <div class="acts" style="justify-content:center"><button type="button" class="btn gold" id="ok-done">Done</button></div></div>`;
  $('#ok-done').onclick = () => okDlg.close();
  $('#ok-copy').onclick = async e => { try { await navigator.clipboard.writeText(ref); e.target.textContent = 'Copied'; } catch (x) { e.target.textContent = 'Select the code to copy'; } };
  okDlg.showModal();
}

/* ---- booking form (modal) ---- */
const bkDlg = $('#bkdlg');
const bkError = msg => { const x = $('#bk-e'); x.textContent = msg; x.hidden = !msg; };
const fits = (t, h) => t >= 0 && t + h <= SLOTS.length && Array.from({ length: h }, (_, j) => !taken(draft.d).has(t + j)).every(Boolean);
const addOnSelection = () => $$('#bk-ad select').map(s => ({ equipment_id: +s.dataset.eq, quantity: +s.value })).filter(x => x.quantity > 0);

function updateTotals() {
  const studio = STUDIOS[draft.si].rate * draft.h;
  const sel = addOnSelection(), addons = sel.reduce((n, x) => n + (EQUIPMENT.find(e => e.id === x.equipment_id).addonPrice * x.quantity), 0);
  $('#bk-hh').textContent = pl(draft.h, 'hr');
  $('#bk-st').textContent = peso(studio);
  $('#bk-adr').hidden = !sel.length;
  $('#bk-ao').textContent = peso(addons);
  $('#bk-t').textContent = peso(studio + addons);
  const qa = $('#bk-qa'); if (qa) qa.textContent = peso(studio + addons);
}
function drawSlots() {
  $('#bk-slots').innerHTML = SLOTS.map((t, i) => `<button type="button" data-i="${i}" class="${i === draft.t ? 'sel' : ''}" ${taken(draft.d).has(i) ? 'disabled' : ''}>${t}</button>`).join('');
  updateTotals();
}
function addOnRows() {
  const list = EQUIPMENT.filter(e => e.addon && e.stock > 0);
  if (!list.length) return '<p class="mut">No add-on equipment is available right now.</p>';
  return list.map(e => `<div class="ad"><div><b>${esc(e.name)}</b><div class="mut">${peso(e.addonPrice)} ${e.flat ? 'per rental' : 'per session'}</div></div>
    <select data-eq="${e.id}" aria-label="Quantity of ${esc(e.name)}">${Array.from({ length: Math.min(e.stock, 10) + 1 }, (_, n) => `<option value="${n}">${n}</option>`).join('')}</select></div>`).join('');
}

async function openBook(startIndex) {
  if (!member) return askToLogIn('book a studio');
  const si = selStudio, d = selDate, s = STUDIOS[si];
  try { BUSY = { ...BUSY, ...(await Booking.getBusy(s.id, d, d)) }; } catch (err) { return toast('Could not load availability.'); }
  const free = new Set(taken(d));
  let t = startIndex;
  if (t == null || t < 0) t = SLOTS.findIndex((_, i) => !free.has(i));
  if (t < 0 || free.has(t)) return toast('No free times for that day.');
  const h = (t + 1 < SLOTS.length && !free.has(t + 1)) ? 2 : 1;
  draft = { si, d, t, h };

  bkDlg.innerHTML = `<div class="in"><form id="bkf" novalidate>
    <h2 style="margin:0">Book ${esc(s.name)}</h2>
    <p class="mut">${longDate(d)}. ${peso(s.rate)} per hour. The time is checked again when you submit, so someone else may take it first.</p>
    <label>Start time</label><div class="slots" id="bk-slots"></div>
    <label for="bk-h">Duration</label>
    <select id="bk-h">${[1, 2, 3, 4].map(x => `<option value="${x}" ${x === h ? 'selected' : ''}>${x} hour${x > 1 ? 's' : ''}</option>`).join('')}</select>
    <label>Booking for</label>
    <p class="mut">${esc(customer.first_name + ' ' + customer.last_name)}, ${esc(customer.number)}</p>
    <label>Add-on equipment <span class="mut" style="font-weight:400">(optional)</span></label>
    <div class="adl" id="bk-ad">${addOnRows()}</div>
    <label for="bk-m">Payment method</label>
    <select id="bk-m"><option>GCash</option><option>Cash</option></select>
    <div id="bk-gw">
      <div class="gq"><img id="bk-qr" alt="GCash QR code to scan" hidden>
        <p class="mut" id="bk-qn">Pay <b id="bk-qa"></b> using the studio's GCash account, then enter the reference number from your receipt below. Ask staff if you need the account details.</p></div>
      <label for="bk-g">GCash reference number</label>
      <input id="bk-g" placeholder="13-digit reference" inputmode="numeric">
    </div>
    <div class="bkt"><div><span>Studio (<span id="bk-hh"></span>)</span><span id="bk-st"></span></div>
      <div id="bk-adr" hidden><span>Add-on equipment</span><span id="bk-ao"></span></div></div>
    <div class="tot"><span>Total</span><span id="bk-t"></span></div>
    <label class="terms" id="bk-terms"><input type="checkbox" id="bk-agree">
      <span>I understand and agree that there is <b>no refund</b> of the payment I make for this booking if it is cancelled.</span></label>
    <div class="alert" id="bk-e" hidden></div>
    <p class="hold">Payment starts as Pending until staff verify it.</p>
    <div class="acts"><button type="button" class="btn line" id="bk-x">Cancel</button><button class="btn gold">Submit booking</button></div>
  </form></div>`;

  drawSlots();
  $('#bk-slots').onclick = e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const nt = +b.dataset.i;
    if (!fits(nt, draft.h)) return bkError(`That start time does not fit ${pl(draft.h, 'hour')}. Pick a shorter duration or another time.`);
    draft.t = nt; bkError(''); drawSlots();
  };
  $('#bk-h').onchange = e => {
    const nh = +e.target.value;
    if (!fits(draft.t, nh)) { e.target.value = draft.h; return bkError('Those hours are taken or run past closing time.'); }
    draft.h = nh; bkError(''); drawSlots();
  };
  $('#bk-m').onchange = e => { $('#bk-gw').hidden = e.target.value !== 'GCash'; };
  $('#bk-x').onclick = () => bkDlg.close();
  $('#bk-ad').onchange = updateTotals;
  $('#bk-agree').onchange = e => { if (e.target.checked) { $('#bk-terms').classList.remove('err'); bkError(''); } };

  // optional QR image (uploaded by the owner to the public studio-images bucket)
  const qr = $('#bk-qr');
  qr.onload = () => { qr.hidden = false; $('#bk-qn').innerHTML = 'Scan this QR code with GCash and pay <b id="bk-qa"></b>. Then enter the reference number from your receipt below.'; updateTotals(); };
  qr.src = supabase.storage.from('studio-images').getPublicUrl('payment/gcash-qr').data.publicUrl + '?v=' + Math.floor(Date.now() / 300000);
  updateTotals();

  $('#bkf').onsubmit = async ev => {
    ev.preventDefault();
    const method = $('#bk-m').value, gcash = $('#bk-g').value.replace(/\s/g, '');
    if (method === 'GCash' && !/^\d{13}$/.test(gcash)) return bkError('Enter the 13-digit GCash reference.');
    if (!$('#bk-agree').checked) { $('#bk-terms').classList.add('err'); return bkError('Please tick the box to confirm you understand the no-refund policy.'); }
    const items = addOnSelection(), snap = { s: STUDIOS[draft.si], d: draft.d, t: draft.t, h: draft.h };
    const btn = ev.target.querySelector('.btn.gold');
    btn.disabled = true; btn.textContent = 'Submitting...';
    try {
      const row = await Booking.createBooking({ studioId: snap.s.id, date: snap.d, startIdx: snap.t, hours: snap.h, method, gcash, items });
      const lines = [['Studio', snap.s.name], ['Date', longDate(snap.d)], ['Time', `${SLOTS[snap.t]} to ${endTime(SLOTS[snap.t], snap.h)}`]];
      items.forEach(x => lines.push(['Add-on', `${EQUIPMENT.find(e => e.id === x.equipment_id).name} x${x.quantity}`]));
      lines.push(['Total', peso(row.out_total)]);
      bkDlg.close();
      showSuccess({ title: 'Successfully booked!', label: 'Your booking reference code', ref: row.out_ref, lines,
        note: 'Keep this code. Staff will confirm your booking once your payment is verified.' });
      await loadMyBookings(); await loadMyRentals(); await refreshBook();
    } catch (err) { bkError(err.message); btn.disabled = false; btn.textContent = 'Submit booking'; }
  };
  bkDlg.onclose = () => { draft = null; };
  bkDlg.showModal();
}

/* ============================ 3. RENT EQUIPMENT ============================ */
const unitPrice = e => rentMode === 'addon' ? e.addonPrice : e.outsidePrice;
function rentDays() {
  const p = $('#pd').value, r = $('#rd').value;
  if (!p || !r) return 1;
  return Math.max(1, Math.round((new Date(r + 'T00:00') - new Date(p + 'T00:00')) / 864e5));
}
function lineTotal(i) {
  const e = EQUIPMENT[i], c = cart[i], unit = unitPrice(e);
  if (e.flat || rentMode === 'addon') return unit * c.q;
  return unit * c.q * rentDays();
}

function renderFilters() {
  const cats = ['All', ...new Set(EQUIPMENT.map(e => e.category).filter(Boolean))];
  $('#eq-filter').hidden = cats.length < 2;
  $('#eq-filter').innerHTML = cats.map(c => `<button type="button" class="chip ${c === eqFilter ? 'on' : ''}" data-cat="${esc(c)}" aria-pressed="${c === eqFilter}">${esc(c)}</button>`).join('');
}

function renderEquipment() {
  const shown = EQUIPMENT.map((e, i) => [e, i]).filter(([e]) => eqFilter === 'All' || e.category === eqFilter);
  $('#eq').innerHTML = shown.length ? shown.map(([e, i]) => {
    const offered = rentMode === 'addon' ? e.addon : e.outside, ok = offered && e.stock > 0;
    const unit = e.flat ? 'per rental, 8 hrs' : rentMode === 'addon' ? 'per session' : 'per day, 8 hrs minimum';
    const img = e.img ? `<div class="eqimg has"><img src="${esc(e.img)}" alt="${esc(e.name)}"></div>` : `<div class="eqimg" role="img" aria-label="No image yet">${IMAGE_ICON}</div>`;
    return `<div class="card" data-eq="${e.id}" style="${offered ? '' : 'opacity:.55'}">${img}
      <p class="cat">${esc(e.category)}</p>
      <div class="row"><h3>${esc(e.name)}</h3>${e.stock < 2 && !e.flat ? badge('Low') : ''}</div>
      ${e.desc ? `<p class="mut" style="margin-top:4px">${esc(e.desc)}</p>` : ''}<p class="mut">${e.stock} available</p>
      <p style="margin-top:6px">${e.addon ? '<span class="b addon">Add-on</span> ' : ''}${e.outside ? '<span class="b out">Outside</span>' : ''}</p>
      <div class="row" style="margin-top:10px;flex-wrap:wrap">
        <span><b>${offered ? peso(unitPrice(e)) : 'Not offered'}</b> <span class="mut">${offered ? unit : ''}</span></span>
        <span class="row" style="margin-left:auto">${e.flat ? '<span class="mut">1 set</span>' : `<input class="qty" type="number" min="1" max="${e.stock}" value="1" aria-label="Quantity" data-q="${i}" ${ok ? '' : 'disabled'}>`}
        <button class="btn sm" data-add="${i}" ${ok ? '' : 'disabled'}>Add</button></span></div></div>`;
  }).join('') : `<p class="mut">${EQUIPMENT.length ? 'No equipment in this category.' : 'No equipment is listed yet.'}</p>`;
}

function renderCart() {
  const keys = Object.keys(cart);
  $('#bundle-tag-wrap').innerHTML = rentMode === 'out' && keys.length >= 2 ? `<div class="bundle-tag">Rental bundle: ${keys.length} items</div>` : '';
  $('#cart').innerHTML = keys.length ? keys.map(i => {
    const e = EQUIPMENT[i], c = cart[i];
    const label = e.flat ? `${esc(e.name)} (8 hrs)` : rentMode === 'out' ? `${esc(e.name)} x ${c.q} (${pl(rentDays(), 'day')})` : `${esc(e.name)} x ${c.q}`;
    return `<li><span>${label} <button class="lk" data-rm="${i}" aria-label="Remove ${esc(e.name)}">Remove</button></span><span>${peso(lineTotal(i))}</span></li>`;
  }).join('') : '<li><span class="mut">Nothing added yet</span><span></span></li>';
  $('#ctt').textContent = peso(keys.reduce((sum, i) => sum + lineTotal(i), 0));
}

function renderRentMode() {
  $('#fa').hidden = rentMode !== 'addon';
  $('#fo').hidden = rentMode === 'addon';
  $('#rmh').textContent = rentMode === 'addon'
    ? 'Used inside the studio you booked. Tied to your booking reference. Priced per session; flat-priced items are priced per rental.'
    : 'Taken out of the studio. Minimum rent is 8 hours. Priced per day; flat-priced items are priced per rental. You get an OUT reference.';
  $$('#rm button').forEach(b => b.classList.toggle('on', b.dataset.m === rentMode));
  updateRequestButton();
}
const updateRequestButton = () => { $('#rq').disabled = member && rentMode === 'out' && !$('#vf').files.length; };

function renderAttachOptions() {
  const usable = MY_BOOKINGS.filter(b => b.date >= TODAY && ['Pending', 'Confirmed', 'Active'].includes(b.status));
  $('#lb').innerHTML = usable.length
    ? usable.map(b => `<option value="${b.ref}">${b.ref} - ${esc(b.studio)}, ${b.date === TODAY ? 'today' : shortDate(b.date)} ${b.start}</option>`).join('')
    : '<option value="">No upcoming booking. Book a studio first.</option>';
}

function initRentTab() {
  $('#pd').min = $('#rd').min = TODAY;
  $('#pd').value = dayOffset(1); $('#rd').value = dayOffset(2);
  if (member) { $('#oc').value = customer.number; $('#sm').value = customer.backup_number || ''; }
  $('#eq-filter').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]'); if (!b) return;
    eqFilter = b.dataset.cat; renderFilters(); renderEquipment();
  });

  $('#rm').addEventListener('click', e => {
    const m = e.target.dataset.m; if (!m) return;
    rentMode = m; cart = {}; renderEquipment(); renderCart(); renderRentMode();
  });
  $('#eq').addEventListener('click', e => {
    const btn = e.target.closest('[data-add]'); if (!btn) return;
    const i = btn.dataset.add, input = $(`[data-q="${i}"]`);
    cart[i] = { q: input ? Math.min(Math.max(+input.value || 1, 1), EQUIPMENT[i].stock) : 1 };
    renderCart();
  });
  $('#cart').addEventListener('click', e => { const rm = e.target.closest('[data-rm]'); if (rm) { delete cart[rm.dataset.rm]; renderCart(); } });
  ['#pd', '#rd'].forEach(sel => $(sel).addEventListener('change', renderCart));
  $('#rpm').addEventListener('change', e => { $('#rgw').hidden = e.target.value !== 'GCash'; });
  $('#vf').addEventListener('change', updateRequestButton);
  $('#rq').addEventListener('click', requestRental);
}

async function requestRental() {
  if (!member) return askToLogIn('request a rental');
  const keys = Object.keys(cart);
  if (!keys.length) return toast('Add at least one item first.');
  const items = keys.map(i => ({ equipment_id: EQUIPMENT[i].id, quantity: cart[i].q }));
  const method = $('#rpm').value, gcash = $('#rg').value.replace(/\s/g, '');
  if (method === 'GCash' && !/^\d{13}$/.test(gcash)) return toast('Enter the 13-digit GCash reference.');
  const btn = $('#rq'); btn.disabled = true;
  try {
    let args = { p_type: rentMode === 'addon' ? 'Add-on' : 'Outside', p_items: items, p_payment_method: method, p_gcash_reference: method === 'GCash' ? gcash : null };
    if (rentMode === 'addon') {
      args.p_booking_ref = $('#lb').value;
      if (!args.p_booking_ref) return toast('Attach the rental to a studio booking first.');
    } else {
      const pd = $('#pd').value, rd = $('#rd').value, backup = $('#sm').value.trim(), file = $('#vf').files[0];
      if (!pd || !rd) return toast('Choose a pick-up and return date.');
      if (pd < TODAY) return toast('Pick-up date cannot be in the past.');
      if (rd < pd) return toast('Return date must be on or after the pick-up date.');
      if (backup && !/^[\d\s+()-]{7,20}$/.test(backup)) return toast('Backup contact must be a phone number (7 to 20 characters).');
      if (!file) return toast('Attach a valid ID.');
      const path = await Equipment.uploadId(file, userId);
      const nowHour = manilaParts(new Date()).hour;
      const pickHour = pd === TODAY ? Math.min(21, Math.max(10, nowHour + 1)) : 10;
      const pickup = new Date(manilaTS(pd, pickHour));
      const days = Math.round((new Date(rd + 'T00:00') - new Date(pd + 'T00:00')) / 864e5);
      const back = new Date(pickup.getTime() + (days > 0 ? days * 24 : 8) * 3600e3);
      Object.assign(args, { p_pickup: pickup.toISOString(), p_return: back.toISOString(), p_id_type: $('#vt').value, p_id_path: path, p_backup: backup || null });
    }
    const row = await Equipment.requestRental(args);
    const wasAddon = rentMode === 'addon';
    cart = {}; $('#vf').value = ''; $('#rg').value = '';
    renderCart();
    await loadMyRentals();
    showSuccess({ title: 'Rental request sent!', label: 'Your reference code', ref: wasAddon ? args.p_booking_ref : row.out_ref,
      note: 'Staff will review your request. Keep this code for your records.' });
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; updateRequestButton(); }
}

/* ============================ 4. MY BOOKING ============================ */
const startsAt = b => new Date(`${b.date}T${pad(10 + SLOTS.indexOf(b.start))}:00:00+08:00`);
const insideCutoff = b => startsAt(b) - Date.now() < 24 * 3600e3;
const CUTOFF_MSG = 'Changes and cancellations close 24 hours before your session.';

async function loadMyBookings() {
  try {
    const rows = await Booking.listMyBookings();
    MY_BOOKINGS = rows.map(r => {
      const p = manilaParts(r.start_at), pay = (r.payment || [])[0] || null;
      return { ref: r.booking_ref, studioId: r.studio_id, studio: r.studio_room ? r.studio_room.name : '', desc: r.studio_room ? (r.studio_room.description || '') : '',
        date: p.date, start: SLOTS[p.hour - 10], hours: Math.round((new Date(r.end_at) - new Date(r.start_at)) / 3600e3),
        rate: Number(r.hourly_rate_at_booking), status: BK_LABEL[r.status] || r.status,
        payment: pay ? pay.status : 'Pending', payAmount: pay ? Number(pay.amount) : null };
    });
  } catch (err) { console.error(err); toast('Could not load your bookings.'); MY_BOOKINGS = []; }
  renderMyBookings(); renderAttachOptions();
}

function renderMyBookings() {
  if (!MY_BOOKINGS.length) { $('#mybk').innerHTML = '<p class="mut" style="padding:8px">No bookings yet. Book a studio to get started.</p>'; return; }
  $('#mybk').innerHTML = table(['Reference', 'Studio', 'Date', 'Time', 'Duration', 'Status', 'Payment', ''],
    [...MY_BOOKINGS].sort((a, b) => startsAt(a) - startsAt(b)).map(b => {
      const editable = b.status === 'Confirmed' || b.status === 'Pending';
      const actions = editable
        ? `<button class="btn sm" data-act="resched" data-ref="${b.ref}">Reschedule</button><button class="btn sm line" data-act="cancel" data-ref="${b.ref}">Cancel</button>`
        : `<button class="btn sm line" data-act="details" data-ref="${b.ref}">Details</button>`;
      return [b.ref, esc(b.studio), shortDate(b.date), b.start, pl(b.hours, 'hr'), badge(b.status), badge(b.payment), actions];
    }));
}

function showDetails(b) {
  const addons = MY_RENTALS.filter(r => r.type === 'addon' && r.ref === b.ref && !['Rejected', 'Cancelled'].includes(r.status));
  const total = b.payAmount ?? (b.rate * b.hours);
  showDialog(`<div class="row"><h2 style="margin:0">${esc(b.ref)}</h2>${badge(b.status)}</div>
    <dl class="dl"><dt>Studio</dt><dd>${esc(b.studio)}${b.desc ? ', ' + esc(b.desc) : ''}</dd>
    <dt>Date</dt><dd>${longDate(b.date)}</dd>
    <dt>Time</dt><dd>${b.start} to ${endTime(b.start, b.hours)} (${pl(b.hours, 'hr')})</dd>
    ${addons.length ? `<dt>Add-ons</dt><dd>${addons.map(a => `${esc(a.item)} x${a.qty} (${peso(a.price * a.qty)})`).join('<br>')}</dd>` : ''}
    <dt>Total</dt><dd>${peso(total)}</dd><dt>Payment</dt><dd>${badge(b.payment)}</dd></dl>
    <p class="mut">Bookings are confirmed after staff verify your payment.</p>
    <div class="acts"><button class="btn line" data-close>Close</button></div>`);
}

function confirmCancel(b) {
  showDialog(`<h2>Cancel ${esc(b.ref)}?</h2>
    <p class="mut">${esc(b.studio)}, ${longDate(b.date)} at ${b.start}. The time slot is released. Payments are not refunded.</p>
    <div class="acts"><button class="btn line" data-close>Keep booking</button><button class="btn bad" id="do-cancel">Cancel booking</button></div>`);
  $('#do-cancel').onclick = async () => {
    try { await Booking.cancelBooking(b.ref); dlg.close(); await loadMyBookings(); await refreshBook(); toast(`${b.ref} cancelled.`); }
    catch (err) { toast(err.message); }
  };
}

function openReschedule(b) {
  const pick = { date: b.date, t: -1 };
  showDialog(`<h2>Reschedule ${esc(b.ref)}</h2>
    <p class="mut">${esc(b.studio)}, ${pl(b.hours, 'hr')}. Pick a new date and start time.</p>
    <label for="rs-d">New date</label><input id="rs-d" type="date" min="${TODAY}" value="${b.date}">
    <label>New start time</label><div class="slots" id="rs-slots"></div>
    <div class="acts"><button class="btn line" data-close>Keep current time</button><button class="btn gold" id="rs-save" disabled>Save new time</button></div>`);
  const draw = async () => {
    let map = {};
    try { map = await Booking.getBusy(b.studioId, pick.date, pick.date); } catch (err) { toast('Could not load availability.'); }
    const used = new Set(map[pick.date] || []);
    if (pick.date === b.date) { const first = SLOTS.indexOf(b.start); for (let h = 0; h < b.hours; h++) used.delete(first + h); }   // ignore itself
    $('#rs-slots').innerHTML = SLOTS.map((t, i) => {
      const ok = i + b.hours <= SLOTS.length && Array.from({ length: b.hours }, (_, j) => !used.has(i + j)).every(Boolean);
      return `<button type="button" data-i="${i}" class="${i === pick.t ? 'sel' : ''}" ${ok ? '' : 'disabled'}>${t}</button>`;
    }).join('');
    $('#rs-save').disabled = pick.t < 0;
  };
  draw();
  $('#rs-d').onchange = e => { pick.date = e.target.value || b.date; pick.t = -1; draw(); };
  $('#rs-slots').onclick = e => { const btn = e.target.closest('button'); if (btn && !btn.disabled) { pick.t = +btn.dataset.i; draw(); } };
  $('#rs-save').onclick = async () => {
    try {
      await Booking.rescheduleBooking(b.ref, pick.date, pick.t, b.hours);
      dlg.close(); await loadMyBookings(); await refreshBook();
      toast(`${b.ref} moved to ${shortDate(pick.date)} at ${SLOTS[pick.t]}.`);
    } catch (err) { toast(err.message); }
  };
}

function initBookingsTab() {
  $('#mybk').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const b = MY_BOOKINGS.find(x => x.ref === btn.dataset.ref); if (!b) return;
    if (btn.dataset.act === 'details') return showDetails(b);
    if (insideCutoff(b)) return toast(CUTOFF_MSG);
    if (btn.dataset.act === 'resched') openReschedule(b); else confirmCancel(b);
  });
}

/* ============================ 5. MY RENTALS ============================ */
async function loadMyRentals() {
  try {
    const rows = await Equipment.listMyRentals();
    MY_RENTALS = [];
    rows.forEach(o => {
      const addon = o.rental_type === 'Add-on', bk = o.booking;
      (o.rental_details || []).forEach(d => {
        MY_RENTALS.push({
          ref: addon ? (bk ? bk.booking_ref : o.rental_ref) : o.rental_ref,
          item: d.equipment ? d.equipment.name : 'Equipment', qty: d.quantity, price: Number(d.unit_price_at_request) || 0,
          type: addon ? 'addon' : 'out',
          when: addon ? (bk ? `${shortDate(manilaParts(bk.start_at).date)}, ${SLOTS[manilaParts(bk.start_at).hour - 10]}` : '')
                      : `${o.pickup_date ? shortDate(manilaParts(o.pickup_date).date) : ''} to ${o.return_date ? shortDate(manilaParts(o.return_date).date) : ''}`,
          ret: addon ? (bk ? shortDate(manilaParts(bk.end_at).date) : '') : (o.return_date ? shortDate(manilaParts(o.return_date).date) : ''),
          status: RN_LABEL[o.status] || o.status, reason: o.rejection_reason || ''
        });
      });
    });
  } catch (err) { console.error(err); toast('Could not load your rentals.'); MY_RENTALS = []; }
  renderMyRentals();
}

const whyRejected = (status, reason) => status === 'Rejected' ? `<b>Reason for rejection:</b> ${esc(reason || 'No reason was given. Please contact the studio.')}` : '';
function renderMyRentals() {
  if (!MY_RENTALS.length) { $('#myrent').innerHTML = '<p class="mut" style="padding:8px">No rentals yet.</p>'; return; }
  const head = ['Reference', 'Equipment', 'Qty', 'Rent type', 'Session or dates', 'Return date', 'Status'];
  $('#myrent').innerHTML = `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>` +
    MY_RENTALS.map(r => {
      const note = whyRejected(r.status, r.reason);
      const cells = [esc(r.ref), esc(r.item), String(r.qty), r.type === 'addon' ? '<span class="b addon">Add-on</span>' : '<span class="b out">Outside</span>', esc(r.when), esc(r.ret), badge(r.status)];
      return `<tr class="${note ? 'has-why' : ''}">${cells.map(c => `<td>${c}</td>`).join('')}</tr>` + (note ? `<tr class="why-row"><td colspan="${head.length}">${note}</td></tr>` : '');
    }).join('') + '</tbody></table>';
}
