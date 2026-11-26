package com.example.cinema.modules.booking.data;

import com.example.cinema.modules.booking.business.BookingStatus;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

interface BookingJpaRepository extends JpaRepository<BookingEntity, UUID> {
    boolean existsByShowtimeId(UUID showtimeId);
    boolean existsByShowtimeIdAndStatus(UUID showtimeId, BookingStatus status);
    Optional<BookingEntity> findByIdAndUserId(UUID bookingId, UUID userId);
    List<BookingEntity> findAllByUserIdOrderByCreatedAtDesc(UUID userId);
}

