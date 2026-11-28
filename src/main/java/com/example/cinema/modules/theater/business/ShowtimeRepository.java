package com.example.cinema.modules.theater.business;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ShowtimeRepository {

    Showtime save(Showtime showtime);

    Optional<Showtime> findById(UUID showtimeId);

    default Optional<UUID> findAuditoriumIdById(UUID showtimeId) {
        return findById(showtimeId).map(Showtime::auditoriumId);
    }

    Optional<Showtime> findByIdForUpdate(UUID showtimeId);

    /** Queries startsAt in the half-open interval [from, to), sorted ascending. */
    List<Showtime> findByMovieIdAndStartsAtBetween(UUID movieId, Instant from, Instant to);

    /** Queries SCHEDULED showtimes with startsAt in the half-open interval [from, to), sorted ascending. */
    default List<Showtime> findScheduledByMovieIdAndStartsAtBetween(UUID movieId, Instant from, Instant to) {
        return findByMovieIdAndStartsAtBetween(movieId, from, to).stream()
                .filter(showtime -> showtime.status() == ShowtimeStatus.SCHEDULED)
                .toList();
    }

    boolean existsOverlapping(UUID auditoriumId, Instant startsAt, Instant endsAt);

    boolean existsFutureByAuditoriumId(UUID auditoriumId, Instant from);
}
