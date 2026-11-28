// K2: Hot-Showtime Disjoint Multi-Seat Parallel Booking (Shared Lock + Batch IN + JDBC Batching)
import exec from 'k6/execution';
import { check } from 'k6';
import { Counter } from 'k6/metrics';
import { DURATION, apiRequest, buildStepStages, buildSummary, contractEnvelopeOk, extractBookingId, loadFixtures, openArrivalOptions, parseJson, successfulBookings } from './lib/common.js';

const saved = loadFixtures();
const poolExhausted = new Counter('fixture_seat_batches_exhausted');
const rate = Number(__ENV.BOOKING_RATE || __ENV.RATE || 50);
const stagePlan = buildStepStages(__ENV.BOOKING_STAGES || '');

export const options = openArrivalOptions({
    rate,
    stagePlan,
    preAllocatedVUs: stagePlan ? 150 : 80,
    maxVUs: stagePlan ? 400 : 250,
    thresholds: { fixture_seat_batches_exhausted: ['count==0'] },
});

export function traffic() {
    const iter = exec.scenario.iterationInTest;
    const user = saved.loadUsers[iter % saved.loadUsers.length];

    if (exec.scenario.name === 'warmup') {
        const warmIdx = saved.parallelBatches.length - 1 - (iter % Math.min(250, saved.parallelBatches.length));
        apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.mixedShowtimeId, seatIds: saved.parallelBatches[warmIdx] }, {
            token: user.token, expected: [201, 400, 409], kind: 'booking', phaseOverride: 'warmup',
        });
        return;
    }

    if (iter >= saved.parallelBatches.length) {
        poolExhausted.add(1);
        return;
    }

    const res = apiRequest('POST', '/api/v1/bookings', { showtimeId: saved.hotShowtimeId, seatIds: saved.parallelBatches[iter] }, {
        token: user.token, expected: [201], kind: 'booking',
    });
    const body = parseJson(res);
    const ok = res.status === 201 && Boolean(extractBookingId(body));
    check(res, { 'parallel 4-seat booking 201': () => ok });
    if (ok) {
        successfulBookings.add(1);
        contractEnvelopeOk.add(Boolean(body?.data !== undefined));
    }
}

export function handleSummary(result) {
    return buildSummary('k2-parallel-booking', result, { measureDurationSeconds: stagePlan ? stagePlan.totalDurationSec : DURATION });
}
