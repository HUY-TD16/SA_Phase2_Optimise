package com.example.cinema.modules.booking.business;

import com.example.cinema.modules.theater.business.ShowtimeModuleApi.SeatSnapshot;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public record SeatAvailabilitySummary(List<SeatSnapshot> seats, Set<UUID> bookedSeatIds) {
}
