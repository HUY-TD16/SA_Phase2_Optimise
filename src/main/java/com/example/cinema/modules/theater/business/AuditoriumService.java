package com.example.cinema.modules.theater.business;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.IntStream;
import org.springframework.transaction.annotation.Transactional;

public class AuditoriumService {

    public static final int DEFAULT_PAGE = 0;
    public static final int DEFAULT_PAGE_SIZE = 20;
    public static final int MAX_PAGE_SIZE = 50;

    private final AuditoriumRepository auditoriumRepository;
    private final SeatRepository seatRepository;
    private final ShowtimeRepository showtimeRepository;
    private final Clock clock;

    public AuditoriumService(
            AuditoriumRepository auditoriumRepository,
            SeatRepository seatRepository,
            ShowtimeRepository showtimeRepository,
            Clock clock
    ) {
        this.auditoriumRepository = auditoriumRepository;
        this.seatRepository = seatRepository;
        this.showtimeRepository = showtimeRepository;
        this.clock = clock;
    }

    @Transactional
    public Auditorium create(CreateAuditoriumCommand command) {
        String name = command.name().trim();
        if (auditoriumRepository.existsByName(name)) {
            throw new AuditoriumNameAlreadyExistsException(name);
        }

        Instant now = clock.instant();
        UUID auditoriumId = UUID.randomUUID();
        Set<String> positions = new HashSet<>();
        command.seatLayout().forEach(definition -> IntStream.rangeClosed(definition.from(), definition.to())
                .mapToObj(number -> definition.rowLabel().trim().toUpperCase(Locale.ROOT) + "#" + number)
                .forEach(position -> {
                    if (!positions.add(position)) {
                        String[] parts = position.split("#", 2);
                        throw new DuplicateSeatPositionException(parts[0], Integer.parseInt(parts[1]));
                    }
                }));
        Auditorium auditorium = new Auditorium(
                auditoriumId,
                name,
                AuditoriumStatus.ACTIVE,
                null,
                now,
                now
        );
        Auditorium saved = auditoriumRepository.save(auditorium);

        List<Seat> seats = command.seatLayout().stream()
                .flatMap(definition -> IntStream.rangeClosed(definition.from(), definition.to())
                        .mapToObj(number -> new Seat(
                                UUID.randomUUID(),
                                auditoriumId,
                                definition.rowLabel().trim().toUpperCase(Locale.ROOT),
                                number,
                                definition.type())))
                .toList();
        seatRepository.saveAll(seats);
        return saved;
    }

    @Transactional(readOnly = true)
    public List<Auditorium> findActive() {
        return auditoriumRepository.findActive();
    }

    @Transactional(readOnly = true)
    public AuditoriumPage findActivePage(int page, int size) {
        if (page < 0) {
            throw new IllegalArgumentException("page must be greater than or equal to 0");
        }
        if (size < 1 || size > MAX_PAGE_SIZE) {
            throw new IllegalArgumentException("size must be between 1 and " + MAX_PAGE_SIZE);
        }
        AuditoriumSlice slice = auditoriumRepository.findActive(page, size);
        List<Auditorium> auditoriums = slice.items();
        if (auditoriums.isEmpty()) {
            return new AuditoriumPage(List.of(), page, size, slice.totalElements(), slice.totalPages());
        }
        List<UUID> auditoriumIds = new ArrayList<>(auditoriums.size());
        for (int i = 0; i < auditoriums.size(); i++) {
            auditoriumIds.add(auditoriums.get(i).id());
        }
        Map<UUID, List<Seat>> seatsByAuditorium = seatRepository.findByAuditoriumIds(auditoriumIds);
        List<AuditoriumWithSeats> items = new ArrayList<>(auditoriums.size());
        for (int i = 0; i < auditoriums.size(); i++) {
            Auditorium auditorium = auditoriums.get(i);
            items.add(new AuditoriumWithSeats(
                    auditorium,
                    seatsByAuditorium.getOrDefault(auditorium.id(), List.of())));
        }
        return new AuditoriumPage(items, page, size, slice.totalElements(), slice.totalPages());
    }

    @Transactional(readOnly = true)
    public List<Seat> findSeats(UUID auditoriumId) {
        return seatRepository.findByAuditoriumId(auditoriumId);
    }

    @Transactional
    public void softDelete(UUID auditoriumId) {
        Auditorium auditorium = auditoriumRepository.findByIdForUpdate(auditoriumId)
                .orElseThrow(() -> new AuditoriumNotFoundException(auditoriumId));
        if (!auditorium.isActive()) {
            return;
        }
        if (showtimeRepository.existsFutureByAuditoriumId(auditoriumId, clock.instant())) {
            throw new AuditoriumHasFutureShowtimesException(auditoriumId);
        }
        Instant now = clock.instant();
        auditoriumRepository.save(new Auditorium(
                auditorium.id(),
                auditorium.name(),
                AuditoriumStatus.INACTIVE,
                now,
                auditorium.createdAt(),
                now
        ));
    }
}
