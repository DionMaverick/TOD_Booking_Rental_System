// Landing page: carousel, quick availability, studio and equipment cards.
import * as Booking from '../services/BookingService.js';
import * as Equipment from '../services/EquipmentService.js';
import * as Auth from '../services/AuthService.js';
import { $, esc, peso, badge, TODAY, SLOTS, longDate, reducedMotion, mountChrome, navigate, toast, STUDIO_COLORS } from '../modules/shared.js';

let STUDIOS = [], EQUIPMENT = [];
const isClosed = s => s.status !== 'Available';
const IMAGE_ICON = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/></svg>';
const letter = s => s.name.replace(/^studio\s*/i, '');

export async function initHome() {
  const session = await Auth.getSession().catch(() => null);
  const customer = session ? await Auth.getCustomer().catch(() => null) : null;
  mountChrome({
    active: 'home',
    user: customer ? { label: customer.first_name } : null,
    onLogout: async () => { await Auth.signOut(); location.reload(); }
  });

  try {
    [STUDIOS, EQUIPMENT] = await Promise.all([Booking.listStudios(), Equipment.listEquipment()]);
  } catch (err) {
    console.error(err);
    toast('Could not load studios and equipment: ' + (err.message || 'check your connection.'));
  }

  renderStudioOptions(); renderStudios(); renderEquipment(); initCarousel(); initAvailability();
  $('#studio-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-book-studio]');
    if (b) navigate('book', { studio: b.dataset.bookStudio });
  });
  $('#equipment-grid').addEventListener('click', e => {
    const b = e.target.closest('[data-rent-item]');
    if (b) navigate('rent', { item: b.dataset.rentItem });
  });
}

/* ---------- Rendering ---------- */
function renderStudioOptions() {
  $('#qs').innerHTML = STUDIOS.map((s, i) => `<option value="${i}">${esc(s.name)}, ${peso(s.hourly_rate)}/hr</option>`).join('');
}

function renderStudios() {
  $('#studio-grid').innerHTML = STUDIOS.length ? STUDIOS.map((s, i) => {
    const c = STUDIO_COLORS[i % STUDIO_COLORS.length], closed = isClosed(s);
    const thumb = s.image
      ? `<div class="ph has"><img src="${esc(s.image)}" alt="${esc(s.name)}" loading="lazy"></div>`
      : `<div class="ph" style="background:linear-gradient(135deg,${c[0]},${c[1]})">${esc(letter(s))}</div>`;
    return `<div class="card">${thumb}
      <div class="row"><h3>${esc(s.name)}</h3>${badge(s.status)}</div>
      <p class="mut">${esc(s.description || '')}</p>
      <div class="row" style="margin-top:12px"><span><b>${peso(s.hourly_rate)}</b> <span class="mut">per hour</span></span>
      <button class="btn gold" data-book-studio="${s.studio_id}" ${closed ? 'disabled' : ''}>${closed ? 'Closed' : 'Book now'}</button></div></div>`;
  }).join('') : '<p class="mut">No studios are listed yet.</p>';
}

function renderEquipment() {
  $('#equipment-grid').innerHTML = EQUIPMENT.length ? EQUIPMENT.map(e => {
    const flat = e.pricing_type === 'Flat', left = Math.max(e.total_quantity - e.in_use, 0);
    const lines = [];
    if (e.allow_addon) lines.push(`<div><span class="b addon">Add-on</span> ${peso(e.add_on_rate)} ${flat ? 'per rental' : 'per session'}</div>`);
    if (e.allow_outside) lines.push(`<div><span class="b out">Outside</span> ${peso(e.outside_rate)} ${flat ? 'per rental, 8 hrs' : 'per day, 8 hrs minimum'}</div>`);
    const img = e.image ? `<div class="eqimg has"><img src="${esc(e.image)}" alt="${esc(e.name)}"></div>` : `<div class="eqimg" role="img" aria-label="No image yet">${IMAGE_ICON}</div>`;
    return `<div class="card">${img}
      <p class="cat">${esc(e.equipment_category ? e.equipment_category.category_name : '')}</p>
      <h3>${esc(e.name)}</h3>
      ${e.description ? `<p class="mut" style="margin-top:4px">${esc(e.description)}</p>` : ''}
      <p class="mut">${e.status === 'Available' ? left + ' available' : 'Unavailable'}</p>
      <div class="price-lines">${lines.join('')}</div>
      <button class="btn gold full" data-rent-item="${e.equipment_id}">Rent</button></div>`;
  }).join('') : '<p class="mut">No equipment is listed yet.</p>';
}

