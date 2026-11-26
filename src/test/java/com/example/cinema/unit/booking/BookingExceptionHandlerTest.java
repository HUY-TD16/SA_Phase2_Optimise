package com.example.cinema.unit.booking;

import com.example.cinema.modules.booking.api.BookingExceptionHandler;
import com.example.cinema.modules.booking.business.BookingCannotBeCancelledException;
import com.example.cinema.modules.booking.business.BookingNotFoundException;
import com.example.cinema.modules.booking.business.IdempotencyConflictException;
import com.example.cinema.modules.booking.business.SeatAlreadyBookedException;
import com.example.cinema.modules.theater.business.ShowtimeNotFoundException;
import com.example.cinema.shared.api.ErrorResponse;
import com.example.cinema.shared.api.RequestIdFilter;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

class BookingExceptionHandlerTest {

    private static final String REQUEST_ID = "0f43cdb5-7972-40a7-8932-b60cd50f031e";

    private BookingExceptionHandler handler;
    private MockHttpServletRequest request;

    @BeforeEach
    void setUp() {
        handler = new BookingExceptionHandler();
        request = new MockHttpServletRequest();
        request.setAttribute(RequestIdFilter.class.getName() + ".requestId", REQUEST_ID);
    }

    @Test
    void mapsSeatAlreadyBookedTo409WithStandardErrorResponse() {
        ResponseEntity<ErrorResponse> response = handler.handleSeatAlreadyBooked(
                new SeatAlreadyBookedException("Seat has already been booked"),
                request
        );

        assertErrorResponse(response, HttpStatus.CONFLICT, "SEAT_ALREADY_BOOKED", "Seat has already been booked");
    }

    @Test
    void mapsBookingNotFoundTo404WithStandardErrorResponse() {
        UUID bookingId = UUID.randomUUID();
        ResponseEntity<ErrorResponse> response = handler.handleBookingNotFound(
                new BookingNotFoundException(bookingId),
                request
        );

        assertErrorResponse(response, HttpStatus.NOT_FOUND, "BOOKING_NOT_FOUND", "Booking was not found: " + bookingId);
    }

    @Test
    void mapsShowtimeNotFoundTo404WithStandardErrorResponse() {
        UUID showtimeId = UUID.randomUUID();
        ShowtimeNotFoundException ex = new ShowtimeNotFoundException(showtimeId);
        ResponseEntity<ErrorResponse> response = handler.handleShowtimeNotFound(ex, request);

        assertErrorResponse(response, HttpStatus.NOT_FOUND, "SHOWTIME_NOT_FOUND", ex.getMessage());
    }

    @Test
    void mapsBookingCannotBeCancelledTo422WithStandardErrorResponse() {
        ResponseEntity<ErrorResponse> response = handler.handleBookingCannotBeCancelled(
                new BookingCannotBeCancelledException("Booking has already been cancelled"),
                request
        );

        assertErrorResponse(
                response,
                HttpStatus.UNPROCESSABLE_ENTITY,
                "BOOKING_CANNOT_BE_CANCELLED",
                "Booking has already been cancelled"
        );
    }

    @Test
    void mapsIdempotencyConflictTo409WithStandardErrorResponse() {
        ResponseEntity<ErrorResponse> response = handler.handleIdempotencyConflict(
                new IdempotencyConflictException("Idempotency key already used with different payload"),
                request
        );

        assertErrorResponse(
                response,
                HttpStatus.CONFLICT,
                "IDEMPOTENCY_CONFLICT",
                "Idempotency key already used with different payload"
        );
    }

    @Test
    void mapsIllegalArgumentExceptionTo422ValidationError() {
        ResponseEntity<ErrorResponse> response = handler.handleInvalidRequest(
                new IllegalArgumentException("Booking must contain from 1 to 8 seats"),
                request
        );

        assertErrorResponse(
                response,
                HttpStatus.UNPROCESSABLE_ENTITY,
                "VALIDATION_ERROR",
                "Booking must contain from 1 to 8 seats"
        );
    }

    private void assertErrorResponse(
            ResponseEntity<ErrorResponse> response,
            HttpStatus expectedStatus,
            String expectedCode,
            String expectedMessage
    ) {
        assertEquals(expectedStatus, response.getStatusCode());
        assertNotNull(response.getBody());
        assertNotNull(response.getBody().error());
        assertEquals(expectedCode, response.getBody().error().code());
        assertEquals(expectedMessage, response.getBody().error().message());
        assertEquals(REQUEST_ID, response.getBody().error().requestId());
    }
}
