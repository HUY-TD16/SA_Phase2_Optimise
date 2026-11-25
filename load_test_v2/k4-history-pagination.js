// K4: N+1 Elimination & Pagination Scalability (100 vs 500 vs 2,000 Bookings + 30 Auditoriums)
import exec from 'k6/execution';
import { Trend } from 'k6/metrics';
import { DURATION, apiRequest, buildSummary, detectPaginationQuery, loadFixtures, openArrivalOptions, unwrapData } from './lib/common.js';

const saved = loadFixtures();
const t100 = new Trend('history_tier_100_latency', true);
const t500 = new Trend('history_tier_500_latency', true);
const t2000 = new Trend('history_tier_2000_latency', true);
const t2000Bytes = new Trend('history_tier_2000_bytes', false);

export const options = openArrivalOptions({ rate: Number(__ENV.RATE || 80), preAllocatedVUs: 50, maxVUs: 200 });

export function setup() {
    const keys = Object.keys(saved.historyUsers).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
    const login = apiRequest('POST', '/api/v1/auth/login', saved.adminCredentials, { expected: [200, 429], phaseOverride: 'setup' });
    const admin = login.status === 200 ? unwrapData(login).accessToken : null;
    return {
        keys,
        admin,
        bPage: detectPaginationQuery('/api/v1/bookings', saved.historyUsers[keys[0]].token, 20),
        aPage: admin ? detectPaginationQuery('/api/v1/admin/auditoriums', admin, 10) : 'page=0&size=10',
    };
}

export function traffic(ctx) {
    const iter = exec.scenario.iterationInTest;
    const slot = iter % 4;
    if (slot < 3) {
        const key = ctx.keys[slot % ctx.keys.length];
        const res = apiRequest('GET', `/api/v1/bookings?${ctx.bPage}`, null, { token: saved.historyUsers[key].token, kind: 'booking_history' });
        if (exec.scenario.name === 'measure') {
            if (slot === 0) t100.add(res.timings.duration);
            else if (slot === 1) t500.add(res.timings.duration);
            else {
                t2000.add(res.timings.duration);
                t2000Bytes.add(res.body ? res.body.length : 0);
            }
        }
    } else if (ctx.admin) {
        apiRequest('GET', `/api/v1/admin/auditoriums?${ctx.aPage}`, null, { token: ctx.admin, kind: 'auditorium_list' });
    }
}

export function handleSummary(result) {
    const v = (k) => result.metrics[k]?.values || {};
    const p100 = v('history_tier_100_latency')['p(95)'] || null;
    const p500 = v('history_tier_500_latency')['p(95)'] || null;
    const p2000 = v('history_tier_2000_latency')['p(95)'] || null;
    return buildSummary('k4-history-pagination', result, {
        measureDurationSeconds: DURATION,
        historyLatencyP95Ms: { tier100: p100, tier500: p500, tier2000: p2000, ratio2000vs100: p100 && p2000 ? Number((p2000 / p100).toFixed(2)) : null },
        tier2000AvgBytes: v('history_tier_2000_bytes').avg ?? null,
    });
}
