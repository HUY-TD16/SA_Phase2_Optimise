// K5: Idempotency Storm, BCrypt DoS Rate-Limiting (429), JWT Logout Blacklist & NIST Policy
import http from 'k6/http';
import exec from 'k6/execution';
import { Rate, Trend } from 'k6/metrics';
import { BASE, STRICT_PHASE2, apiRequest, buildSummary, extractBookingId, loadFixtures, rateLimited429, successfulBookings, unwrapData } from './lib/common.js';

const saved = loadFixtures();
const ATTACK_SEC = Number(__ENV.ATTACK_DURATION_SECONDS || 30);

const customerUnderAttack = new Trend('customer_latency_under_attack', true);
const attackerBlocked = new Rate('attacker_blocked_429_rate');
const idemDedupOk = new Rate('idempotency_dedup_ok');
const idemMismatch409Ok = new Rate('idempotency_payload_mismatch_409_ok');
const jwtLogoutOk = new Rate('jwt_logout_revocation_ok');
const nistOk = new Rate('nist_long_password_supported');
const secHeadersOk = new Rate('security_headers_present');

export const options = {
    scenarios: {
        audit: { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '30s', exec: 'auditFeatures' },
        attacker: { executor: 'constant-arrival-rate', rate: Number(__ENV.ATTACK_RATE || 50), timeUnit: '1s', duration: `${ATTACK_SEC}s`, preAllocatedVUs: 40, maxVUs: 120, startTime: '4s', exec: 'attackerFlood' },
        customers: { executor: 'constant-arrival-rate', rate: Number(__ENV.CUSTOMER_RATE || 40), timeUnit: '1s', duration: `${ATTACK_SEC}s`, preAllocatedVUs: 30, maxVUs: 100, startTime: '4s', exec: 'customerTraffic' },
    },
    thresholds: STRICT_PHASE2 ? { idempotency_dedup_ok: ['rate==1'], attacker_blocked_429_rate: ['rate>0.5'], jwt_logout_revocation_ok: ['rate==1'], nist_long_password_supported: ['rate==1'] } : {},
    summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function auditFeatures() {
    const user = saved.loadUsers[0];
    const seat = saved.parallelBatches[saved.parallelBatches.length - 1][0];
    const key = `idem-${Date.now()}`;
    const body = JSON.stringify({ showtimeId: saved.mixedShowtimeId, seatIds: [seat] });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}`, 'Idempotency-Key': key };

    const storm = http.batch(Array.from({ length: 12 }, () => ['POST', `${BASE}/api/v1/bookings`, body, { headers }]));
    const retry = http.post(`${BASE}/api/v1/bookings`, body, { headers });
    const ids = new Set();
    for (const r of [...storm, retry]) {
        if (r.status === 200 || r.status === 201) {
            const id = extractBookingId(r);
            if (id) ids.add(id);
        }
    }
    idemDedupOk.add((retry.status === 200 || retry.status === 201) && ids.size === 1);
    const altSeat = saved.parallelBatches[saved.parallelBatches.length - 1][1];
    const mismatch = http.post(`${BASE}/api/v1/bookings`, JSON.stringify({ showtimeId: saved.mixedShowtimeId, seatIds: [altSeat] }), { headers });
    idemMismatch409Ok.add([409, 422].includes(mismatch.status));

    const h = http.get(`${BASE}/api/v1/movies?page=1&pageSize=5`).headers || {};
    const hl = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
    secHeadersOk.add(hl['x-content-type-options'] === 'nosniff' && Boolean(hl['x-frame-options']));

    const nistRes = http.post(`${BASE}/api/v1/auth/register`, JSON.stringify({ username: `nist-${Date.now().toString(36)}`, password: 'correct-horse-battery-staple-2026-vn' }), {
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.77' },
    });
    nistOk.add(nistRes.status === 201);

    const uName = `out-${Date.now().toString(36)}`;
    const ipHdr = { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.88' };
    if (http.post(`${BASE}/api/v1/auth/register`, JSON.stringify({ username: uName, password: 'logout-pass-12' }), { headers: ipHdr }).status === 201) {
        const login = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username: uName, password: 'logout-pass-12' }), { headers: ipHdr });
        if (login.status === 200) {
            const tok = unwrapData(login).accessToken;
            const out = http.post(`${BASE}/api/v1/auth/logout`, null, { headers: { Authorization: `Bearer ${tok}`, 'X-Forwarded-For': '198.51.100.88' } });
            const me = http.get(`${BASE}/api/v1/users/me`, { headers: { Authorization: `Bearer ${tok}` } });
            jwtLogoutOk.add([200, 204].includes(out.status) && me.status === 401);
        }
    }
}

export function attackerFlood() {
    const res = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ username: `atk-${exec.scenario.iterationInTest % 10}`, password: 'wrong-password-1' }), {
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.66' },
        tags: { phase: 'attack' },
    });
    attackerBlocked.add(res.status === 429);
    if (res.status === 429) rateLimited429.add(1);
}

export function customerTraffic() {
    const iter = exec.scenario.iterationInTest;
    const user = saved.loadUsers[iter % saved.loadUsers.length];
    if (iter % 5 === 0 && iter < saved.parallelBatches.length - 5) {
        const s = saved.parallelBatches[iter];
        const res = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.mixedShowtimeId, seatIds: [s[0], s[1]] }, { token: user.token, expected: [201, 409], kind: 'booking', phaseOverride: 'measure' });
        customerUnderAttack.add(res.timings.duration);
        if (res.status === 201) successfulBookings.add(1);
    } else {
        const res = apiRequest('GET', `/api/v1/showtimes/${saved.seatMapShowtimeId}/seats`, null, { kind: 'seat_map', phaseOverride: 'measure' });
        customerUnderAttack.add(res.timings.duration);
    }
}

export function handleSummary(result) {
    const v = (k) => result.metrics[k]?.values || {};
    return buildSummary('k5-resilience-security', result, {
        measureDurationSeconds: ATTACK_SEC,
        securityAudit: {
            idempotencyDedupRate: v('idempotency_dedup_ok').rate ?? null,
            attackerBlocked429Rate: v('attacker_blocked_429_rate').rate ?? null,
            customerP95UnderAttackMs: v('customer_latency_under_attack')['p(95)'] ?? null,
            jwtLogoutRevocationRate: v('jwt_logout_revocation_ok').rate ?? null,
            nistLongPasswordRate: v('nist_long_password_supported').rate ?? null,
            securityHeadersRate: v('security_headers_present').rate ?? null,
        },
    });
}
