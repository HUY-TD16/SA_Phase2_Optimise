package com.example.cinema.modules.booking.data;

import com.example.cinema.modules.booking.business.Booking;
import com.example.cinema.modules.booking.business.BookingRepository;
import com.example.cinema.modules.booking.business.BookingStatus;
import com.example.cinema.modules.booking.business.bookingSeat;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@ConditionalOnProperty(name = "cinema.booking.enabled", havingValue = "true", matchIfMissing = true)
class BookingRepositoryAdapter implements BookingRepository {

    private final BookingJpaRepository bookingJpaRepository;
    private final BookingSeatJpaRepository bookingSeatJpaRepository;

    BookingRepositoryAdapter(
            BookingJpaRepository bookingJpaRepository,
            BookingSeatJpaRepository bookingSeatJpaRepository
    ) {
        this.bookingJpaRepository = bookingJpaRepository;
        this.bookingSeatJpaRepository = bookingSeatJpaRepository;
    }

    @Override
    public Booking save(Booking booking) {
        bookingJpaRepository.save(new BookingEntity(
                booking.getBookingId(),
                booking.getBookingCode(),
                booking.getUserId(),
                booking.getShowtimeId(),
                booking.getTotalAmount(),
                booking.getCreatedAt(),
                booking.getPaymentStatus(),
                booking.getStatus(),
                booking.getCancelledAt()));

        List<BookingSeatEntity> seatEntities = booking.getSeats().stream()
                .map(seat -> new BookingSeatEntity(
                        UUID.randomUUID(),
                        booking.getBookingId(),
                        booking.getShowtimeId(),
                        seat.getSeatId(),
                        seat.getPrice(),
                        seat.getReleasedAt()))
                .toList();
        bookingSeatJpaRepository.saveAll(seatEntities);
        return booking;
    }

    @Override
    public Optional<Booking> findById(UUID bookingId) {
        return bookingJpaRepository.findById(bookingId).map(this::toBooking);
    }

    @Override
    public Optional<Booking> findByIdAndUserId(UUID bookingId, UUID userId) {
        return bookingJpaRepository.findByIdAndUserId(bookingId, userId).map(this::toBooking);
    }

    @Override
    public Optional<Booking> findByIdAndUserIdForUpdate(UUID bookingId, UUID userId) {
        return bookingJpaRepository.findByIdAndUserIdForUpdate(bookingId, userId).map(this::toBooking);
    }

    @Override
    public List<Booking> findAllByUserId(UUID userId) {
        return bookingJpaRepository.findAllByUserIdOrderByCreatedAtDesc(userId).stream()
                .map(this::toBooking)
                .toList();
    }

    @Override
    public boolean existsByShowtimeIdAndSeatId(UUID showtimeId, UUID seatId) {
        return bookingSeatJpaRepository.existsByShowtimeIdAndSeatIdAndReleasedAtIsNull(showtimeId, seatId);
    }

    @Override
    @Transactional
    public Booking cancel(Booking booking, Instant cancelledAt) {
        Booking cancelled = booking.cancel(cancelledAt);
        bookingJpaRepository.save(new BookingEntity(
                cancelled.getBookingId(),
                cancelled.getBookingCode(),
                cancelled.getUserId(),
                cancelled.getShowtimeId(),
                cancelled.getTotalAmount(),
                cancelled.getCreatedAt(),
                cancelled.getPaymentStatus(),
                cancelled.getStatus(),
                cancelled.getCancelledAt()));
        bookingSeatJpaRepository.releaseSeatsByBookingId(cancelled.getBookingId(), cancelledAt);
        return cancelled;
    }

    @Override
    @Transactional
    public void deleteById(UUID bookingId) {
        bookingSeatJpaRepository.deleteAllByBookingId(bookingId);
        bookingJpaRepository.deleteById(bookingId);
    }

    @Override
    public boolean existsConfirmedByShowtimeId(UUID showtimeId) {
        return bookingJpaRepository.existsByShowtimeIdAndStatus(showtimeId, BookingStatus.CONFIRMED);
    }

    @Override
    public List<UUID> findBookedSeatIds(UUID showtimeId) {
        return bookingSeatJpaRepository.findBookedSeatIds(showtimeId);
    }

    private Booking toBooking(BookingEntity entity) {
        List<bookingSeat> seats = bookingSeatJpaRepository.findAllByBookingId(entity.getId()).stream()
                .map(seat -> new bookingSeat(seat.getSeatId(), seat.getPrice(), seat.getReleasedAt()))
                .toList();
        return new Booking(
                entity.getId(),
                entity.getBookingCode(),
                entity.getUserId(),
                entity.getShowtimeId(),
                seats,
                entity.getTotalAmount(),
                entity.getCreatedAt(),
                entity.getPaymentStatus(),
                entity.getStatus(),
                entity.getCancelledAt());
    }
}
