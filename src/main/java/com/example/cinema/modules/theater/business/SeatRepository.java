package com.example.cinema.modules.theater.business;

import com.example.cinema.modules.theater.business.ShowtimeModuleApi.SeatKind;
import com.example.cinema.modules.theater.business.ShowtimeModuleApi.SeatSnapshot;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface SeatRepository {

    List<Seat> saveAll(List<Seat> seats);

    List<Seat> findByAuditoriumId(UUID auditoriumId);

    default Map<UUID, List<Seat>> findByAuditoriumIds(Collection<UUID> auditoriumIds) {
        if (auditoriumIds == null || auditoriumIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, List<Seat>> seatsByAuditorium = new LinkedHashMap<>();
        for (UUID auditoriumId : auditoriumIds) {
            seatsByAuditorium.put(auditoriumId, findByAuditoriumId(auditoriumId));
        }
        return seatsByAuditorium;
    }

    default List<SeatSnapshot> findSeatSnapshotsByAuditoriumId(UUID auditoriumId) {
        List<Seat> seats = findByAuditoriumId(auditoriumId);
        List<SeatSnapshot> snapshots = new ArrayList<>(seats.size());
        for (int i = 0; i < seats.size(); i++) {
            Seat seat = seats.get(i);
            snapshots.add(new SeatSnapshot(
                    seat.id(),
                    seat.auditoriumId(),
                    seat.rowLabel(),
                    seat.seatNumber(),
                    seat.type() == SeatType.VIP ? SeatKind.VIP : SeatKind.STANDARD));
        }
        return snapshots;
    }

    default List<Seat> findByIds(List<UUID> seatIds) {
        return List.of();
    }
}
