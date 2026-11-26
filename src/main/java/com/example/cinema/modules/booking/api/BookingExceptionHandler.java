package com.example.cinema.modules.booking.api;

import com.example.cinema.modules.booking.business.BookingCannotBeCancelledException;
import com.example.cinema.modules.booking.business.BookingNotFoundException;
import com.example.cinema.modules.booking.business.IdempotencyConflictException;
import com.example.cinema.modules.booking.business.SeatAlreadyBookedException;
import com.example.cinema.modules.theater.business.ShowtimeNotFoundException;
import com.example.cinema.shared.api.ErrorResponse;
import com.example.cinema.shared.api.RequestIdFilter;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice(basePackageClasses = BookingController.class)
@Order(Ordered.HIGHEST_PRECEDENCE)
public class BookingExceptionHandler {

    @ExceptionHandler(SeatAlreadyBookedException.class)
    public ResponseEntity<ErrorResponse> handleSeatAlreadyBooked(SeatAlreadyBookedException ex, HttpServletRequest req) {
        return error(req, HttpStatus.CONFLICT, "SEAT_ALREADY_BOOKED", ex.getMessage());
    }

    @ExceptionHandler(BookingNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleBookingNotFound(BookingNotFoundException ex, HttpServletRequest req) {
        return error(req, HttpStatus.NOT_FOUND, "BOOKING_NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler(ShowtimeNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleShowtimeNotFound(ShowtimeNotFoundException ex, HttpServletRequest req) {
        return error(req, HttpStatus.NOT_FOUND, "SHOWTIME_NOT_FOUND", ex.getMessage());
    }

    @ExceptionHandler(BookingCannotBeCancelledException.class)
    public ResponseEntity<ErrorResponse> handleBookingCannotBeCancelled(BookingCannotBeCancelledException ex, HttpServletRequest req) {
        return error(req, HttpStatus.UNPROCESSABLE_ENTITY, "BOOKING_CANNOT_BE_CANCELLED", ex.getMessage());
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ErrorResponse> handleIdempotencyConflict(IdempotencyConflictException ex, HttpServletRequest req) {
        return error(req, HttpStatus.CONFLICT, "IDEMPOTENCY_CONFLICT", ex.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleInvalidRequest(IllegalArgumentException ex, HttpServletRequest req) {
        return error(req, HttpStatus.UNPROCESSABLE_ENTITY, "VALIDATION_ERROR", ex.getMessage());
    }

    private ResponseEntity<ErrorResponse> error(HttpServletRequest req, HttpStatus status, String code, String message) {
        return ResponseEntity.status(status).body(ErrorResponse.of(code, message, RequestIdFilter.get(req)));
    }
}
