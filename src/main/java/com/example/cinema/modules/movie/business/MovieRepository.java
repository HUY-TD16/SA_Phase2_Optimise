package com.example.cinema.modules.movie.business;

import java.util.Optional;
import java.util.UUID;

public interface MovieRepository {
    public Movie save(Movie movie);
    public Optional<Movie> findUndeletedById(UUID id);
    default Optional<MovieForShowtime> findForShowtimeById(UUID id) {
        return findUndeletedById(id)
                .map(movie -> new MovieForShowtime(movie.getId(), movie.getTitle(), movie.getDurationMinutes()));
    }
    public Optional<Movie> findUndeletedByIdForUpdate(UUID id);
    public MoviePage findUndeleted(int page, int pageSize, MovieStatus status);
}
