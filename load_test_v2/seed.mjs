#!/usr/bin/env node
/**
 * Concise Phase 2 Benchmark Seeder (`load_test_v2/seed.mjs`)
 * Seeds movies (with soft-deleted rows), 30 auditoriums, a 12,000-seat hot showtime for parallel
 * multi-seat writes, multi-wave contention/overlap seats, and 100/500/2,000-booking history accounts.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const OUTPUT = path.resolve(process.env.FIXTURES || 'load_test_v2/fixtures.local.json');
const QUICK = process.env.SEED_PROFILE === 'quick';
const CFG = QUICK
    ? { movies: 200, deleted: 40, rooms: 8, users: 60, contenders: 30, batches: 400, seatsPerBatch: 4, waves: 15, tiers: [20, 100, 300] }
    : { movies: 3000, deleted: 600, rooms: 30, users: 200, contenders: 100, batches: 3000, seatsPerBatch: 4, waves: 60, tiers: [100, 500, 2000] };

const PASSWORD = process.env.LOAD_PASSWORD || 'load-test-123';
const JWT_SECRET = process.env.JWT_SECRET || '';
const PREFIX = 'v2-' + Date.now().toString(36);

export function mintJwt(userId, role = 'CUSTOMER', secret = JWT_SECRET, expSec = 14400) {
    const now = Math.floor(Date.now() / 1000) - 1;
    const b64 = (v) => Buffer.from(v).toString('base64url');
    const unsigned = `${b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64(JSON.stringify({ sub: userId, role, jti: crypto.randomUUID(), iat: now, exp: now + expSec }))}`;
    const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(unsigned).digest('base64url');
    return `${unsigned}.${sig}`;
}

export function parsePgEnv() {
    const m = (process.env.DB_URL || '').match(/^jdbc:postgresql:\/\/([^:/]+)(?::(\d+))?\/([^?]+)/);
    return {
        host: process.env.PGHOST || m?.[1] || '127.0.0.1',
        port: process.env.PGPORT || m?.[2] || '5432',
        db: process.env.PGDATABASE || m?.[3] || 'cinema_load',
        user: process.env.PGUSER || process.env.DB_USERNAME || 'cinema_load',
        password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'cinema_load_pw',
    };
}

export function psql(pg, sql) {
    return execFileSync('psql', ['-h', pg.host, '-p', String(pg.port), '-U', pg.user, '-d', pg.db, '-v', 'ON_ERROR_STOP=1', '-qAt'], {
        input: sql, env: { ...process.env, PGPASSWORD: pg.password }, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    }).trim();
}

async function api(method, route, body, token, expected = [200]) {
    const res = await fetch(BASE + route, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await res.text();
    const parsed = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return raw; } })() : null;
    if (!expected.includes(res.status)) throw new Error(`${method} ${route} -> ${res.status}: ${raw}`);
    return parsed?.data !== undefined ? parsed.data : parsed;
}

async function main() {
    const t0 = Date.now();
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    const adminCreds = {
        username: process.env.ADMIN_USERNAME || process.env.DEMO_ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || process.env.DEMO_ADMIN_PASSWORD || 'demo-pass-1234',
    };
    const adminToken = process.env.ADMIN_TOKEN || (await api('POST', '/api/v1/auth/login', adminCreds)).accessToken;

    // Register 1 template user via API so Spring generates the exact BCrypt hash
    const tpl = await api('POST', '/api/v1/auth/register', { username: `${PREFIX}-tpl`, password: PASSWORD }, null, [201]);
    const pg = parsePgEnv();
    const pwHash = psql(pg, `SELECT password_hash FROM users WHERE id = '${tpl.id}'::uuid;`).replace(/'/g, "''");

    const cols = new Set(psql(pg, `SELECT table_name||'.'||column_name FROM information_schema.columns WHERE table_name IN ('bookings','booking_seats');`).split(/\r?\n/));
    const seatMapRoomId = crypto.randomUUID();
    const hotRoomId = crypto.randomUUID();
    const contRoomId = crypto.randomUUID();
    const histRoomId = crypto.randomUUID();

    const plus48h = new Date(Date.now() + 48 * 3600_000);
    const plus72h = new Date(Date.now() + 72 * 3600_000);
    const plus15m = new Date(Date.now() + 15 * 60_000);
    const seatMapShowtimeId = crypto.randomUUID();
    const hotShowtimeId = crypto.randomUUID();
    const mixedShowtimeId = crypto.randomUUID();
    const contentionShowtimeId = crypto.randomUUID();
    const nearStartShowtimeId = crypto.randomUUID();

    const extraBookingCols = [
        cols.has('bookings.payment_status') ? 'payment_status' : null,
        cols.has('bookings.status') ? 'status' : null,
        cols.has('bookings.booking_code') ? 'booking_code' : null,
    ].filter(Boolean);
    const extraBookingVals = (seqExpr) => [
        cols.has('bookings.payment_status') ? `'PAID'` : null,
        cols.has('bookings.status') ? `'CONFIRMED'` : null,
        cols.has('bookings.booking_code') ? `'BK' || lpad((${seqExpr})::text, 8, '0')` : null,
    ].filter(Boolean);

    const maxHist = Math.max(...CFG.tiers);
    const contSeatsTotal = CFG.waves + Math.floor(CFG.waves / 2) * 7 + 4;

    // Seed entire dataset directly inside PostgreSQL using `generate_series` + `gen_random_uuid()`!
    psql(pg, `
BEGIN;
INSERT INTO movies (id, title, description, duration_minutes, age_rating, release_date, status, deleted_at, created_at, updated_at)
SELECT gen_random_uuid(), '${PREFIX} Movie ' || i, 'Benchmark dataset item ' || i, 120,
       (ARRAY['P','T13','T16','T18'])[1 + (i % 4)], DATE '2026-10-01',
       (ARRAY['NOW_SHOWING','NOW_SHOWING','NOW_SHOWING','COMING_SOON','ENDED'])[1 + (i % 5)],
       CASE WHEN i <= ${CFG.deleted} THEN now() ELSE NULL END,
       now() - (i || ' seconds')::interval, now()
FROM generate_series(1, ${CFG.movies}) AS g(i);

INSERT INTO auditoriums (id, name, status, deleted_at, created_at, updated_at) VALUES
  ('${seatMapRoomId}'::uuid, '${PREFIX}-seatmap', 'ACTIVE', NULL, now(), now()),
  ('${hotRoomId}'::uuid, '${PREFIX}-hot', 'ACTIVE', NULL, now(), now()),
  ('${contRoomId}'::uuid, '${PREFIX}-cont', 'ACTIVE', NULL, now(), now()),
  ('${histRoomId}'::uuid, '${PREFIX}-hist', 'ACTIVE', NULL, now(), now());

INSERT INTO auditoriums (id, name, status, deleted_at, created_at, updated_at)
SELECT gen_random_uuid(), '${PREFIX}-room-' || i, 'ACTIVE', NULL, now(), now()
FROM generate_series(1, ${CFG.rooms}) AS g(i);

INSERT INTO seats (id, auditorium_id, row_label, seat_number, type)
SELECT gen_random_uuid(), a.id, chr(65 + ((s - 1) / 25)), ((s - 1) % 25) + 1,
       CASE WHEN ((s - 1) / 25) = 9 THEN 'VIP' ELSE 'STANDARD' END
FROM auditoriums a CROSS JOIN generate_series(1, 250) AS g(s)
WHERE a.name LIKE '${PREFIX}-room-%' OR a.id = '${seatMapRoomId}'::uuid;

INSERT INTO seats (id, auditorium_id, row_label, seat_number, type)
SELECT gen_random_uuid(), '${hotRoomId}'::uuid, 'H' || ((s - 1) / 100), ((s - 1) % 100) + 1,
       CASE WHEN s % 4 = 0 THEN 'VIP' ELSE 'STANDARD' END
FROM generate_series(1, ${CFG.batches * CFG.seatsPerBatch}) AS g(s);

INSERT INTO seats (id, auditorium_id, row_label, seat_number, type)
SELECT gen_random_uuid(), '${contRoomId}'::uuid, 'C' || ((s - 1) / 50), ((s - 1) % 50) + 1, 'STANDARD'
FROM generate_series(1, ${contSeatsTotal}) AS g(s);

INSERT INTO seats (id, auditorium_id, row_label, seat_number, type)
SELECT gen_random_uuid(), '${histRoomId}'::uuid, 'Z', s, 'STANDARD'
FROM generate_series(1, 12) AS g(s);

INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
SELECT gen_random_uuid(), '${PREFIX}-load-' || i, '${pwHash}', 'CUSTOMER', now(), now()
FROM generate_series(1, ${CFG.users}) AS g(i);

INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
SELECT gen_random_uuid(), '${PREFIX}-cont-' || i, '${pwHash}', 'CUSTOMER', now(), now()
FROM generate_series(1, ${CFG.contenders}) AS g(i);

INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
SELECT gen_random_uuid(), '${PREFIX}-hist-' || t, '${pwHash}', 'CUSTOMER', now(), now()
FROM unnest(ARRAY[${CFG.tiers.join(',')}]) AS t;

WITH top_movies AS (
  SELECT id, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
  FROM movies WHERE title LIKE '${PREFIX} Movie %' AND deleted_at IS NULL LIMIT 15
), rooms_ord AS (
  SELECT id, row_number() OVER (ORDER BY name) AS rn
  FROM auditoriums WHERE name LIKE '${PREFIX}-room-%' LIMIT 15
)
INSERT INTO showtimes (id, movie_id, auditorium_id, starts_at, ends_at, base_price, status, created_at, updated_at)
SELECT gen_random_uuid(), m.id, r.id,
       '${plus48h.toISOString()}'::timestamptz + ((m.rn % 3) * interval '3 hours'),
       '${plus48h.toISOString()}'::timestamptz + ((m.rn % 3) * interval '3 hours') + interval '135 minutes',
       90000.00, 'SCHEDULED', now(), now()
FROM top_movies m JOIN rooms_ord r ON r.rn = m.rn
UNION ALL
SELECT gen_random_uuid(), m.id, r.id,
       '${plus48h.toISOString()}'::timestamptz + interval '10 hours',
       '${plus48h.toISOString()}'::timestamptz + interval '12 hours 15 minutes',
       90000.00, 'CANCELLED', now(), now()
FROM top_movies m JOIN rooms_ord r ON r.rn = m.rn WHERE m.rn <= 5;

WITH top_movie AS (SELECT id FROM movies WHERE title LIKE '${PREFIX} Movie %' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1)
INSERT INTO showtimes (id, movie_id, auditorium_id, starts_at, ends_at, base_price, status, created_at, updated_at)
SELECT s.id, top_movie.id, s.room_id, s.st, s.st + interval '135 minutes', 90000.00, 'SCHEDULED', now(), now()
FROM top_movie, (VALUES
  ('${seatMapShowtimeId}'::uuid, '${seatMapRoomId}'::uuid, '${plus48h.toISOString()}'::timestamptz),
  ('${hotShowtimeId}'::uuid, '${hotRoomId}'::uuid, '${plus48h.toISOString()}'::timestamptz),
  ('${mixedShowtimeId}'::uuid, '${hotRoomId}'::uuid, '${plus72h.toISOString()}'::timestamptz),
  ('${contentionShowtimeId}'::uuid, '${contRoomId}'::uuid, '${plus48h.toISOString()}'::timestamptz),
  ('${nearStartShowtimeId}'::uuid, '${contRoomId}'::uuid, '${plus15m.toISOString()}'::timestamptz)
) AS s(id, room_id, st);

WITH top_movie AS (SELECT id FROM movies WHERE title LIKE '${PREFIX} Movie %' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1)
INSERT INTO showtimes (id, movie_id, auditorium_id, starts_at, ends_at, base_price, status, created_at, updated_at)
SELECT gen_random_uuid(), top_movie.id, '${histRoomId}'::uuid,
       now() - interval '400 days' + (i * interval '3 hours'),
       now() - interval '400 days' + (i * interval '3 hours') + interval '135 minutes',
       90000.00, 'FINISHED', now(), now()
FROM top_movie, generate_series(1, ${maxHist}) AS g(i);
COMMIT;
`);

    // Seed historical bookings per tier user cleanly in SQL
    const histUsersRaw = psql(pg, `SELECT username, id FROM users WHERE username LIKE '${PREFIX}-hist-%';`).split(/\r?\n/).filter(Boolean);
    const historyUsers = {};
    let tierIdx = 0;
    for (const line of histUsersRaw) {
        const [username, userId] = line.split('|');
        const tierNum = Number(username.split('-').pop());
        const bCols = ['id', 'user_id', 'showtime_id', 'total_amount', 'created_at', ...extraBookingCols].join(', ');
        const extraV = extraBookingVals(`${tierIdx * 10000} + rn`);
        const bVals = ['b_id', `'${userId}'::uuid`, 'st_id', '180000.00', `now() - (rn || ' minutes')::interval`, ...extraV].join(', ');
        psql(pg, `
        WITH numbered_st AS (
            SELECT id AS st_id, row_number() OVER (ORDER BY starts_at) AS rn, gen_random_uuid() AS b_id
            FROM showtimes WHERE auditorium_id = '${histRoomId}'::uuid LIMIT ${tierNum}
        ), ins_b AS (
            INSERT INTO bookings (${bCols}) SELECT ${bVals} FROM numbered_st RETURNING id, showtime_id
        ), tier_seats AS (
            SELECT id AS seat_id FROM seats WHERE auditorium_id = '${histRoomId}'::uuid
            ORDER BY seat_number OFFSET ${tierIdx * 2} LIMIT 2
        )
        INSERT INTO booking_seats (id, booking_id, showtime_id, seat_id, price)
        SELECT gen_random_uuid(), ins_b.id, ins_b.showtime_id, tier_seats.seat_id, 90000.00
        FROM ins_b CROSS JOIN tier_seats;
        `);
        historyUsers[`tier_${tierNum}`] = { userId, username, token: mintJwt(userId) };
        tierIdx++;
    }
    psql(pg, 'ANALYZE;');

    const movieIds = psql(pg, `SELECT id FROM movies WHERE title LIKE '${PREFIX} Movie %' AND deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 500;`).split(/\r?\n/).filter(Boolean);
    const hotSeats = psql(pg, `SELECT id FROM seats WHERE auditorium_id = '${hotRoomId}'::uuid ORDER BY row_label, seat_number;`).split(/\r?\n/).filter(Boolean);
    const contSeats = psql(pg, `SELECT id FROM seats WHERE auditorium_id = '${contRoomId}'::uuid ORDER BY row_label, seat_number;`).split(/\r?\n/).filter(Boolean);
    const loadUsers = psql(pg, `SELECT id, username FROM users WHERE username LIKE '${PREFIX}-load-%';`).split(/\r?\n/).filter(Boolean).map((l) => {
        const [userId, username] = l.split('|');
        return { userId, username, token: mintJwt(userId) };
    });
    const contenders = psql(pg, `SELECT id, username FROM users WHERE username LIKE '${PREFIX}-cont-%';`).split(/\r?\n/).filter(Boolean).map((l) => {
        const [userId, username] = l.split('|');
        return { userId, username, token: mintJwt(userId) };
    });

    const verify = await api('GET', '/api/v1/users/me', undefined, loadUsers[0].token);
    if (verify?.id !== loadUsers[0].userId) throw new Error('Minted JWT verification failed');

    const parallelBatches = [];
    for (let i = 0; i + CFG.seatsPerBatch <= hotSeats.length; i += CFG.seatsPerBatch) {
        const s = hotSeats.slice(i, i + CFG.seatsPerBatch);
        parallelBatches.push(s.length >= 4 ? [s[2], s[0], s[3], s[1], ...s.slice(4)] : s.reverse());
    }
    const singleContentionSeatIds = contSeats.slice(0, CFG.waves);
    const overlapPairs = [];
    for (let i = CFG.waves; i + 7 <= contSeats.length - 4; i += 7) {
        const s = contSeats.slice(i, i + 7);
        overlapPairs.push({ seatIdsA: [s[0], s[1], s[2], s[3]], seatIdsB: [s[6], s[5], s[4], s[3]], exclusiveA: [s[0], s[1], s[2]], exclusiveB: [s[4], s[5], s[6]] });
    }

    const fixtures = {
        version: 2, prefix: PREFIX, baseUrl: BASE, adminCredentials: adminCreds, userPassword: PASSWORD,
        counts: { moviesActive: movieIds.length, moviesDeleted: CFG.deleted, parallelBatches: parallelBatches.length, seatsPerBatch: CFG.seatsPerBatch, contentionWaves: singleContentionSeatIds.length, historyTiers: CFG.tiers },
        movieIds, coldMovieIds: movieIds.slice(-150), dailyMovieIds: movieIds.slice(0, 15),
        showtimeDate: plus48h.toISOString().slice(0, 10),
        seatMapShowtimeId, hotShowtimeId, mixedShowtimeId, contentionShowtimeId, nearStartShowtimeId,
        nearStartSeats: contSeats.slice(-4), singleContentionSeatIds, overlapPairs, parallelBatches,
        loadUsers, contenders, historyUsers,
        transientShowtimeIds: [hotShowtimeId, mixedShowtimeId, contentionShowtimeId, nearStartShowtimeId],
    };
    fs.writeFileSync(OUTPUT, JSON.stringify(fixtures, null, 2) + '\n');
    console.log(`[seed-v2] Done in ${((Date.now() - t0) / 1000).toFixed(2)}s -> ${OUTPUT}`);
}

if (process.argv[1]?.endsWith('seed.mjs')) {
    main().catch((e) => { console.error('[seed-v2] ERROR:', e.message); process.exit(1); });
}
