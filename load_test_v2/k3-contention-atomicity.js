// K3: Multi-Wave Seat Contention, Reverse-Order Partial-Overlap Rollback & Soft-Delete Rules
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE, STRICT_PHASE2, apiRequest, buildSummary, expectedConflicts409, extractBookingId, extractErrorCode, legacyConflicts, loadFixtures, parseJson, successfulBookings, unwrapList } from './lib/common.js';

const saved = loadFixtures();
const VUS = Math.min(Number(__ENV.CONTENTION_VUS || 40), saved.contenders.length);
const WAVES = Math.min(Number(__ENV.CONTENTION_WAVES || 25), saved.singleContentionSeatIds.length);
const OVERLAP_WAVES = Math.min(Number(__ENV.OVERLAP_WAVES || 15), saved.overlapPairs.length);

const winners = new Counter('single_seat_winners');
const overlapRollbackOk = new Rate('partial_overlap_atomic_rollback_ok');
const concurrentCancelOk = new Rate('concurrent_cancel_race_safe');
const rebookOk = new Rate('rebook_after_soft_delete_ok');
const cancelUnder30mBlocked = new Rate('cancel_under_30m_blocked_ok');

export const options = {
    scenarios: {
        single_seat_waves: { executor: 'per-vu-iterations', vus: VUS, iterations: WAVES, maxDuration: '120s', exec: 'singleSeatWave' },
        partial_overlap: { executor: 'per-vu-iterations', vus: 1, iterations: OVERLAP_WAVES, startTime: '2s', maxDuration: '120s', exec: 'overlapWave' },
        lifecycle_rules: { executor: 'per-vu-iterations', vus: 1, iterations: 1, startTime: '4s', maxDuration: '60s', exec: 'lifecycleRules' },
    },
    thresholds: Object.assign(
        { single_seat_winners: [`count==${WAVES}`], partial_overlap_atomic_rollback_ok: ['rate==1'], rebook_after_soft_delete_ok: ['rate==1'] },
        STRICT_PHASE2 ? { legacy_conflict_errors: ['count==0'], cancel_under_30m_blocked_ok: ['rate==1'] } : {}
    ),
    summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export function singleSeatWave() {
    const user = saved.contenders[(exec.vu.idInInstance - 1) % VUS];
    const seatId = saved.singleContentionSeatIds[exec.vu.iterationInScenario];
    const res = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.contentionShowtimeId, seatIds: [seatId] }, {
        token: user.token, expected: STRICT_PHASE2 ? [201, 409] : [201, 400, 409, 500], kind: 'booking',
    });
    const body = parseJson(res);
    if (res.status === 201 && extractBookingId(body)) {
        winners.add(1);
        successfulBookings.add(1);
    } else if (res.status === 409 && extractErrorCode(body) === 'SEAT_ALREADY_BOOKED') {
        expectedConflicts409.add(1);
    } else {
        legacyConflicts.add(1);
    }
}

export function overlapWave() {
    const idx = exec.vu.iterationInScenario;
    const p = saved.overlapPairs[idx];
    const uA = saved.loadUsers[(idx * 2) % saved.loadUsers.length];
    const uB = saved.loadUsers[(idx * 2 + 1) % saved.loadUsers.length];
    const [rA, rB] = http.batch([
        ['POST', `${BASE}/api/v1/bookings`, JSON.stringify({ showtimeId: saved.contentionShowtimeId, seatIds: p.seatIdsA }), { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uA.token}` } }],
        ['POST', `${BASE}/api/v1/bookings`, JSON.stringify({ showtimeId: saved.contentionShowtimeId, seatIds: p.seatIdsB }), { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${uB.token}` } }],
    ]);
    const aWon = rA.status === 201;
    const bWon = rB.status === 201;
    const map = {};
    for (const s of unwrapList(apiRequest('GET', `/api/v1/showtimes/${saved.contentionShowtimeId}/seats`, null, { phaseOverride: 'verify' })) || []) {
        map[s.id || s.seatId] = s.status || (s.booked ? 'BOOKED' : 'AVAILABLE');
    }
    const ok = (aWon !== bWon)
        && (aWon ? p.seatIdsA : p.seatIdsB).every((id) => map[id] === 'BOOKED')
        && (aWon ? p.exclusiveB : p.exclusiveA).every((id) => map[id] === 'AVAILABLE');
    overlapRollbackOk.add(ok);
    check(rA, { 'atomic partial-overlap rollback': () => ok });
}

export function lifecycleRules() {
    const [u1, u2] = saved.loadUsers;
    const [seat1, seat2] = saved.nearStartSeats;
    const created = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.contentionShowtimeId, seatIds: [seat1] }, { token: u1.token, expected: [201], phaseOverride: 'verify' });
    const bId = extractBookingId(created);
    if (bId) {
        // Concurrent double-cancel race + immediate rebook
        const dels = http.batch([
            ['DELETE', `${BASE}/api/v1/bookings/${bId}`, null, { headers: { Authorization: `Bearer ${u1.token}` } }],
            ['DELETE', `${BASE}/api/v1/bookings/${bId}`, null, { headers: { Authorization: `Bearer ${u1.token}` } }],
        ]);
        const delOk = dels.filter((r) => r.status === 204 || r.status === 200).length;
        concurrentCancelOk.add(delOk >= 1 && dels.every((r) => r.status < 500));
        const rebook = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.contentionShowtimeId, seatIds: [seat1] }, { token: u2.token, expected: [201], phaseOverride: 'verify' });
        rebookOk.add(rebook.status === 201 && Boolean(extractBookingId(rebook)));
    }
    const near = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.nearStartShowtimeId, seatIds: [seat2] }, { token: u1.token, expected: [201, 400, 422], phaseOverride: 'verify' });
    const nearId = extractBookingId(near);
    if (near.status === 201 && nearId) {
        const lateDel = apiRequest('DELETE', `/api/v1/bookings/${nearId}`, null, { token: u1.token, expected: [204, 400, 409, 422], phaseOverride: 'verify' });
        cancelUnder30mBlocked.add([400, 409, 422].includes(lateDel.status));
    }
}

export function handleSummary(result) {
    const v = (k) => result.metrics[k]?.values || {};
    return buildSummary('k3-contention-atomicity', result, {
        measureDurationSeconds: 1,
        singleSeatWinners: v('single_seat_winners').count || 0,
        overlapAtomicRollbackRate: v('partial_overlap_atomic_rollback_ok').rate ?? null,
        cancelUnder30mBlockedRate: v('cancel_under_30m_blocked_ok').rate ?? null,
    });
}
