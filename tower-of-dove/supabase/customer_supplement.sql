-- =========================================================
-- Tower of Dove: customer supplement (run AFTER ErrorFreeSetup.sql)
-- Adds no tables or columns. Run random_references_migration.sql instead if you already ran an older version.
-- =========================================================

-- 1. FIX: the security rules call this function, so it must be allowed
grant execute on function public.is_staff_or_owner() to anon, authenticated;

-- 2. Reference numbers are random and made by the database (see section 9)

-- 3. When someone registers, create their customer row automatically
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if m ->> 'kind' = 'customer' then
    insert into public.customer (auth_user_id, first_name, last_name, number)
    values (new.id,
            coalesce(nullif(trim(m ->> 'first_name'), ''), 'Customer'),
            coalesce(nullif(trim(m ->> 'last_name'), ''), '-'),
            coalesce(nullif(trim(m ->> 'number'), ''), 'N/A'));
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- 4. Let customers read their own payments and rental items
drop policy if exists "Customers view own payments" on public.payment;
create policy "Customers view own payments" on public.payment for select using (
  exists (select 1 from public.booking b join public.customer c on c.customer_id = b.customer_id
          where b.booking_id = payment.booking_id and c.auth_user_id = auth.uid())
  or exists (select 1 from public.rental_order o join public.customer c on c.customer_id = o.customer_id
          where o.rental_order_id = payment.rental_order_id and c.auth_user_id = auth.uid()));

drop policy if exists "Customers view own rental items" on public.rental_details;
create policy "Customers view own rental items" on public.rental_details for select using (
  exists (select 1 from public.rental_order o join public.customer c on c.customer_id = o.customer_id
          where o.rental_order_id = rental_details.rental_order_id and c.auth_user_id = auth.uid()));

-- 5. Storage: private bucket for ID photos, public bucket for studio images
insert into storage.buckets (id, name, public) values
  ('rental-ids', 'rental-ids', false),
  ('studio-images', 'studio-images', true)
on conflict (id) do nothing;

drop policy if exists "Customers upload own ID" on storage.objects;
create policy "Customers upload own ID" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-ids' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Staff read IDs" on storage.objects;
create policy "Staff read IDs" on storage.objects for select to authenticated
  using (bucket_id = 'rental-ids' and public.is_staff_or_owner());

drop policy if exists "Public read studio images" on storage.objects;
create policy "Public read studio images" on storage.objects for select to anon, authenticated
  using (bucket_id = 'studio-images');

-- 6. Public availability (no customer data is returned)
create or replace function public.get_busy_slots(p_studio_id bigint, p_from timestamptz, p_to timestamptz)
returns table (start_at timestamptz, end_at timestamptz)
language sql stable security definer set search_path = public as $$
  select start_at, end_at from public.booking
  where studio_id = p_studio_id
    and status in ('Pending', 'Approved', 'In Progress')
    and start_at < p_to and end_at > p_from;
$$;

create or replace function public.get_equipment_in_use()
returns table (equipment_id bigint, in_use integer)
language sql stable security definer set search_path = public as $$
  select d.equipment_id, sum(d.quantity)::int
  from public.rental_details d
  join public.rental_order o on o.rental_order_id = d.rental_order_id
  where o.status in ('Approved', 'Active')
  group by d.equipment_id;
$$;

-- 7. Helper: booking time rules (open 10 AM to 10 PM Manila, 1 to 4 hours, future)
create or replace function public._check_slot(p_start timestamptz, p_end timestamptz)
returns void language plpgsql as $$
declare
  v_hours numeric := extract(epoch from (p_end - p_start)) / 3600;
  v_start timestamp := p_start at time zone 'Asia/Manila';
  v_end   timestamp := p_end   at time zone 'Asia/Manila';
begin
  if v_hours < 1 or v_hours > 4 then raise exception 'Bookings are 1 to 4 hours.'; end if;
  if v_start::date <> v_end::date or v_start::time < '10:00' or v_end::time > '22:00' then
    raise exception 'The studio is open 10:00 AM to 10:00 PM.';
  end if;
  if p_start <= now() then raise exception 'Choose a time in the future.'; end if;
end $$;

