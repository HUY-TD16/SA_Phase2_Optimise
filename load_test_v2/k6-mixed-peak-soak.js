// K6: Realistic Peak-Hour Mixed Open-Model & Soak Test (75% Read, 15% Booking, 5% History, 5% Cancel)
import exec from 'k6/execution';
import { DURATION, apiRequest, buildSummary, detectPaginationQuery, extractBookingId, loadFixtures, openArrivalOptions, successfulBookings } from './lib/common.js';

const saved = loadFixtures();
const cancellable = [];
let cancelCursor = 0;

export const options = openArrivalOptions({ rate: Number(__ENV.RATE || 350), preAllocatedVUs: 100, maxVUs: 350 });

export function setup() {
    return { pageQuery: detectPaginationQuery('/api/v1/bookings', saved.loadUsers[0].token, 20) };
}

export function traffic(ctx) {
    const iter = exec.scenario.iterationInTest;
    const isMeasure = exec.scenario.name === 'measure';
    const user = saved.loadUsers[iter % saved.loadUsers.length];
    const slot = iter % 20;

    if (slot < 4) {
        apiRequest('GET', `/api/v1/movies?page=${(iter % 15) + 1}&pageSize=20&status=NOW_SHOWING`);
    } else if (slot < 7) {
        apiRequest('GET', `/api/v1/movies/${saved.movieIds[iter % Math.min(80, saved.movieIds.length)]}`);
    } else if (slot < 11) {
        apiRequest('GET', `/api/v1/showtimes?movieId=${saved.dailyMovieIds[iter % saved.dailyMovieIds.length]}&date=${saved.showtimeDate}`);
    } else if (slot < 15) {
        apiRequest('GET', `/api/v1/showtimes/${saved.mixedShowtimeId}/seats`, null, { kind: 'seat_map' });
    } else if (slot < 18) {
        const bIdx = Math.floor((iter * 3) / 20) + (slot - 15);
        if (bIdx < saved.parallelBatches.length) {
            const stId = isMeasure ? saved.mixedShowtimeId : saved.hotShowtimeId;
            const res = apiRequest('POST', '/api/v1/bookings', { showtimeId: stId, seatIds: saved.parallelBatches[bIdx].slice(0, 2 + (iter % 3)) }, {
                token: user.token, expected: [201, 409], kind: 'booking',
            });
            const id = extractBookingId(res);
            if (res.status === 201 && id && isMeasure) {
                successfulBookings.add(1);
                cancellable.push({ id, token: user.token });
            }
        } else {
            apiRequest('GET', `/api/v1/showtimes/${saved.mixedShowtimeId}/seats`, null, { kind: 'seat_map' });
        }
    } else if (slot === 18 || cancelCursor >= cancellable.length) {
        apiRequest('GET', `/api/v1/bookings?${ctx.pageQuery}`, null, { token: user.token });
    } else {
        const item = cancellable[cancelCursor++];
        apiRequest('DELETE', `/api/v1/bookings/${item.id}`, null, { token: item.token, expected: [200, 204, 404, 409], kind: 'booking_cancel' });
    }
}

export function handleSummary(result) {
    return buildSummary('k6-mixed-peak-soak', result, { measureDurationSeconds: DURATION });
}
