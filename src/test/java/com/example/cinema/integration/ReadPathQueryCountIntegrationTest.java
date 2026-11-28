package com.example.cinema.integration;

import com.example.cinema.modules.movie.business.AgeRating;
import com.example.cinema.modules.movie.business.MovieStatus;
import com.example.cinema.modules.movie.data.MovieEntity;
import com.example.cinema.modules.movie.data.SpringDataMovieRepository;
import com.example.cinema.modules.theater.business.AuditoriumStatus;
import com.example.cinema.modules.theater.business.SeatType;
import com.example.cinema.modules.theater.business.ShowtimeStatus;
import com.example.cinema.modules.theater.data.AuditoriumEntity;
import com.example.cinema.modules.theater.data.AuditoriumJpaRepository;
import com.example.cinema.modules.theater.data.SeatEntity;
import com.example.cinema.modules.theater.data.SeatJpaRepository;
import com.example.cinema.modules.theater.data.ShowtimeEntity;
import com.example.cinema.modules.theater.data.ShowtimeJpaRepository;
import jakarta.persistence.EntityManagerFactory;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@Testcontainers
@SpringBootTest(properties = {
        "spring.jpa.properties.hibernate.generate_statistics=true"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class ReadPathQueryCountIntegrationTest {

    @Container
    @ServiceConnection
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17-alpine");

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuditoriumJpaRepository auditoriumRepository;

    @Autowired
    private SeatJpaRepository seatRepository;

    @Autowired
    private ShowtimeJpaRepository showtimeRepository;

    @Autowired
    private SpringDataMovieRepository movieRepository;

    @Test
    void v12PartialIndexesExistInPostgreSql() {
        List<String> indexes = jdbcTemplate.queryForList(
                """
                SELECT indexname
                FROM pg_indexes
                WHERE schemaname = 'public'
                  AND indexname IN (
                      'idx_movies_active_created_id',
                      'idx_movies_active_status_created_id',
                      'idx_showtimes_scheduled_movie_starts_at',
                      'idx_auditoriums_active_name'
                  )
                """,
                String.class);

        assertThat(indexes).containsExactlyInAnyOrder(
                "idx_movies_active_created_id",
                "idx_movies_active_status_created_id",
                "idx_showtimes_scheduled_movie_starts_at",
                "idx_auditoriums_active_name");
    }

    @Test
    void readEndpointsExecuteConstantNumberOfSqlQueries() throws Exception {
        Instant now = Instant.parse("2030-11-01T10:00:00Z");
        UUID movieId = UUID.randomUUID();
        movieRepository.save(new MovieEntity(
                movieId,
                "Query Count Movie",
                "Verifies O(1) query count for read endpoints.",
                120,
                AgeRating.P,
                LocalDate.of(2030, 11, 1),
                null,
                MovieStatus.NOW_SHOWING,
                now,
                now,
                null));

        List<UUID> auditoriumIds = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            UUID auditoriumId = UUID.randomUUID();
            auditoriumIds.add(auditoriumId);
            auditoriumRepository.save(new AuditoriumEntity(
                    auditoriumId,
                    String.format("QC Room %02d - %s", i, auditoriumId),
                    AuditoriumStatus.ACTIVE,
                    null,
                    now,
                    now));
            List<SeatEntity> seats = new ArrayList<>();
            for (int seatNum = 1; seatNum <= 5; seatNum++) {
                seats.add(new SeatEntity(
                        UUID.randomUUID(),
                        auditoriumId,
                        "A",
                        seatNum,
                        seatNum == 5 ? SeatType.VIP : SeatType.STANDARD));
            }
            seatRepository.saveAll(seats);
        }

        UUID showtimeId = UUID.randomUUID();
        Instant showtimeStart = LocalDate.of(2030, 11, 2).atStartOfDay(ZoneOffset.UTC).toInstant().plusSeconds(3600);
        showtimeRepository.save(new ShowtimeEntity(
                showtimeId,
                movieId,
                auditoriumIds.get(0),
                showtimeStart,
                showtimeStart.plusSeconds(8100),
                new BigDecimal("95000.00"),
                ShowtimeStatus.SCHEDULED,
                now,
                now));

        Statistics stats = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        stats.setStatisticsEnabled(true);

        // 1. Admin auditoriums page=0&size=10 across 12 rooms: must NOT be 1 + 10 = 11 queries!
        stats.clear();
        mockMvc.perform(get("/api/v1/admin/auditoriums")
                        .param("page", "0")
                        .param("size", "10")
                        .with(user("admin").roles("ADMIN")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(10))
                .andExpect(jsonPath("$.pagination.page").value(0))
                .andExpect(jsonPath("$.pagination.size").value(10))
                .andExpect(jsonPath("$.pagination.totalElements").value(org.hamcrest.Matchers.greaterThanOrEqualTo(12)));
        assertThat(stats.getPrepareStatementCount())
                .as("GET /api/v1/admin/auditoriums must use O(1) batched queries (page + count + IN seats)")
                .isLessThanOrEqualTo(3);

        // 2. Showtimes by movie & UTC date: exactly 1 SQL query
        stats.clear();
        mockMvc.perform(get("/api/v1/showtimes")
                        .param("movieId", movieId.toString())
                        .param("date", "2030-11-02"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1));
        assertThat(stats.getPrepareStatementCount())
                .as("GET /api/v1/showtimes must execute 1 SQL query")
                .isEqualTo(1);

        // 3. Seat availability: O(1) lean queries (auditoriumId + seat snapshots + booked seat IDs)
        stats.clear();
        mockMvc.perform(get("/api/v1/showtimes/{id}/seats", showtimeId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(5));
        assertThat(stats.getPrepareStatementCount())
                .as("GET /api/v1/showtimes/{id}/seats must execute 3 O(1) queries")
                .isEqualTo(3);

        // 4. Movie listing with status filter: O(1) (page + optional count <= 2)
        stats.clear();
        mockMvc.perform(get("/api/v1/movies")
                        .param("page", "1")
                        .param("pageSize", "20")
                        .param("status", "NOW_SHOWING"))
                .andExpect(status().isOk());
        assertThat(stats.getPrepareStatementCount())
                .as("GET /api/v1/movies must execute at most 2 SQL queries")
                .isLessThanOrEqualTo(2);
    }
}
