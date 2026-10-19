// Equipment catalogue, stock and rental requests.
import { supabase } from '../modules/supabase-config.js';

/* Equipment plus how many are currently out (Approved or Active orders). */
export async function listEquipment() {
  const [eq, use] = await Promise.all([
    supabase.from('equipment').select('*, equipment_category(category_name)').order('equipment_id'),
    supabase.rpc('get_equipment_in_use')
  ]);
  if (eq.error) throw eq.error;
  if (use.error) throw use.error;
  const inUse = {};
  (use.data || []).forEach(r => { inUse[r.equipment_id] = r.in_use; });
  return eq.data.map(e => ({ ...e, in_use: inUse[e.equipment_id] || 0 }));
}

export async function listMyRentals() {
  const { data, error } = await supabase.from('rental_order')
    .select('rental_order_id, rental_ref, rental_type, status, pickup_date, return_date, rejection_reason, created_at, booking(booking_ref, start_at, end_at), rental_details(quantity, unit_price_at_request, equipment(name))')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* Private bucket; path starts with the user id (the storage policy requires it). */
export async function uploadId(file, userId) {
  const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from('rental-ids').upload(path, file, { contentType: file.type });
  if (error) throw new Error('Could not upload your ID: ' + error.message);
  return path;
}

export async function requestRental(args) {
  const { data, error } = await supabase.rpc('request_rental', args);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;     // { out_ref, out_total }
}

/* Guest lookup by rental reference or booking reference. Returns a list of items, or null. */
export async function lookupRental(ref) {
  const { data, error } = await supabase.rpc('lookup_rental', { p_ref: ref });
  if (error) throw new Error(error.message);
  return data;
}
