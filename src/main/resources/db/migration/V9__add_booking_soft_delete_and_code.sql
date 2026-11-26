-- 1. Bổ sung cột booking_code, status và cancelled_at vào bảng bookings
ALTER TABLE bookings
    ADD COLUMN booking_code VARCHAR(20),
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
    ADD COLUMN cancelled_at TIMESTAMPTZ NULL;

-- Cập nhật booking_code cho các bản ghi hiện hữu (nếu có) trước khi đặt NOT NULL & UNIQUE
UPDATE bookings
SET booking_code = 'BK-' || UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 12))
WHERE booking_code IS NULL;

ALTER TABLE bookings
    ALTER COLUMN booking_code SET NOT NULL,
    ADD CONSTRAINT uq_bookings_booking_code UNIQUE (booking_code),
    ADD CONSTRAINT chk_bookings_status CHECK (status IN ('CONFIRMED', 'CANCELLED'));

-- 2. Bổ sung cột released_at vào bảng booking_seats
ALTER TABLE booking_seats
    ADD COLUMN released_at TIMESTAMPTZ NULL;

-- 3. Gỡ bỏ unique constraint tĩnh cũ và thay bằng Partial Unique Index cho ghế đang active
ALTER TABLE booking_seats
    DROP CONSTRAINT IF EXISTS uq_booking_seat_per_showtime;

CREATE UNIQUE INDEX uq_active_booking_seat
    ON booking_seats (showtime_id, seat_id)
    WHERE released_at IS NULL;
