package com.example.cinema.modules.theater.business;

import java.util.List;

public record AuditoriumSlice(List<Auditorium> items, long totalElements, int totalPages) {

    public AuditoriumSlice {
        items = List.copyOf(items);
    }
}
