package com.example.cinema.modules.booking.data;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

interface BookingSeatJpaRepository extends JpaRepository<BookingSeatEntity, UUID> {

    @Query("select s.seatId from BookingSeatEntity s where s.showtimeId = :showtimeId and s.releasedAt is null")
    List<UUID> findBookedSeatIds(UUID showtimeId);

    List<BookingSeatEntity> findAllByBookingId(UUID bookingId);

    boolean existsByShowtimeIdAndSeatIdAndReleasedAtIsNull(UUID showtimeId, UUID seatId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update BookingSeatEntity s set s.releasedAt = :releasedAt where s.bookingId = :bookingId and s.releasedAt is null")
    int releaseSeatsByBookingId(UUID bookingId, Instant releasedAt);

    void deleteAllByBookingId(UUID bookingId);
}
