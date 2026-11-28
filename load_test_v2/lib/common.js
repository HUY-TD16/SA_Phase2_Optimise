import http from 'k6/http';
import exec from 'k6/execution';
import { check, fail } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const BASE = (__ENV.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
export const WARMUP = Number(__ENV.WARMUP_SECONDS ?? 15);
export const DURATION = Number(__ENV.DURATION_SECONDS ?? 60);
export const STRICT_PHASE2 = (__ENV.STRICT_PHASE2 || 'false').toLowerCase() === 'true';

export const measuredRequests = new Counter('measured_requests');
export const successfulBookings = new Counter('successful_bookings');
export const expectedConflicts409 = new Counter('expected_conflicts_409');
export const legacyConflicts = new Counter('legacy_conflict_errors');
export const rateLimited429 = new Counter('rate_limited_429');
export const contractEnvelopeOk = new Rate('contract_envelope_compliant');
export const technicalErrors = new Rate('measured_technical_error');
export const businessErrors = new Rate('measured_business_error');

export const readLatency = new Trend('measured_read_latency', true);
export const bookingLatency = new Trend('measured_booking_latency', true);
export const seatMapLatency = new Trend('seat_map_latency', true);
export const auditoriumListLatency = new Trend('auditorium_list_latency', true);
export const payloadBytesTrend = new Trend('response_payload_bytes', false);

const MAX_TRACKED_STAGES = 8;
const stageReqs = Array.from({ length: MAX_TRACKED_STAGES }, (_, i) => new Counter(`stage_${i}_reqs`));
const stageBooks = Array.from({ length: MAX_TRACKED_STAGES }, (_, i) => new Counter(`stage_${i}_bookings`));
const stageLatency = Array.from({ length: MAX_TRACKED_STAGES }, (_, i) => new Trend(`stage_${i}_latency`, true));
let activeStagePlan = null;

export function buildStepStages(csvEnv, fallbackTargets = null) {
    const raw = csvEnv ? csvEnv.split(',').map(Number).filter((n) => n > 0) : (fallbackTargets || []);
    const targets = raw.slice(0, MAX_TRACKED_STAGES);
    if (!targets.length) return null;
    const totalBudget = Math.max(DURATION, targets.length * 8);
    const slotSec = Math.max(8, Math.floor(totalBudget / targets.length));
    const rampSec = Math.min(2, Math.max(1, Math.floor(slotSec * 0.2)));
    const holdSec = Math.max(6, slotSec - rampSec);
    const stages = [];
    const windows = [];
    let cursor = 0;
    targets.forEach((target, idx) => {
        if (idx === 0) {
            stages.push({ target, duration: `${slotSec}s` });
            windows.push({ index: idx, targetRps: target, startSec: 0, endSec: slotSec, holdSec: slotSec });
            cursor += slotSec;
        } else {
            stages.push({ target, duration: `${rampSec}s` });
            stages.push({ target, duration: `${holdSec}s` });
            windows.push({ index: idx, targetRps: target, startSec: cursor + rampSec, endSec: cursor + rampSec + holdSec, holdSec });
            cursor += rampSec + holdSec;
        }
    });
    activeStagePlan = { targets, stages, startRate: targets[0], totalDurationSec: cursor, windows };
    return activeStagePlan;
}

let measureStartMs = 0;

function resolveStageWindow() {
    if (!activeStagePlan) return null;
    if (!measureStartMs) measureStartMs = Date.now();
    const elapsedSec = (Date.now() - measureStartMs) / 1000;
    return activeStagePlan.windows.find((w) => elapsedSec >= w.startSec && elapsedSec < w.endSec) || null;
}

export function parseJson(res) {
    if (!res || !res.body) return null;
    try { return res.json(); } catch (_) { return null; }
}

export function unwrapData(resOrBody) {
    const b = resOrBody?.status !== undefined ? parseJson(resOrBody) : resOrBody;
    return b && typeof b === 'object' && b.data !== undefined ? b.data : b;
}

export function unwrapList(resOrBody) {
    const b = resOrBody?.status !== undefined ? parseJson(resOrBody) : resOrBody;
    if (Array.isArray(b)) return b;
    return b && (Array.isArray(b.data) ? b.data : Array.isArray(b.content) ? b.content : null);
}

export function extractBookingId(resOrBody) {
    const d = unwrapData(resOrBody);
    return d && typeof d === 'object' ? (d.bookingId || d.id || null) : null;
}

export function extractErrorCode(resOrBody) {
    const b = resOrBody?.status !== undefined ? parseJson(resOrBody) : resOrBody;
    return b?.error?.code || b?.errorCode || b?.code || null;
}

export function apiRequest(method, path, payload, opts = {}) {
    const { token = null, expected = [200], kind = 'read', phaseOverride = null, extraHeaders = {} } = opts;
    let phase = phaseOverride;
    if (!phase) {
        try { phase = exec.scenario.name === 'warmup' ? 'warmup' : 'measure'; } catch (_) { phase = 'setup'; }
    }
    const route = path.split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id');
    const headers = Object.assign(
        { 'Accept-Encoding': 'gzip, deflate' },
        payload != null ? { 'Content-Type': 'application/json' } : {},
        token ? { Authorization: 'Bearer ' + token } : {},
        extraHeaders
    );
    const res = http.request(method, BASE + path, payload == null ? null : JSON.stringify(payload), {
        headers,
        tags: { name: `${method} ${route}`, kind, phase },
        responseCallback: http.expectedStatuses(...expected),
    });

    const ok = expected.includes(res.status);
    check(res, { 'status matches contract': () => ok }, { phase, kind });

    if (phase === 'measure') {
        measuredRequests.add(1);
        payloadBytesTrend.add(res.body ? res.body.length : 0);
        technicalErrors.add(res.status === 0 || res.status >= 500);
        businessErrors.add(!ok && res.status >= 400 && res.status < 500);
        if (res.status === 429) rateLimited429.add(1);
        if (kind === 'booking') bookingLatency.add(res.timings.duration);
        else if (kind !== 'booking_cancel') readLatency.add(res.timings.duration);
        if (kind === 'seat_map') seatMapLatency.add(res.timings.duration);
        if (kind === 'auditorium_list') auditoriumListLatency.add(res.timings.duration);
        const sw = resolveStageWindow();
        if (sw) {
            stageReqs[sw.index].add(1);
            stageLatency[sw.index].add(res.timings.duration);
            if (kind === 'booking' && res.status === 201) stageBooks[sw.index].add(1);
        }
    }
    return res;
}

export function openArrivalOptions({
    execFn = 'traffic', rate = Number(__ENV.RATE || 300), stages = null, stagePlan = null,
    preAllocatedVUs = Number(__ENV.PRE_ALLOCATED_VUS || 100),
    maxVUs = Number(__ENV.MAX_VUS || 350), thresholds = {},
} = {}) {
    const useStages = stagePlan?.stages || stages;
    const initRate = stagePlan?.startRate || (useStages?.length ? useStages[0].target : rate);
    const scenarios = {};
    if (WARMUP > 0) {
        scenarios.warmup = {
            executor: 'constant-arrival-rate', rate: Math.max(15, Math.floor(initRate * 0.5)),
            timeUnit: '1s', duration: `${WARMUP}s`, preAllocatedVUs: Math.min(preAllocatedVUs, 50),
            maxVUs: Math.min(maxVUs, 150), exec: execFn, gracefulStop: '2s',
        };
    }
    const startTime = WARMUP > 0 ? `${WARMUP + 2}s` : '0s';
    scenarios.measure = useStages?.length
        ? { executor: 'ramping-arrival-rate', startRate: initRate, timeUnit: '1s', preAllocatedVUs, maxVUs, stages: useStages, startTime, exec: execFn, gracefulStop: '5s' }
        : { executor: 'constant-arrival-rate', rate, timeUnit: '1s', duration: `${DURATION}s`, preAllocatedVUs, maxVUs, startTime, exec: execFn, gracefulStop: '5s' };

    return {
        scenarios,
        thresholds: Object.assign({ measured_technical_error: ['rate<0.10'] }, thresholds),
        summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
    };
}

export function loadFixtures() {
    const p = __ENV.FIXTURES || 'load_test_v2/fixtures.local.json';
    try { return JSON.parse(open(p)); } catch (_) { fail(`Missing fixtures at ${p}. Run seed.mjs first.`); }
}

export function detectPaginationQuery(path, token, size = 20) {
    const r = apiRequest('GET', `${path}?page=0&size=${size}`, null, { token, expected: [200, 400, 422], phaseOverride: 'setup' });
    return r.status === 200 ? `page=0&size=${size}` : `page=1&pageSize=${size}&size=${size}`;
}

export function buildSummary(script, result, extra = {}) {
    const v = (k) => result.metrics[k]?.values || {};
    const dur = Number(extra.measureDurationSeconds || activeStagePlan?.totalDurationSec || DURATION || 1);
    const reqs = v('measured_requests').count || 0;
    const books = v('successful_bookings').count || 0;
    const slaMs = script.includes('booking') ? Number(__ENV.SLA_BOOKING_P95_MS || 500) : Number(__ENV.SLA_READ_P95_MS || 250);

    let stageCeiling = null;
    if (activeStagePlan?.windows?.length) {
        const steps = activeStagePlan.windows.map((w) => {
            const cnt = v(`stage_${w.index}_reqs`).count || 0;
            const bCnt = v(`stage_${w.index}_bookings`).count || 0;
            const p95 = v(`stage_${w.index}_latency`)['p(95)'] ?? null;
            const rps = w.holdSec > 0 ? Number((cnt / w.holdSec).toFixed(2)) : 0;
            const bps = w.holdSec > 0 ? Number((bCnt / w.holdSec).toFixed(2)) : 0;
            const slaOk = cnt > 0 && p95 !== null && p95 <= slaMs && rps >= w.targetRps * 0.85;
            return { stage: w.index + 1, targetRps: w.targetRps, achievedRps: rps, achievedBookingsPerSec: bps, p95Ms: p95 !== null ? Number(p95.toFixed(2)) : null, slaOk };
        });
        const peakStep = steps.reduce((best, cur) => (cur.achievedRps > (best?.achievedRps || 0) ? cur : best), null);
        const peakBookStep = steps.reduce((best, cur) => (cur.achievedBookingsPerSec > (best?.achievedBookingsPerSec || 0) ? cur : best), null);
        const slaSteps = steps.filter((s) => s.slaOk);
        const maxSlaStep = slaSteps.length ? slaSteps[slaSteps.length - 1] : null;
        stageCeiling = {
            slaThresholdP95Ms: slaMs,
            peakAchievedRps: peakStep?.achievedRps || 0,
            peakTargetRps: peakStep?.targetRps || 0,
            peakP95Ms: peakStep?.p95Ms ?? null,
            peakBookingsPerSec: peakBookStep?.achievedBookingsPerSec || 0,
            maxSlaRps: maxSlaStep?.achievedRps || 0,
            maxSlaBookingsPerSec: maxSlaStep?.achievedBookingsPerSec || 0,
            maxSlaP95Ms: maxSlaStep?.p95Ms ?? null,
            steps,
        };
    }

    const avgRps = dur > 0 ? reqs / dur : 0;
    const avgBps = dur > 0 ? books / dur : 0;
    const metadata = Object.assign({
        suite: 'load_test_v2', script, measuredAt: new Date().toISOString(),
        gitCommit: __ENV.GIT_COMMIT || 'unrecorded', label: __ENV.VARIANT_LABEL || 'unspecified',
        durationSeconds: dur, measuredRequests: reqs, measuredThroughputRps: avgRps,
        peakStageRps: stageCeiling ? stageCeiling.peakAchievedRps : avgRps,
        maxSlaRps: stageCeiling ? stageCeiling.maxSlaRps : null,
        successfulBookings: books, successfulBookingsPerSec: avgBps,
        peakStageBookingsPerSec: stageCeiling ? stageCeiling.peakBookingsPerSec : avgBps,
        maxSlaBookingsPerSec: stageCeiling ? stageCeiling.maxSlaBookingsPerSec : null,
        stageCeiling,
        expectedConflicts409: v('expected_conflicts_409').count || 0,
        legacyConflictErrors: v('legacy_conflict_errors').count || 0,
        rateLimited429: v('rate_limited_429').count || 0,
        droppedIterations: v('dropped_iterations').count || 0,
        technicalErrorRate: v('measured_technical_error').rate || 0,
        latenciesMs: {
            readP50: v('measured_read_latency').med ?? null,
            readP95: v('measured_read_latency')['p(95)'] ?? null,
            readP99: v('measured_read_latency')['p(99)'] ?? null,
            bookingP50: v('measured_booking_latency').med ?? null,
            bookingP95: v('measured_booking_latency')['p(95)'] ?? null,
            bookingP99: v('measured_booking_latency')['p(99)'] ?? null,
            seatMapP95: v('seat_map_latency')['p(95)'] ?? null,
            auditoriumListP95: v('auditorium_list_latency')['p(95)'] ?? null,
        },
        avgPayloadBytes: v('response_payload_bytes').avg ?? null,
    }, extra);

    const outPath = __ENV.SUMMARY_PATH || `load_test_v2/results/${script}-${Date.now()}.json`;
    const ceilingNote = stageCeiling ? ` | peak_rps=${stageCeiling.peakAchievedRps.toFixed(1)} | sla_rps=${stageCeiling.maxSlaRps.toFixed(1)}` : '';
    return {
        stdout: `[${script}] reqs=${reqs} | avg_rps=${metadata.measuredThroughputRps.toFixed(1)}${ceilingNote} | bookings/s=${metadata.successfulBookingsPerSec.toFixed(1)} | read_p95=${(metadata.latenciesMs.readP95 || 0).toFixed(2)}ms | book_p95=${(metadata.latenciesMs.bookingP95 || 0).toFixed(2)}ms\n`,
        [outPath]: JSON.stringify({ metadata, summary: result }, null, 2),
    };
}
