#!/usr/bin/env node
/** Self-check for `load_test_v2`: validates JS/k6 syntax, JWT minting, Python bytecode (`-B`), and Before/After report generation. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mintJwt } from '../seed.mjs';

const SUITE = path.resolve(import.meta.dirname, '..');
const jsFiles = [
    'lib/common.js', 'seed.mjs', 'reset-state.mjs',
    'k1-read-scalability.js', 'k2-parallel-booking.js', 'k3-contention-atomicity.js',
    'k4-history-pagination.js', 'k5-resilience-security.js', 'k6-mixed-peak-soak.js',
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-check-'));
try {
    for (const rel of jsFiles) {
        const src = fs.readFileSync(path.join(SUITE, rel), 'utf8')
            .replace(/from\s+['"]k6(?:\/[^'"]+)?['"]/g, "from 'node:os'")
            .replace(/from\s+['"]\.\/lib\/common\.js['"]/g, "from 'node:os'");
        const f = path.join(tmp, path.basename(rel).replace(/\.js$/, '.mjs'));
        fs.writeFileSync(f, src);
        execFileSync(process.execPath, ['--check', f]);
    }

    const uid = crypto.randomUUID();
    const tok = mintJwt(uid, 'CUSTOMER', 'self-check-secret-key-with-at-least-32-bytes!!');
    const claims = JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(claims.sub, uid);
    assert.ok(claims.jti);

    const bDir = path.join(tmp, 'before');
    const aDir = path.join(tmp, 'after');
    fs.mkdirSync(bDir);
    fs.mkdirSync(aDir);
    fs.writeFileSync(path.join(bDir, 'environment.json'), JSON.stringify({ git: { commit: '21eec61000' }, hardware: { logicalCpuCount: 4 } }));
    fs.writeFileSync(path.join(aDir, 'environment.json'), JSON.stringify({ git: { commit: 'phase20000' }, hardware: { logicalCpuCount: 4 } }));
    const mkRun = (rps, bps, p95, tup) => JSON.stringify({
        metadata: { script: 'k2-parallel-booking', measuredRequests: rps * 60, measuredThroughputRps: rps, successfulBookingsPerSec: bps, latenciesMs: { bookingP95: p95 } },
        telemetry: { postgresDelta: { tupFetched: tup }, resources: { api: { cpuAvgPct: 45 }, database: { cpuAvgPct: 20 } } },
    });
    fs.writeFileSync(path.join(bDir, 'k2-run1.json'), mkRun(45, 45, 310, 900000));
    fs.writeFileSync(path.join(aDir, 'k2-run1.json'), mkRun(210, 210, 9.5, 70000));

    const outMd = path.join(tmp, 'report.md');
    const outCsv = path.join(tmp, 'summary.csv');
    execFileSync('python', ['-B', path.join(SUITE, 'compare-results.py'), '--before', bDir, '--after', aDir, '--output-md', outMd, '--output-csv', outCsv]);
    execFileSync('python', ['-B', '-c', "import ast, pathlib; [ast.parse(pathlib.Path(p).read_text('utf-8')) for p in ('load_test_v2/run-phase2-benchmark.py','load_test_v2/compare-results.py')]"]);
    assert.ok(fs.readFileSync(outMd, 'utf8').includes('4.67x'));

    const nb = JSON.parse(fs.readFileSync(path.join(SUITE, 'cinema-kaggle-phase2.ipynb'), 'utf8'));
    assert.equal(nb.cells.length, 8);
    console.log('ALL `load_test_v2` CHECKS PASSED!');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
