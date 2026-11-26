package com.example.cinema.modules.booking.data;

import com.example.cinema.modules.booking.business.Booking;
import com.example.cinema.modules.booking.business.BookingRepository;
import com.example.cinema.modules.booking.business.BookingStatus;
import com.example.cinema.modules.booking.business.SeatAlreadyBookedException;
import com.example.cinema.modules.booking.business.bookingSeat;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
@ConditionalOnProperty(name = "cinema.booking.enabled", havingValue = "true", matchIfMissing = true)
class BookingRepositoryAdapter implements BookingRepository {

    private static final String ACTIVE_SEAT_INDEX = "uq_active_booking_seat";
    private static final String LEGACY_SEAT_CONSTRAINT = "uq_booking_seat_per_showtime";

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
        List<BookingSeatEntity> seatEntities = booking.getSeats().stream()
                .map(seat -> new BookingSeatEntity(
                        UUID.randomUUID(),
                        booking.getBookingId(),
                        booking.getShowtimeId(),
                        seat.getSeatId(),
                        seat.getPrice(),
                        seat.getReleasedAt()))
                .toList();

        try {
            bookingJpaRepository.save(toEntity(booking));
            bookingSeatJpaRepository.saveAll(seatEntities);
            bookingSeatJpaRepository.flush();
            return booking;
        } catch (DataIntegrityViolationException ex) {
            if (isActiveSeatConstraintViolation(ex)) {
                throw new SeatAlreadyBookedException("Seat has already been booked", ex);
            }
            throw ex;
        }
    }

    static boolean isActiveSeatConstraintViolation(Throwable failure) {
        for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
            String candidate = cause instanceof ConstraintViolationException violation && violation.getConstraintName() != null
                    ? violation.getConstraintName()
                    : cause.getMessage();
            if (candidate != null) {
                String normalized = candidate.toLowerCase(Locale.ROOT);
                if (normalized.contains(ACTIVE_SEAT_INDEX) || normalized.contains(LEGACY_SEAT_CONSTRAINT)) {
                    return true;
                }
            }
        }
        return false;
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
        bookingJpaRepository.save(toEntity(cancelled));
        bookingSeatJpaRepository.releaseSeatsByBookingId(cancelled.getBookingId(), cancelledAt);
        return cancelled;
    }

    private static BookingEntity toEntity(Booking booking) {
        return new BookingEntity(
                booking.getBookingId(),
                booking.getBookingCode(),
                booking.getUserId(),
                booking.getShowtimeId(),
                booking.getTotalAmount(),
                booking.getCreatedAt(),
                booking.getPaymentStatus(),
                booking.getStatus(),
                booking.getCancelledAt());
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