/* ---------- Carousel ---------- */
function initCarousel() {
  const slides = STUDIOS.map((s, i) => ({ label: s.name, img: s.image, c1: STUDIO_COLORS[i % 4][0], c2: STUDIO_COLORS[i % 4][1] }));
  slides.push({ label: 'Rental gear', img: null, c1: '#6E0F1C', c2: '#0B0B0D' });
  const slider = $('#slider'), dots = $('#sdots'), wrap = $('#sw');
  let current = 0, timer;
  slider.innerHTML = slides.map(s => s.img
    ? `<div class="slide"><img src="${esc(s.img)}" alt="${esc(s.label)}"></div>`
    : `<div class="slide" style="background:linear-gradient(135deg,${s.c1},${s.c2})">${esc(s.label)}</div>`).join('');
  dots.innerHTML = slides.map((_, i) => `<button aria-label="Slide ${i + 1}"></button>`).join('');
  const mark = () => [...dots.children].forEach((d, i) => d.classList.toggle('active', i === current));
  const goTo = i => {
    if (!slider.clientWidth) return;
    current = i;
    slider.scrollTo({ left: i * slider.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' });
    mark();
  };
  const start = () => { clearInterval(timer); if (!reducedMotion()) timer = setInterval(() => goTo((current + 1) % slides.length), 3500); };
  slider.addEventListener('scroll', () => { const n = Math.round(slider.scrollLeft / (slider.clientWidth || 1)); if (n !== current) { current = n; mark(); } });
  dots.addEventListener('click', e => { const b = e.target.closest('button'); if (b) { goTo([...dots.children].indexOf(b)); start(); } });
  wrap.addEventListener('mouseenter', () => clearInterval(timer));
  wrap.addEventListener('mouseleave', start);
  wrap.addEventListener('touchstart', () => clearInterval(timer), { passive: true });
  wrap.addEventListener('touchend', start);
  $('.slide-cta').addEventListener('click', () => navigate('book'));
  mark(); start();
}

/* ---------- Quick availability ---------- */
async function checkAvailability() {
  const i = +$('#qs').value, studio = STUDIOS[i], date = $('#qd').value, time = $('#qt').value, box = $('#avail');
  box.hidden = false; box.dataset.studio = i; box.dataset.date = date;
  if (!studio) { box.innerHTML = '<div class="card"><p class="mut">No studios to check yet.</p></div>'; return; }
  if (!date) { box.innerHTML = '<div class="card"><h3>Pick a date</h3><p class="mut">Choose a date, then check availability again.</p></div>'; return; }

  let taken;
  try { taken = (await Booking.getBusy(studio.studio_id, date, date))[date] || new Set(); }
  catch (err) { box.innerHTML = '<div class="card"><div class="alert">Could not load availability. Try again.</div></div>'; return; }
  const openTimes = SLOTS.filter((_, k) => !taken.has(k));
  let html;
  if (isClosed(studio)) {
    const others = STUDIOS.map((s, k) => [s, k]).filter(([s]) => !isClosed(s));
    html = `<div class="row"><h3>${esc(studio.name)} is closed</h3>${badge(studio.status)}</div>
      <p class="mut">It is not taking bookings right now. These studios are open:</p>
      <div>${others.map(([s, k]) => `<button class="chip" data-pick-studio="${k}">${esc(s.name)}, ${peso(s.hourly_rate)}/hr</button>`).join('')}</div>`;
  } else if (openTimes.includes(time)) {
    html = `<div class="row"><h3>${esc(studio.name)} is free on ${longDate(date)} at ${time}</h3>${badge('Available')}</div>
      <p class="mut">${peso(studio.hourly_rate)} per hour. ${esc(studio.description || '')}</p>
      <div><button class="btn gold" data-book-time="${esc(time)}">Book this slot</button></div>`;
  } else {
    html = `<div class="row"><h3>${esc(studio.name)} is booked on ${longDate(date)} at ${time}</h3><span class="b unavailable">Booked</span></div>
      <p class="mut">${openTimes.length ? 'These times are still open that day. Pick one to continue.' : 'Nothing is open that day. Try another date or studio.'}</p>
      <div>${openTimes.map(t => `<button class="chip" data-book-time="${esc(t)}">${t}</button>`).join('')}</div>`;
  }
  box.innerHTML = `<div class="card">${html}</div>`;
}

function initAvailability() {
  $('#qd').value = TODAY; $('#qd').min = TODAY;
  $('#qb-check').addEventListener('click', checkAvailability);
  ['#qs', '#qd', '#qt'].forEach(sel => $(sel).addEventListener('change', () => { if (!$('#avail').hidden) checkAvailability(); }));
  $('#avail').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const box = $('#avail');
    if (b.dataset.bookTime !== undefined) navigate('book', { studio: STUDIOS[+box.dataset.studio].studio_id, date: box.dataset.date, time: b.dataset.bookTime });
    else if (b.dataset.pickStudio !== undefined) { $('#qs').value = b.dataset.pickStudio; checkAvailability(); }
  });
}