-- 8. Helper: add equipment to an order, check stock, return the total price
--    Standard items: price x quantity (outside rentals also x days).
--    Flat items (drum sets): price x quantity, always 8 hours.
create or replace function public._add_rental_items(p_order bigint, p_type text, p_items jsonb, p_days int)
returns numeric language plpgsql as $$
declare
  v_item jsonb; v_eq public.equipment; v_qty int; v_used int; v_price numeric; v_total numeric := 0;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'quantity')::int;
    select * into v_eq from public.equipment where equipment_id = (v_item ->> 'equipment_id')::bigint;
    if not found then raise exception 'Equipment not found.'; end if;
    if v_qty < 1 then raise exception 'Quantity must be at least 1.'; end if;
    if v_eq.status <> 'Available' then raise exception '% is not available.', v_eq.name; end if;

    -- how many are already out?
    select coalesce(sum(d.quantity), 0) into v_used
    from public.rental_details d
    join public.rental_order o on o.rental_order_id = d.rental_order_id
    where d.equipment_id = v_eq.equipment_id and o.status in ('Approved', 'Active');
    if v_qty > v_eq.total_quantity - v_used then
      raise exception 'Not enough % available.', v_eq.name;
    end if;

    -- price
    if p_type = 'Add-on' then
      if not v_eq.allow_addon then raise exception '% cannot be an add-on.', v_eq.name; end if;
      v_price := v_eq.add_on_rate * v_qty;
    else
      if not v_eq.allow_outside then raise exception '% cannot be rented outside.', v_eq.name; end if;
      v_price := v_eq.outside_rate * v_qty * (case when v_eq.pricing_type = 'Flat' then 1 else p_days end);
    end if;

    insert into public.rental_details (rental_order_id, equipment_id, quantity, unit_price_at_request, rental_hours)
    values (p_order, v_eq.equipment_id, v_qty,
            case when p_type = 'Add-on' then v_eq.add_on_rate else v_eq.outside_rate end,
            case when v_eq.pricing_type = 'Flat' then 8 end);   -- Flat = 8 hours, Standard = NULL

    v_total := v_total + v_price;
  end loop;
  return v_total;
end $$;

-- 9. Reference numbers (TOD-9F3A21C7, OUT-5B07E1AA, RA-C41D90E2), then booking and rental functions
--    The generator makes a random code and checks that neither table already uses it.
--    SECURITY DEFINER so the check sees ALL rows, not just the caller's (RLS).
--    It is NOT granted to the browser roles: only the database calls it.
create or replace function public.random_ref(p_prefix text) returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text;
begin
  loop
    r := p_prefix || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.booking      where booking_ref = r)
          and not exists (select 1 from public.rental_order where rental_ref  = r);
  end loop;
  return r;
end $$;

revoke execute on function public.random_ref(text) from public, anon, authenticated;

-- 9a. New bookings get a random reference automatically
alter table public.booking alter column booking_ref set default public.random_ref('TOD');

-- 9b. New rental orders get a random reference automatically (OUT for outside, RA for add-on)
create or replace function public.rental_random_ref() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.rental_ref is null or new.rental_ref = '' then
    new.rental_ref := public.random_ref(case new.rental_type when 'Outside' then 'OUT' else 'RA' end);
  end if;
  return new;
end $$;

drop trigger if exists aa_rental_random_ref on public.rental_order;
create trigger aa_rental_random_ref before insert on public.rental_order
  for each row execute function public.rental_random_ref();

-- 9c. Helper: create a rental order and retry if two requests picked the same code
--    at the same moment. The UNIQUE constraint on rental_ref is the final guard:
--    the loser gets a unique_violation, and we simply draw a new code.
create or replace function public._new_rental_order(
  p_customer bigint, p_type text, p_booking_id bigint default null,
  p_pickup timestamptz default null, p_return timestamptz default null,
  p_id_type text default null, p_id_path text default null
) returns public.rental_order
language plpgsql set search_path = public as $$
declare v_order public.rental_order; v_try int; v_constraint text;
begin
  for v_try in 1..5 loop
    begin
      insert into public.rental_order (customer_id, rental_type, booking_id, pickup_date, return_date, id_type, id_image_path)
      values (p_customer, p_type, p_booking_id, p_pickup, p_return, p_id_type, p_id_path)
      returning * into v_order;
      return v_order;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'rental_order_rental_ref_key' then raise; end if;
    end;
  end loop;
  raise exception 'Could not create a reference number. Please try again.';
