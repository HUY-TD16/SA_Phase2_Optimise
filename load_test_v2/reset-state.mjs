#!/usr/bin/env node
/**
 * Fast Soft-Delete-Safe State Reset (`load_test_v2/reset-state.mjs`)
 * Wipes transient bookings on test showtimes (preserving `historyUsers` 100/500/2000 rows) + flushes Redis.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { parsePgEnv, psql } from './seed.mjs';

const saved = JSON.parse(fs.readFileSync(process.env.FIXTURES || 'load_test_v2/fixtures.local.json', 'utf8'));
const ids = (saved.transientShowtimeIds || []).map((id) => `'${id}'::uuid`).join(', ');
const pg = parsePgEnv();

psql(pg, `
DO $$
DECLARE tbl text;
BEGIN
    DELETE FROM booking_seats WHERE showtime_id IN (${ids});
    DELETE FROM bookings WHERE showtime_id IN (${ids});
    FOREACH tbl IN ARRAY ARRAY['idempotency_keys', 'booking_idempotency_keys', 'idempotency_records'] LOOP
        IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=tbl) THEN
            EXECUTE format('TRUNCATE TABLE %I', tbl);
        END IF;
    END LOOP;
END $$;
`);

let redisFlushed = false;
if (process.env.SKIP_REDIS_FLUSH !== 'true') {
    try {
        execFileSync('redis-cli', ['-h', process.env.REDIS_HOST || '127.0.0.1', '-p', process.env.REDIS_PORT || '6379', 'FLUSHALL'], { stdio: 'ignore' });
        redisFlushed = true;
    } catch (_) {}
}
console.log(`[reset-state] Clean (redisFlushed=${redisFlushed})`);
