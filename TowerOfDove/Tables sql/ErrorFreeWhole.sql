-- 1. TIMEZONE & EXTENSIONS
SET timezone = 'Asia/Manila';
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA extensions;

-- 2. TABLE CREATION
CREATE TABLE staff_profile (
    user_id       BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_user_id  UUID          NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
    first_name    VARCHAR(100)  NOT NULL,
    last_name     VARCHAR(100)  NOT NULL,
    number        VARCHAR(20)   NULL,
    role          VARCHAR(20)   NOT NULL CHECK (role IN ('Owner', 'Staff')),
    status        VARCHAR(20)   NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE customer (
    customer_id    BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    auth_user_id   UUID          NULL UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    first_name     VARCHAR(100)  NOT NULL,
    last_name      VARCHAR(100)  NOT NULL,
    number         VARCHAR(20)   NOT NULL,
    backup_number  VARCHAR(20)   NULL,
    status         VARCHAR(20)   NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE studio_room (
    studio_id    BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         VARCHAR(100)   NOT NULL UNIQUE,
    image        TEXT           NULL,
    description  TEXT           NULL,
    capacity     INTEGER        NOT NULL CHECK (capacity > 0),
    hourly_rate  NUMERIC(10,2)  NOT NULL CHECK (hourly_rate >= 0),
    status       VARCHAR(20)    NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Occupied', 'Unavailable', 'Maintenance')),
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TABLE equipment_category (
    category_id    BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name  VARCHAR(100)  NOT NULL UNIQUE
);

CREATE TABLE equipment (
    equipment_id    BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            VARCHAR(150)   NOT NULL UNIQUE,
    image           TEXT           NULL,
    category_id     BIGINT         NOT NULL REFERENCES equipment_category(category_id) ON DELETE RESTRICT,
    description     TEXT           NULL,
    pricing_type    VARCHAR(20)    NOT NULL DEFAULT 'Standard' CHECK (pricing_type IN ('Standard', 'Flat')),
    total_quantity  INTEGER        NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
    add_on_rate     NUMERIC(10,2)  NULL CHECK (add_on_rate IS NULL OR add_on_rate >= 0),
    outside_rate    NUMERIC(10,2)  NULL CHECK (outside_rate IS NULL OR outside_rate >= 0),
    allow_addon     BOOLEAN        NOT NULL DEFAULT TRUE,
    allow_outside   BOOLEAN        NOT NULL DEFAULT FALSE,
    status          VARCHAR(20)    NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Unavailable')),
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_addon_rate CHECK (
        (allow_addon = TRUE AND add_on_rate IS NOT NULL) OR 
        (allow_addon = FALSE AND add_on_rate IS NULL)
    ),
    CONSTRAINT chk_outside_rate CHECK (
        (allow_outside = TRUE AND outside_rate IS NOT NULL) OR 
        (allow_outside = FALSE AND outside_rate IS NULL)
    )
);

CREATE TABLE booking (
    booking_id              BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_ref             VARCHAR(30)    NOT NULL UNIQUE,
    customer_id             BIGINT         NOT NULL REFERENCES customer(customer_id) ON DELETE RESTRICT,
    studio_id               BIGINT         NOT NULL REFERENCES studio_room(studio_id) ON DELETE RESTRICT,
    start_at                TIMESTAMPTZ    NOT NULL,
    end_at                  TIMESTAMPTZ    NOT NULL,
    actual_start_at         TIMESTAMPTZ    NULL,
    actual_end_at           TIMESTAMPTZ    NULL,
    hourly_rate_at_booking  NUMERIC(10,2)  NOT NULL CHECK (hourly_rate_at_booking >= 0),
    status                  VARCHAR(20)    NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'In Progress', 'Completed', 'Rejected', 'Cancelled')),
    approved_by             BIGINT         NULL REFERENCES staff_profile(user_id) ON DELETE RESTRICT,
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_booking_duration CHECK (
        end_at > start_at AND 
        end_at <= start_at + INTERVAL '4 hours' AND 
        end_at >= start_at + INTERVAL '1 hour'
    )
);

CREATE TABLE rental_order (
    rental_order_id   BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rental_ref        VARCHAR(30)  NOT NULL UNIQUE,
    customer_id       BIGINT       NOT NULL REFERENCES customer(customer_id) ON DELETE RESTRICT,
    rental_type       VARCHAR(20)  NOT NULL CHECK (rental_type IN ('Add-on', 'Outside')),
    booking_id        BIGINT       NULL REFERENCES booking(booking_id) ON DELETE RESTRICT,
    status            VARCHAR(20)  NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Active', 'Returned', 'Cancelled')),
    approved_by       BIGINT       NULL REFERENCES staff_profile(user_id) ON DELETE RESTRICT,
    pickup_date       TIMESTAMPTZ  NULL,
    return_date       TIMESTAMPTZ  NULL,
    id_type           VARCHAR(50)  NULL,
    id_image_path     TEXT         NULL,
    rejection_reason  TEXT         NULL,
    issued_at         TIMESTAMPTZ  NULL,
    returned_at       TIMESTAMPTZ  NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rental_type_link CHECK (
        (rental_type = 'Add-on' AND booking_id IS NOT NULL) OR 
        (rental_type = 'Outside' AND booking_id IS NULL)
    ),
    CONSTRAINT chk_rental_dates CHECK (
        return_date IS NULL OR pickup_date IS NULL OR return_date > pickup_date
    ),
    CONSTRAINT chk_rental_rejection CHECK (
        status != 'Rejected' OR (rejection_reason IS NOT NULL AND length(trim(rejection_reason)) > 0)
    )
);

CREATE TABLE rental_details (
    rental_detail_id       BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rental_order_id        BIGINT         NOT NULL REFERENCES rental_order(rental_order_id) ON DELETE CASCADE,
    equipment_id           BIGINT         NOT NULL REFERENCES equipment(equipment_id) ON DELETE RESTRICT,
    quantity               INTEGER        NOT NULL CHECK (quantity > 0),
    unit_price_at_request  NUMERIC(10,2)  NOT NULL CHECK (unit_price_at_request >= 0),
    rental_hours           NUMERIC(6,2)   NULL CHECK (rental_hours IS NULL OR (rental_hours >= 1 AND rental_hours <= 8)),
    CONSTRAINT uq_order_equipment UNIQUE (rental_order_id, equipment_id)
);

CREATE TABLE payment (
    payment_id        BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    booking_id        BIGINT         NULL REFERENCES booking(booking_id) ON DELETE RESTRICT,
    rental_order_id   BIGINT         NULL REFERENCES rental_order(rental_order_id) ON DELETE RESTRICT,
    payment_type      VARCHAR(20)    NOT NULL CHECK (payment_type IN ('Downpayment', 'Balance', 'Full Payment')),
    method            VARCHAR(10)    NOT NULL CHECK (method IN ('GCash', 'Cash')),
    gcash_reference   VARCHAR(50)    NULL,
    amount            NUMERIC(10,2)  NOT NULL CHECK (amount > 0),
    status            VARCHAR(20)    NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Verified', 'Rejected')),
    rejected_reason   TEXT           NULL,
    verified_by       BIGINT         NULL REFERENCES staff_profile(user_id) ON DELETE RESTRICT,
    verified_at       TIMESTAMPTZ    NULL,
    created_at        TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_payment_parent CHECK (
        num_nonnulls(booking_id, rental_order_id) = 1
    ),
    CONSTRAINT chk_gcash_ref_required CHECK (
        method != 'GCash' OR gcash_reference IS NOT NULL
    ),
    CONSTRAINT chk_payment_status_rules CHECK (
        (status = 'Pending'  AND verified_by IS NULL     AND verified_at IS NULL     AND rejected_reason IS NULL) OR
        (status = 'Verified' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejected_reason IS NULL) OR
        (status = 'Rejected' AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND rejected_reason IS NOT NULL AND length(trim(rejected_reason)) > 0)
    )
);

-- 3. CONSTRAINTS & INDEXES
ALTER TABLE booking ADD CONSTRAINT no_overlapping_bookings
EXCLUDE USING gist (
    studio_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
) WHERE (status IN ('Pending', 'Approved', 'In Progress'));

CREATE UNIQUE INDEX idx_payment_gcash_ref_unique 
ON payment (gcash_reference) 
WHERE method = 'GCash' AND status != 'Rejected' AND gcash_reference IS NOT NULL;

CREATE INDEX idx_booking_customer      ON booking(customer_id);
CREATE INDEX idx_booking_studio_dates  ON booking(studio_id, start_at, end_at);
CREATE INDEX idx_payment_booking       ON payment(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX idx_payment_rental        ON payment(rental_order_id) WHERE rental_order_id IS NOT NULL;
CREATE INDEX idx_rental_order_customer ON rental_order(customer_id);
CREATE INDEX idx_rental_order_booking  ON rental_order(booking_id) WHERE booking_id IS NOT NULL;

-- 4. FUNCTIONS & TRIGGERS
CREATE OR REPLACE FUNCTION validate_rental_details_hours()
RETURNS TRIGGER 
SET search_path = public
AS $$
DECLARE
    v_pricing_type VARCHAR(20);
BEGIN
    SELECT pricing_type INTO v_pricing_type
    FROM equipment
    WHERE equipment_id = NEW.equipment_id;

    IF v_pricing_type = 'Flat' THEN
        IF NEW.rental_hours IS NULL OR NEW.rental_hours < 1 OR NEW.rental_hours > 8 THEN
            RAISE EXCEPTION 'Equipment with Flat pricing requires rental_hours to be between 1 and 8.';
        END IF;
    ELSIF v_pricing_type = 'Standard' THEN
        IF NEW.rental_hours IS NOT NULL THEN
            RAISE EXCEPTION 'Equipment with Standard pricing must have NULL rental_hours.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_rental_details_hours
BEFORE INSERT OR UPDATE ON rental_details
FOR EACH ROW EXECUTE FUNCTION validate_rental_details_hours();

-- 5. ROW LEVEL SECURITY (RLS) & POLICIES
ALTER TABLE staff_profile      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer           ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_room        ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_order       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_details     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment            ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION is_staff_or_owner()
RETURNS BOOLEAN 
SET search_path = public
SECURITY DEFINER
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM staff_profile
        WHERE auth_user_id = auth.uid()
          AND status = 'Active'
          AND role IN ('Owner', 'Staff')
    );
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION is_staff_or_owner() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION is_staff_or_owner() TO service_role;

CREATE POLICY "Public view studio rooms"          ON studio_room        FOR SELECT USING (true);
CREATE POLICY "Public view equipment categories" ON equipment_category FOR SELECT USING (true);
CREATE POLICY "Public view equipment"          ON equipment         FOR SELECT USING (true);

CREATE POLICY "Customers view profile" ON customer
    FOR SELECT USING (auth_user_id = auth.uid() OR is_staff_or_owner());

CREATE POLICY "Customers update profile" ON customer
    FOR UPDATE USING (auth_user_id = auth.uid());

CREATE POLICY "Customers view bookings" ON booking
    FOR SELECT USING (
        customer_id IN (SELECT customer_id FROM customer WHERE auth_user_id = auth.uid()) 
        OR is_staff_or_owner()
    );

CREATE POLICY "Customers view rental orders" ON rental_order
    FOR SELECT USING (
        customer_id IN (SELECT customer_id FROM customer WHERE auth_user_id = auth.uid()) 
        OR is_staff_or_owner()
    );

CREATE POLICY "Staff manage staff_profile" ON staff_profile   FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage studio_room"   ON studio_room     FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage equipment"     ON equipment       FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage bookings"      ON booking         FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage rental_order"  ON rental_order    FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage rental_details" ON rental_details  FOR ALL USING (is_staff_or_owner());
CREATE POLICY "Staff manage payments"      ON payment         FOR ALL USING (is_staff_or_owner());