package com.example.cinema.modules.theater.api;

import java.util.List;

public record AuditoriumListResponse(
        List<AuditoriumResponse> data,
        PaginationMeta pagination
) {

    public AuditoriumListResponse {
        data = List.copyOf(data);
    }

    public record PaginationMeta(int page, int size, long totalElements, int totalPages) {
    }
}
