package com.example.cinema.modules.booking.business;

import java.util.HashSet;
import java.util.Optional;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public interface BookingRepository {
    Booking save(Booking booking);
    Optional<Booking> findById(UUID bookingId);
    Optional<Booking> findByIdAndUserId(UUID bookingId, UUID userId);
    List<Booking> findAllByUserId(UUID userId);
    boolean existsByShowtimeIdAndSeatId(UUID showtimeId, UUID seatId);
    boolean existsConfirmedByShowtimeId(UUID showtimeId);
    List<UUID> findBookedSeatIds(UUID showtimeId);
    default Set<UUID> findBookedSeatIdSet(UUID showtimeId) {
        return new HashSet<>(findBookedSeatIds(showtimeId));
    }
    void deleteById(UUID bookingId);
}
