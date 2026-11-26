package com.example.cinema.modules.booking.data;

import com.example.cinema.modules.booking.business.Booking;
import com.example.cinema.modules.booking.business.SeatAlreadyBookedException;
import com.example.cinema.modules.booking.business.bookingSeat;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.math.BigDecimal;
import java.sql.SQLException;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class BookingRepositoryAdapterTest {

    @Test
    void translatesActiveSeatConstraintViolationOnFlushToSeatAlreadyBookedException() {
        BookingJpaRepository bookingJpaRepository = mock(BookingJpaRepository.class);
        BookingSeatJpaRepository bookingSeatJpaRepository = mock(BookingSeatJpaRepository.class);
        BookingRepositoryAdapter adapter = new BookingRepositoryAdapter(bookingJpaRepository, bookingSeatJpaRepository);

        ConstraintViolationException hibernateCause = new ConstraintViolationException(
                "duplicate key value violates unique constraint \"uq_active_booking_seat\"",
                new SQLException("ERROR: duplicate key value violates unique constraint \"uq_active_booking_seat\""),
                "uq_active_booking_seat"
        );
        doThrow(new DataIntegrityViolationException("Constraint violation", hibernateCause))
                .when(bookingSeatJpaRepository).flush();

        Booking booking = new Booking(
                UUID.randomUUID(),
                UUID.randomUUID(),
                List.of(new bookingSeat(UUID.randomUUID(), new BigDecimal("100000.00"))),
                new BigDecimal("100000.00")
        );

        assertThrows(SeatAlreadyBookedException.class, () -> adapter.save(booking));
        verify(bookingSeatJpaRepository).flush();
    }

    @Test
    void rethrowsUnrelatedDataIntegrityViolationException() {
        BookingJpaRepository bookingJpaRepository = mock(BookingJpaRepository.class);
        BookingSeatJpaRepository bookingSeatJpaRepository = mock(BookingSeatJpaRepository.class);
        BookingRepositoryAdapter adapter = new BookingRepositoryAdapter(bookingJpaRepository, bookingSeatJpaRepository);

        DataIntegrityViolationException unrelated = new DataIntegrityViolationException("fk_bookings_user violation");
        doThrow(unrelated).when(bookingSeatJpaRepository).flush();

        Booking booking = new Booking(
                UUID.randomUUID(),
                UUID.randomUUID(),
                List.of(new bookingSeat(UUID.randomUUID(), new BigDecimal("100000.00"))),
                new BigDecimal("100000.00")
        );

        DataIntegrityViolationException thrown = assertThrows(
                DataIntegrityViolationException.class,
                () -> adapter.save(booking)
        );
        assertSame(unrelated, thrown);
    }
}