end $$;

-- Book a studio
create or replace function public.create_booking(
  p_studio_id bigint, p_start_at timestamptz, p_end_at timestamptz,
  p_payment_method text, p_gcash_reference text default null, p_items jsonb default '[]'::jsonb
) returns table (out_ref text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_customer bigint; v_studio public.studio_room; v_booking public.booking;
  v_order public.rental_order; v_total numeric; v_try int; v_constraint text;
begin
  select customer_id into v_customer from public.customer
   where auth_user_id = auth.uid() and status = 'Active';
  if v_customer is null then raise exception 'Please log in to book.'; end if;

  perform public._check_slot(p_start_at, p_end_at);
  if p_payment_method = 'GCash' and length(trim(coalesce(p_gcash_reference, ''))) < 6 then
    raise exception 'Enter your GCash reference number.';
  end if;

  select * into v_studio from public.studio_room where studio_id = p_studio_id;
  if not found or v_studio.status <> 'Available' then raise exception 'That studio is not available.'; end if;

  -- booking_ref is filled by its DEFAULT (random_ref). Retry only if the code collided.
  for v_try in 1..5 loop
    begin
      insert into public.booking (customer_id, studio_id, start_at, end_at, hourly_rate_at_booking)
      values (v_customer, p_studio_id, p_start_at, p_end_at, v_studio.hourly_rate)
      returning * into v_booking;
      exit;
    exception
      when exclusion_violation then
        raise exception 'That time was just taken. Please pick another slot.';
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint is distinct from 'booking_booking_ref_key' then raise; end if;
        if v_try = 5 then raise exception 'Could not create a reference number. Please try again.'; end if;
    end;
  end loop;

  v_total := v_studio.hourly_rate * extract(epoch from (p_end_at - p_start_at)) / 3600;

  if jsonb_array_length(p_items) > 0 then
    v_order := public._new_rental_order(v_customer, 'Add-on', v_booking.booking_id);
    v_total := v_total + public._add_rental_items(v_order.rental_order_id, 'Add-on', p_items, 1);
  end if;

  insert into public.payment (booking_id, payment_type, method, gcash_reference, amount)
  values (v_booking.booking_id, 'Full Payment', p_payment_method, nullif(trim(p_gcash_reference), ''), v_total);

  return query select v_booking.booking_ref::text, v_total;
exception when unique_violation then
  raise exception 'That GCash reference was already used.';
end $$;

-- 10. Request an equipment rental (Add-on to a booking, or Outside)
create or replace function public.request_rental(
  p_type text, p_items jsonb, p_booking_ref text default null,
  p_pickup timestamptz default null, p_return timestamptz default null,
  p_id_type text default null, p_id_path text default null, p_backup text default null,
  p_payment_method text default 'GCash', p_gcash_reference text default null
) returns table (out_ref text, out_total numeric)
language plpgsql security definer set search_path = public as $$
declare
  v_customer bigint; v_booking public.booking; v_order public.rental_order;
  v_days int := 1; v_total numeric;
begin
  select customer_id into v_customer from public.customer
   where auth_user_id = auth.uid() and status = 'Active';
  if v_customer is null then raise exception 'Please log in.'; end if;
  if p_payment_method = 'GCash' and length(trim(coalesce(p_gcash_reference, ''))) < 6 then
    raise exception 'Enter your GCash reference number.';
  end if;

  if p_type = 'Add-on' then
    select * into v_booking from public.booking
     where booking_ref = upper(trim(p_booking_ref)) and customer_id = v_customer;
    if not found then raise exception 'Booking not found.'; end if;
    if v_booking.status not in ('Pending', 'Approved', 'In Progress') then
      raise exception 'Add-ons need an active booking.';
    end if;
    v_order := public._new_rental_order(v_customer, 'Add-on', v_booking.booking_id);

  else  -- Outside
    if p_pickup is null or p_return is null or p_return - p_pickup < interval '8 hours' then
      raise exception 'Outside rentals are at least 8 hours.';
    end if;
    if p_id_type is null or p_id_path is null or p_id_path not like auth.uid()::text || '/%' then
      raise exception 'Attach a photo of your valid ID.';
    end if;
    v_days := greatest(1, ceil(extract(epoch from (p_return - p_pickup)) / 86400));
    if nullif(trim(p_backup), '') is not null then
      update public.customer set backup_number = trim(p_backup) where customer_id = v_customer;
    end if;
    v_order := public._new_rental_order(v_customer, 'Outside', null, p_pickup, p_return, p_id_type, p_id_path);
  end if;

  v_total := public._add_rental_items(v_order.rental_order_id, p_type, p_items, v_days);

  insert into public.payment (rental_order_id, payment_type, method, gcash_reference, amount)
  values (v_order.rental_order_id, 'Full Payment', p_payment_method, nullif(trim(p_gcash_reference), ''), v_total);

  return query select v_order.rental_ref::text, v_total;
exception when unique_violation then
  raise exception 'That GCash reference was already used, or an item was listed twice.';
end $$;

-- 11. Reschedule and cancel (customers only, own bookings, until 24 hours before)
create or replace function public.reschedule_booking(p_booking_ref text, p_start_at timestamptz, p_end_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare v_booking public.booking;
begin
  select b.* into v_booking from public.booking b
    join public.customer c on c.customer_id = b.customer_id
   where b.booking_ref = upper(trim(p_booking_ref)) and c.auth_user_id = auth.uid();
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.status not in ('Pending', 'Approved') then raise exception 'This booking cannot be changed.'; end if;
  if now() > v_booking.start_at - interval '24 hours' then
    raise exception 'Changes and cancellations close 24 hours before your session.';
  end if;

  perform public._check_slot(p_start_at, p_end_at);
  begin
    update public.booking set start_at = p_start_at, end_at = p_end_at where booking_id = v_booking.booking_id;
  exception when exclusion_violation then
    raise exception 'That time was just taken. Please pick another slot.';
  end;
end $$;

create or replace function public.cancel_booking(p_booking_ref text)
returns void language plpgsql security definer set search_path = public as $$
declare v_booking public.booking;
begin
  select b.* into v_booking from public.booking b
    join public.customer c on c.customer_id = b.customer_id
   where b.booking_ref = upper(trim(p_booking_ref)) and c.auth_user_id = auth.uid();
  if not found then raise exception 'Booking not found.'; end if;
  if v_booking.status not in ('Pending', 'Approved') then raise exception 'This booking cannot be cancelled.'; end if;
  if now() > v_booking.start_at - interval '24 hours' then
    raise exception 'Changes and cancellations close 24 hours before your session.';
  end if;

  update public.booking set status = 'Cancelled' where booking_id = v_booking.booking_id;
end $$;

-- 12. Guest access: permissions and reference-code lookups. (Row Level Security still decides which rows each person can see)
grant usage on schema public to anon, authenticated;

grant select on public.studio_room, public.equipment_category, public.equipment to anon, authenticated;
grant select on public.customer, public.booking, public.rental_order, public.rental_details, public.payment to authenticated;
grant update (first_name, last_name, number, backup_number) on public.customer to authenticated;

grant execute on function public.get_busy_slots(bigint, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.get_equipment_in_use() to anon, authenticated;

-- Look up ONE booking by its reference code (no customer name or phone is returned).
--    References are random (TOD-9F3A21C7), so the code itself works like a private key.
create or replace function public.lookup_booking(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  r record; v_hours numeric; v_studio numeric; v_addons jsonb; v_addons_total numeric;
begin
  select b.booking_id, b.booking_ref, b.status, b.start_at, b.end_at, b.hourly_rate_at_booking,
         s.name as studio_name, s.description as studio_desc,
         (select p.status from public.payment p where p.booking_id = b.booking_id
           order by p.payment_id desc limit 1) as payment_status
    into r
  from public.booking b
  join public.studio_room s on s.studio_id = b.studio_id
  where b.booking_ref = upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g'));

  if not found then return null; end if;

  v_hours  := extract(epoch from (r.end_at - r.start_at)) / 3600;
  v_studio := r.hourly_rate_at_booking * v_hours;

  select coalesce(jsonb_agg(jsonb_build_object(
           'equipment', e.name, 'quantity', d.quantity,
           'price', d.unit_price_at_request * d.quantity, 'status', o.status) order by e.name), '[]'::jsonb),
         coalesce(sum(d.unit_price_at_request * d.quantity), 0)
    into v_addons, v_addons_total
  from public.rental_order o
  join public.rental_details d on d.rental_order_id = o.rental_order_id
  join public.equipment e on e.equipment_id = d.equipment_id
  where o.booking_id = r.booking_id and o.rental_type = 'Add-on'
    and o.status not in ('Rejected', 'Cancelled');

  return jsonb_build_object(
    'booking_ref', r.booking_ref, 'status', r.status,
    'start_at', r.start_at, 'end_at', r.end_at,
    'studio', r.studio_name, 'studio_description', r.studio_desc,
    'studio_total', v_studio, 'addons', v_addons, 'addons_total', v_addons_total,
    'grand_total', v_studio + v_addons_total,
    'payment_status', r.payment_status);
end $$;

-- Look up rentals by a rental reference (OUT-... / RA-...) or by the booking reference
--    the add-on equipment is attached to. Returns one row per item, or null.
create or replace function public.lookup_rental(p_ref text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ref text := upper(regexp_replace(coalesce(p_ref, ''), '\s', '', 'g'));
  v_result jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'rental_ref', o.rental_ref,
           'booking_ref', b.booking_ref,
           'rental_type', o.rental_type,
           'equipment', e.name,
           'quantity', d.quantity,
           'start_at', case when o.rental_type = 'Outside' then o.pickup_date else b.start_at end,
           'return_by', case when o.rental_type = 'Outside' then o.return_date else b.end_at end,
           'status', o.status,
           'rejection_reason', o.rejection_reason
         ) order by o.rental_order_id, e.name), '[]'::jsonb)
    into v_result
  from public.rental_order o
  join public.rental_details d on d.rental_order_id = o.rental_order_id
  join public.equipment e on e.equipment_id = d.equipment_id
  left join public.booking b on b.booking_id = o.booking_id
  where o.rental_ref = v_ref or b.booking_ref = v_ref;

  if jsonb_array_length(v_result) = 0 then return null; end if;
  return v_result;
end $$;

revoke all on function public.lookup_booking(text) from public;
revoke all on function public.lookup_rental(text) from public;
grant execute on function public.lookup_booking(text) to anon, authenticated;
grant execute on function public.lookup_rental(text) to anon, authenticated;

-- =========================================================
-- OPTIONAL: sample data so the pages are not empty. Edit freely.
-- =========================================================
insert into public.studio_room (name, description, capacity, hourly_rate) values
  ('Studio A', 'Drum and full band room', 8, 350),
  ('Studio B', 'Vocal and acoustic booth', 3, 250),
  ('Studio C', 'Mid-size band room', 6, 300),
  ('Studio D', 'Production room', 4, 280)
on conflict (name) do nothing;

insert into public.equipment_category (category_name) values
  ('Guitars'), ('Amplifiers'), ('Drums'), ('Keyboards'), ('Effects')
on conflict (category_name) do nothing;

-- Standard items: price per session (add-on) or per day (outside)
insert into public.equipment (name, category_id, pricing_type, total_quantity, add_on_rate, outside_rate, allow_outside)
select v.name, c.category_id, 'Standard', v.qty, v.addon, v.outside, true
from (values
  ('Electric guitar',   'Guitars',    4, 100, 250),
  ('Guitar amplifier',  'Amplifiers', 4, 150, 350),
  ('Keyboard',          'Keyboards',  1, 200, 500),
  ('Multi-effects pedal','Effects',   3,  80, 150)
) as v(name, cat, qty, addon, outside)
join public.equipment_category c on c.category_name = v.cat
on conflict (name) do nothing;

-- Flat items (drum sets): one price per rental, always 8 hours
insert into public.equipment (name, category_id, pricing_type, total_quantity, add_on_rate, outside_rate, allow_outside)
select v.name, c.category_id, 'Flat', 1, v.price, v.price, true
from (values
  ('Set A Drum Set', 2700), ('Set B Drum Set', 3000), ('Set C Drum Set', 2500), ('Set D Drum Set', 2800)
) as v(name, price)
join public.equipment_category c on c.category_name = 'Drums'
on conflict (name) do nothing;
