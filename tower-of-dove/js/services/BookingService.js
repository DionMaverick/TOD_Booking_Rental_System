// Studio data, availability and booking operations.
import { supabase } from '../modules/supabase-config.js';
import { manilaTS, manilaParts } from '../modules/shared.js';

export async function listStudios() {
  const { data, error } = await supabase.from('studio_room').select('*').order('studio_id');
  if (error) throw error;
  return data;
}

/* Taken hours for a studio between two dates (YYYY-MM-DD).
   Returns { 'YYYY-MM-DD': Set of slot indexes }, 0 = 10:00 AM. */
export async function getBusy(studioId, fromDate, toDate) {
  const { data, error } = await supabase.rpc('get_busy_slots', {
    p_studio_id: studioId,
    p_from: manilaTS(fromDate, 0),
    p_to: new Date(new Date(manilaTS(toDate, 0)).getTime() + 864e5).toISOString()
  });
  if (error) throw error;
  const map = {};
  (data || []).forEach(r => {
    const end = new Date(r.end_at).getTime();
    for (let t = new Date(r.start_at).getTime(); t < end; t += 3600e3) {
      const p = manilaParts(t), idx = p.hour - 10;
      if (idx < 0 || idx > 11) continue;
      (map[p.date] = map[p.date] || new Set()).add(idx);
    }
  });
  return map;
}

export async function createBooking({ studioId, date, startIdx, hours, method, gcash, items }) {
  const { data, error } = await supabase.rpc('create_booking', {
    p_studio_id: studioId,
    p_start_at: manilaTS(date, 10 + startIdx),
    p_end_at: manilaTS(date, 10 + startIdx + hours),
    p_payment_method: method,
    p_gcash_reference: method === 'GCash' ? gcash : null,
    p_items: items
  });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;     // { out_ref, out_total }
}

export async function listMyBookings() {
  const { data, error } = await supabase.from('booking')
    .select('booking_id, booking_ref, status, start_at, end_at, hourly_rate_at_booking, studio_id, studio_room(name, description), payment(payment_id, status, method, amount)')
    .order('start_at');
  if (error) throw error;
  return data;
}

export async function rescheduleBooking(ref, date, startIdx, hours) {
  const { error } = await supabase.rpc('reschedule_booking', {
    p_booking_ref: ref,
    p_start_at: manilaTS(date, 10 + startIdx),
    p_end_at: manilaTS(date, 10 + startIdx + hours)
  });
  if (error) throw new Error(error.message);
}

export async function cancelBooking(ref) {
  const { error } = await supabase.rpc('cancel_booking', { p_booking_ref: ref });
  if (error) throw new Error(error.message);
}

/* Guest lookup by reference code. Returns null when nothing matches. */
export async function lookupBooking(ref) {
  const { data, error } = await supabase.rpc('lookup_booking', { p_ref: ref });
  if (error) throw new Error(error.message);
  return data;
}
