-- 1. Booking Exclusion Constraint (Prevents double bookings for active slots)
ALTER TABLE booking ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
    studio_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('Pending', 'Approved', 'In Progress'));

-- 2. Partial Unique Index on GCash References (Allows re-use only if earlier payment was Rejected)
CREATE UNIQUE INDEX idx_payment_gcash_ref_unique 
ON payment (gcash_reference) 
WHERE method = 'GCash' AND status != 'Rejected' AND gcash_reference IS NOT NULL;

-- 3. Performance Indexes on Foreign Keys and Filtered Columns
CREATE INDEX idx_booking_customer      ON booking(customer_id);
CREATE INDEX idx_booking_studio_dates  ON booking(studio_id, start_at, end_at);
CREATE INDEX idx_payment_booking       ON payment(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_payment_rental        ON payment(rental_order_id) WHERE rental_order_id IS NOT NULL;
CREATE INDEX idx_rental_order_customer ON rental_order(customer_id);
CREATE INDEX idx_rental_order_booking  ON rental_order(booking_id) WHERE booking_id IS NOT NULL;