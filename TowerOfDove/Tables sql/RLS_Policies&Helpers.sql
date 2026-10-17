-- 1. Enable RLS on all tables
ALTER TABLE staff_profile      ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer           ENABLE ROW LEVEL SECURITY;
ALTER TABLE studio_room        ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_category ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment          ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_order       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_details     ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment            ENABLE ROW LEVEL SECURITY;

-- 2. Helper Function: Check if current authenticated user is Staff or Owner
CREATE OR REPLACE FUNCTION is_staff_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM staff_profile
        WHERE auth_user_id = auth.uid()
          AND status = 'Active'
          AND role IN ('Owner', 'Staff')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Public Read Policies for Catalog Tables
CREATE POLICY "Public can view studio rooms"          ON studio_room        FOR SELECT USING (true);
CREATE POLICY "Public can view equipment categories" ON equipment_category FOR SELECT USING (true);
CREATE POLICY "Public can view equipment"          ON equipment         FOR SELECT USING (true);

-- 4. Customer Access Policies
CREATE POLICY "Customers can view their own profile" ON customer
    FOR SELECT USING (auth_user_id = auth.uid() OR is_staff_or_owner());

CREATE POLICY "Customers can update their own profile" ON customer
    FOR UPDATE USING (auth_user_id = auth.uid());

CREATE POLICY "Customers can view their own bookings" ON booking
    FOR SELECT USING (
        customer_id IN (SELECT customer_id FROM customer WHERE auth_user_id = auth.uid()) 
        OR is_staff_or_owner()
    );

CREATE POLICY "Customers can view their own rental orders" ON rental_order
    FOR SELECT USING (
        customer_id IN (SELECT customer_id FROM customer WHERE auth_user_id = auth.uid()) 
        OR is_staff_or_owner()
    );

-- 5. Staff and Owner Management Policies
CREATE POLICY "Staff and Owner full access on staff_profile" ON staff_profile
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage studio_room" ON studio_room
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage equipment" ON equipment
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage bookings" ON booking
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage rental_order" ON rental_order
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage rental_details" ON rental_details
    FOR ALL USING (is_staff_or_owner());

CREATE POLICY "Staff and Owner manage payments" ON payment
    FOR ALL USING (is_staff_or_owner());