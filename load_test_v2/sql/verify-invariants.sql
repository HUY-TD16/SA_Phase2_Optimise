-- Schema-adaptive PostgreSQL integrity check (works on both Phase 1 V1-V8 and Phase 2 V9+ Soft Delete)
DO $$
DECLARE
    has_soft boolean;
    dup_seats bigint := 0;
    bad_showtime_bookings bigint := 0;
    orphan_seats bigint := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='booking_seats' AND column_name='released_at'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='status'
    ) INTO has_soft;

    IF has_soft THEN
        EXECUTE 'SELECT count(*) FROM (SELECT showtime_id, seat_id FROM booking_seats WHERE released_at IS NULL GROUP BY 1,2 HAVING count(*)>1) d' INTO dup_seats;
        EXECUTE 'SELECT count(*) FROM bookings b JOIN showtimes s ON s.id=b.showtime_id WHERE b.status=''CONFIRMED'' AND s.status=''CANCELLED''' INTO bad_showtime_bookings;
        EXECUTE 'SELECT count(*) FROM bookings b JOIN booking_seats bs ON bs.booking_id=b.id WHERE b.status=''CANCELLED'' AND bs.released_at IS NULL' INTO orphan_seats;
    ELSE
        EXECUTE 'SELECT count(*) FROM (SELECT showtime_id, seat_id FROM booking_seats GROUP BY 1,2 HAVING count(*)>1) d' INTO dup_seats;
        EXECUTE 'SELECT count(*) FROM bookings b JOIN showtimes s ON s.id=b.showtime_id WHERE s.status=''CANCELLED''' INTO bad_showtime_bookings;
    END IF;

    RAISE NOTICE 'INVARIANT_JSON=%', jsonb_build_object(
        'schemaHasSoftDelete', has_soft,
        'duplicateActiveSeats', dup_seats,
        'bookingsOnCancelledShowtimes', bad_showtime_bookings,
        'unreleasedSeatsOnCancelledBookings', orphan_seats,
        'allInvariantsPassed', (dup_seats = 0 AND bad_showtime_bookings = 0 AND orphan_seats = 0)
    )::text;

    IF dup_seats > 0 OR bad_showtime_bookings > 0 OR orphan_seats > 0 THEN
        RAISE EXCEPTION 'Invariant violation: dup_seats=%, bad_showtime=%, orphan=%', dup_seats, bad_showtime_bookings, orphan_seats;
    END IF;
END $$;
