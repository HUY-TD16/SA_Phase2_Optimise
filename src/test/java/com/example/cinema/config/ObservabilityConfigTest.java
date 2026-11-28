package com.example.cinema.config;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

class ObservabilityConfigTest {

    private final ObservabilityConfig config = new ObservabilityConfig();

    @Test
    void addsApplicationAndInstanceTagsToMeters() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        config.commonMetricsTags("cinema-backend", "api-1").customize(registry);

        Counter counter = Counter.builder("http.server.requests")
                .tag("uri", "/api/v1/movies")
                .register(registry);
        counter.increment();

        assertThat(counter.getId().getTag("application")).isEqualTo("cinema-backend");
        assertThat(counter.getId().getTag("instance")).isEqualTo("api-1");
    }

    @Test
    void ignoresSwaggerEndpointsInMetrics() {
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        config.commonMetricsTags("cinema-backend", "api-1").customize(registry);

        Counter.builder("http.server.requests")
                .tag("uri", "/swagger-ui/index.html")
                .register(registry)
                .increment();

        assertThat(registry.find("http.server.requests").tag("uri", "/swagger-ui/index.html").counter())
                .isNull();
    }
}
