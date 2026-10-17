-- Set session time zone to Asia/Manila
SET timezone = 'Asia/Manila';

-- Enable btree_gist extension for range exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

--all tables should be enabled with row level security
-- 1. staff_profile Table (Formerly "user")
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

-- 2. customer Table
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

-- 3. studio_room Table
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

-- 4. equipment_category Table
CREATE TABLE equipment_category (
    category_id    BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category_name  VARCHAR(100)  NOT NULL UNIQUE
);

-- 5. equipment Table
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

-- 6. booking Table
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

-- 7. rental_order Table
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

-- 8. rental_details Table (Uses CASCADE for dependent line items)
CREATE TABLE rental_details (
    rental_detail_id       BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rental_order_id        BIGINT         NOT NULL REFERENCES rental_order(rental_order_id) ON DELETE CASCADE,
    equipment_id           BIGINT         NOT NULL REFERENCES equipment(equipment_id) ON DELETE RESTRICT,
    quantity               INTEGER        NOT NULL CHECK (quantity > 0),
    unit_price_at_request  NUMERIC(10,2)  NOT NULL CHECK (unit_price_at_request >= 0),
    rental_hours           NUMERIC(6,2)   NULL CHECK (rental_hours IS NULL OR (rental_hours >= 1 AND rental_hours <= 8)),
    CONSTRAINT uq_order_equipment UNIQUE (rental_order_id, equipment_id)
);

-- 9. payment Table
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