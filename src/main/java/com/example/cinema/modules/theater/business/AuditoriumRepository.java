package com.example.cinema.modules.theater.business;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuditoriumRepository {

    Auditorium save(Auditorium auditorium);

    Optional<Auditorium> findById(UUID auditoriumId);

    Optional<Auditorium> findByIdForUpdate(UUID auditoriumId);

    List<Auditorium> findActive();

    default AuditoriumSlice findActive(int page, int size) {
        List<Auditorium> all = findActive();
        int fromIndex = Math.min(page * size, all.size());
        int toIndex = Math.min(fromIndex + size, all.size());
        int totalPages = all.isEmpty() ? 0 : (int) Math.ceil((double) all.size() / size);
        return new AuditoriumSlice(all.subList(fromIndex, toIndex), all.size(), totalPages);
    }

    boolean existsByName(String name);

    boolean hasFutureShowtimes(UUID auditoriumId, Instant from);
}
