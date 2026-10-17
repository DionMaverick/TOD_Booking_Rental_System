-- Trigger: Validate rental_hours according to equipment pricing_type
CREATE OR REPLACE FUNCTION validate_rental_details_hours()
RETURNS TRIGGER AS $$
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