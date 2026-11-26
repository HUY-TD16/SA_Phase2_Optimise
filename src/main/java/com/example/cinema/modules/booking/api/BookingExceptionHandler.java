package com.example.cinema.modules.booking.api;

import com.example.cinema.modules.booking.business.BookingCannotBeCancelledException;
import com.example.cinema.modules.booking.business.BookingNotFoundException;
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

    @ExceptionHandler(BookingNotFoundException.class)
    public ResponseEntity<String> handleBookingNotFound(
            BookingNotFoundException exception,
            HttpServletRequest request
    ) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body("Booking was not found");
    }

    @ExceptionHandler(BookingCannotBeCancelledException.class)
    public ResponseEntity<ErrorResponse> handleBookingCannotBeCancelled(
            BookingCannotBeCancelledException exception,
            HttpServletRequest request
    ) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ErrorResponse.of(
                        "BOOKING_CANNOT_BE_CANCELLED",
                        exception.getMessage(),
                        RequestIdFilter.get(request)));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<String> handleInvalidRequest(IllegalArgumentException exception) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(exception.getMessage());
    }
}
