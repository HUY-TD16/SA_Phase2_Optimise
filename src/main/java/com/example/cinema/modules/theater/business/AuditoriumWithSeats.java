package com.example.cinema.modules.theater.business;

import java.util.List;

public record AuditoriumWithSeats(Auditorium auditorium, List<Seat> seats) {

    public AuditoriumWithSeats {
        seats = List.copyOf(seats);
    }
}
