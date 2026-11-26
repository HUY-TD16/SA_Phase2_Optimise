package com.example.cinema.modules.booking.business;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public class bookingSeat {
    private UUID seatID;
    private BigDecimal price;
    private Instant releasedAt;

    public bookingSeat(UUID seatID, BigDecimal price) {
        this(seatID, price, null);
    }

    public bookingSeat(UUID seatID, BigDecimal price, Instant releasedAt) {
        this.seatID = seatID;
        this.price = price;
        this.releasedAt = releasedAt;
    }

    public UUID getSeatId() {
        return seatID;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public Instant getReleasedAt() {
        return releasedAt;
    }
}
