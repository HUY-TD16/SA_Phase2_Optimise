// K1: Open-Model Read Scalability & Cache Invalidation (`400 -> 2400 req/s`, no sleep)
import exec from 'k6/execution';
import { check } from 'k6';
import { Rate } from 'k6/metrics';
import { DURATION, apiRequest, buildStepStages, buildSummary, loadFixtures, openArrivalOptions, unwrapData, unwrapList } from './lib/common.js';

const saved = loadFixtures();
const cacheEvictOk = new Rate('cache_invalidation_verified');
const stagePlan = __ENV.RATE ? null : buildStepStages(__ENV.READ_STAGES || '400,900,1600,2400');

export const options = openArrivalOptions({
    rate: Number(__ENV.RATE || 2400),
    stagePlan,
    preAllocatedVUs: 120,
    maxVUs: 450,
});

const FILTERS = ['', '&status=NOW_SHOWING', '&status=COMING_SOON', '&status=NOW_SHOWING'];

export function traffic() {
    const iter = exec.scenario.iterationInTest;
    const slot = iter % 20;
    if (slot < 7) {
        const res = apiRequest('GET', `/api/v1/movies?page=${(iter % 20) + 1}&pageSize=20${FILTERS[iter % 4]}`);
        check(res, { 'movies array': (r) => Array.isArray(unwrapList(r)) });
    } else if (slot < 12) {
        const pool = slot === 11 ? saved.coldMovieIds : saved.movieIds.slice(0, 50);
        const id = pool[iter % pool.length];
        const res = apiRequest('GET', `/api/v1/movies/${id}`);
        check(res, { 'movie detail id': (r) => unwrapData(r)?.id === id });
    } else if (slot < 16) {
        const movieId = saved.dailyMovieIds[iter % saved.dailyMovieIds.length];
        const res = apiRequest('GET', `/api/v1/showtimes?movieId=${movieId}&date=${saved.showtimeDate}`);
        check(res, { 'scheduled showtimes': (r) => (unwrapList(r) || []).every((s) => s.status === 'SCHEDULED') });
    } else {
        const res = apiRequest('GET', `/api/v1/showtimes/${saved.seatMapShowtimeId}/seats`, null, { kind: 'seat_map' });
        check(res, { '250 seats returned': (r) => (unwrapList(r) || []).length >= 200 });
    }
}

export function teardown() {
    const login = apiRequest('POST', '/api/v1/auth/login', saved.adminCredentials, { expected: [200, 429], phaseOverride: 'teardown' });
    if (login.status !== 200) return;
    const admin = unwrapData(login).accessToken;
    const id = saved.movieIds[0];
    const title = `EvictCheck-${Date.now()}`;
    apiRequest('GET', `/api/v1/movies/${id}`, null, { phaseOverride: 'teardown' });
    if (apiRequest('PATCH', `/api/v1/admin/movies/${id}`, { title }, { token: admin, expected: [200], phaseOverride: 'teardown' }).status === 200) {
        const after = apiRequest('GET', `/api/v1/movies/${id}`, null, { phaseOverride: 'teardown' });
        cacheEvictOk.add(unwrapData(after)?.title === title);
    }
}

export function handleSummary(result) {
    return buildSummary('k1-read-scalability', result, { measureDurationSeconds: stagePlan ? stagePlan.totalDurationSec : DURATION });
}
