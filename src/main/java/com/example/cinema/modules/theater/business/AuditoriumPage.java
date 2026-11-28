package com.example.cinema.modules.theater.business;

import java.util.List;

public record AuditoriumPage(
        List<AuditoriumWithSeats> items,
        int page,
        int size,
        long totalElements,
        int totalPages
) {

    public AuditoriumPage {
        items = List.copyOf(items);
    }
}
