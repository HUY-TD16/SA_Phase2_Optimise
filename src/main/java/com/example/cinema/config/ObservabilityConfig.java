package com.example.cinema.config;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.config.MeterFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.actuate.autoconfigure.metrics.MeterRegistryCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ObservabilityConfig {

    @Bean
    MeterRegistryCustomizer<MeterRegistry> commonMetricsTags(
            @Value("${spring.application.name:cinema-backend}") String appName,
            @Value("${HOSTNAME:local}") String instanceId
    ) {
        return registry -> registry.config()
                .commonTags("application", appName, "instance", instanceId)
                .meterFilter(MeterFilter.deny(id -> {
                    String uri = id.getTag("uri");
                    return uri != null && (uri.startsWith("/swagger-ui") || uri.startsWith("/v3/api-docs"));
                }));
    }
}
