package com.example.cinema.modules.theater.data;

import com.example.cinema.modules.theater.business.ShowtimeModuleApi.SeatSnapshot;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface SeatJpaRepository extends JpaRepository<SeatEntity, UUID> {

    List<SeatEntity> findAllByAuditoriumIdOrderByRowLabelAscSeatNumberAsc(UUID auditoriumId);

    @Query("""
            select new com.example.cinema.modules.theater.business.ShowtimeModuleApi$SeatSnapshot(
                s.id,
                s.auditoriumId,
                s.rowLabel,
                s.seatNumber,
                case when s.type = com.example.cinema.modules.theater.business.SeatType.VIP
                     then com.example.cinema.modules.theater.business.ShowtimeModuleApi$SeatKind.VIP
                     else com.example.cinema.modules.theater.business.ShowtimeModuleApi$SeatKind.STANDARD
                end
            )
            from SeatEntity s
            where s.auditoriumId = :auditoriumId
            order by s.rowLabel asc, s.seatNumber asc
            """)
    List<SeatSnapshot> findSeatSnapshotsByAuditoriumId(UUID auditoriumId);

    List<SeatEntity> findAllByIdIn(List<UUID> seatIds);
}
