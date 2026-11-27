package com.example.cinema.modules.theater.data;

import com.example.cinema.modules.theater.business.Seat;
import com.example.cinema.modules.theater.business.SeatRepository;
import com.example.cinema.modules.theater.business.ShowtimeModuleApi.SeatSnapshot;
import java.util.List;
import java.util.UUID;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Repository;

@Repository
@ConditionalOnProperty(name = "cinema.theater.enabled", havingValue = "true", matchIfMissing = true)
class SeatRepositoryAdapter implements SeatRepository {

    private final SeatJpaRepository seatRepository;

    SeatRepositoryAdapter(SeatJpaRepository seatRepository) {
        this.seatRepository = seatRepository;
    }

    @Override
    public List<Seat> saveAll(List<Seat> seats) {
        return seatRepository.saveAll(seats.stream().map(TheaterDataMapper::toEntity).toList()).stream()
                .map(TheaterDataMapper::toBusiness)
                .toList();
    }

    @Override
    public List<Seat> findByAuditoriumId(UUID auditoriumId) {
        return seatRepository.findAllByAuditoriumIdOrderByRowLabelAscSeatNumberAsc(auditoriumId).stream()
                .map(TheaterDataMapper::toBusiness)
                .toList();
    }

    @Override
    public List<SeatSnapshot> findSeatSnapshotsByAuditoriumId(UUID auditoriumId) {
        return seatRepository.findSeatSnapshotsByAuditoriumId(auditoriumId);
    }

    @Override
    public List<Seat> findByIds(List<UUID> seatIds) {
        if (seatIds == null || seatIds.isEmpty()) {
            return List.of();
        }
        return seatRepository.findAllByIdIn(seatIds).stream()
                .map(TheaterDataMapper::toBusiness)
                .toList();
    }
}
