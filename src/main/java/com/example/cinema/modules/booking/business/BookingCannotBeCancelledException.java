package com.example.cinema.modules.booking.business;

public class BookingCannotBeCancelledException extends RuntimeException {

    public BookingCannotBeCancelledException(String message) {
        super(message);
    }
}
