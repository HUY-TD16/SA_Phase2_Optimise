package com.example.cinema.e2e;

import com.example.cinema.modules.identity.business.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.env.Environment;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@AutoConfigureMockMvc
@AutoConfigureObservability
@SpringBootTest(properties = {
        "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration",
        "management.endpoint.health.group.readiness.include=readinessState",
        "cinema.movie.enabled=false",
        "cinema.theater.enabled=false",
        "cinema.booking.enabled=false",
        "cinema.jwt.secret=test-only-jwt-secret-for-observability-test",
        "cinema.jwt.expiration-seconds=3600"
})
@ActiveProfiles("test")
class ObservabilityEndpointTest {

    @MockitoBean(name = "userRepositoryAdapter")
    private UserRepository userRepository;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private Environment environment;

    @Test
    void exposesPrometheusEndpointAndRuntimeDefaults() throws Exception {
        mockMvc.perform(get("/actuator/prometheus"))
                .andExpect(status().isOk());

        assertThat(environment.getProperty("spring.threads.virtual.enabled", Boolean.class)).isTrue();
        assertThat(environment.getProperty("server.compression.enabled", Boolean.class)).isTrue();
        assertThat(environment.getProperty("spring.datasource.hikari.maximum-pool-size", Integer.class)).isEqualTo(30);
    }
}
