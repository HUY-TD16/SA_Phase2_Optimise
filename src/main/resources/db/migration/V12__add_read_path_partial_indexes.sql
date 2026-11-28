-- R2: Partial indexes aligned with active read-path queries and sort orders.

CREATE INDEX idx_movies_active_created_id
    ON movies (created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_movies_active_status_created_id
    ON movies (status, created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_showtimes_scheduled_movie_starts_at
    ON showtimes (movie_id, starts_at ASC)
    WHERE status = 'SCHEDULED';

CREATE INDEX idx_auditoriums_active_name
    ON auditoriums (name ASC)
    WHERE status = 'ACTIVE' AND deleted_at IS NULL;
