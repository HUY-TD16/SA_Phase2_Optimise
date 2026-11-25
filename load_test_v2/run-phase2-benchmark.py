#!/usr/bin/env python3
"""Orchestrates Phase 2 k6 benchmarks (`k1`..`k6`) with PostgreSQL, Redis, Prometheus & /proc CPU/RSS telemetry."""
import argparse, csv, datetime as dt, json, os, pathlib, platform, re, subprocess, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
SUITE = ROOT / "load_test_v2"
SCENARIOS = {
    "k1": "k1-read-scalability.js",
    "k2": "k2-parallel-booking.js",
    "k3": "k3-contention-atomicity.js",
    "k4": "k4-history-pagination.js",
    "k5": "k5-resilience-security.js",
    "k6": "k6-mixed-peak-soak.js",
}
WRITE_SCS = {"k2", "k3", "k5", "k6"}


def sh(cmd, timeout=20, env=None):
    try:
        r = subprocess.run(cmd, cwd=ROOT, env=env or os.environ.copy(), text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
        return r.returncode, r.stdout.strip()
    except Exception as e:
        return 1, str(e)


def pg_cfg():
    m = re.match(r"^jdbc:postgresql://([^:/]+)(?::(\d+))?/([^?]+)", os.environ.get("DB_URL", ""))
    return {
        "h": os.environ.get("PGHOST") or (m.group(1) if m else "127.0.0.1"),
        "p": os.environ.get("PGPORT") or (m.group(2) if m and m.group(2) else "5432"),
        "d": os.environ.get("PGDATABASE") or (m.group(3) if m else "cinema_load"),
        "u": os.environ.get("PGUSER") or os.environ.get("DB_USERNAME") or "cinema_load",
        "pw": os.environ.get("PGPASSWORD") or os.environ.get("DB_PASSWORD") or "cinema_load_pw",
    }


def psql(sql=None, file_path=None):
    pg = pg_cfg()
    env = {**os.environ, "PGPASSWORD": pg["pw"]}
    args = ["psql", "-h", pg["h"], "-p", str(pg["p"]), "-U", pg["u"], "-d", pg["d"], "-v", "ON_ERROR_STOP=1", "-qAt"]
    args += ["-f", str(file_path)] if file_path else ["-c", sql]
    return sh(args, env=env)


def snap_pg():
    pg = pg_cfg()
    code, out = psql(f"""SELECT json_build_object(
        'xactCommit', xact_commit, 'tupFetched', tup_fetched, 'tupReturned', tup_returned,
        'blksRead', blks_read, 'blksHit', blks_hit, 'deadlocks', deadlocks
    )::text FROM pg_stat_database WHERE datname='{pg["d"]}';""")
    try:
        return json.loads(out.splitlines()[-1]) if code == 0 and out else None
    except Exception:
        return None


def snap_redis():
    code, out = sh(["redis-cli", "-h", os.environ.get("REDIS_HOST", "127.0.0.1"), "-p", os.environ.get("REDIS_PORT", "6379"), "INFO", "stats"], timeout=5)
    if code != 0 or not out:
        return None
    kv = {k: int(v) for line in out.splitlines() if ":" in line and not line.startswith("#") for k, v in [line.split(":", 1)] if v.strip().isdigit()}
    return kv or None


def snap_prom(base_url):
    try:
        with urllib.request.urlopen(base_url.rstrip("/") + "/actuator/prometheus", timeout=2) as r:
            text = r.read().decode("utf-8", errors="replace") if r.status == 200 else ""
    except Exception:
        return None
    m = {"gcCount": 0.0, "gcSum": 0.0, "hikariTimeout": 0.0, "cacheHit": 0.0, "cacheMiss": 0.0, "heapBytes": 0.0}
    for ln in text.splitlines():
        if not ln or ln.startswith("#"):
            continue
        parts = ln.split()
        if len(parts) < 2:
            continue
        k, val = parts[0], float(parts[1])
        if k.startswith("jvm_gc_pause_seconds_count"): m["gcCount"] += val
        elif k.startswith("jvm_gc_pause_seconds_sum"): m["gcSum"] += val
        elif k.startswith("hikaricp_connections_timeout_total"): m["hikariTimeout"] += val
        elif k.startswith("cache_gets_total") and 'result="hit"' in k: m["cacheHit"] += val
        elif k.startswith("cache_gets_total") and 'result="miss"' in k: m["cacheMiss"] += val
        elif k.startswith("jvm_memory_used_bytes") and 'area="heap"' in k: m["heapBytes"] += val
    return m


def proc_tree(roots):
    proc = pathlib.Path("/proc")
    if not proc.exists() or not roots:
        return {}
    tbl = {}
    for e in proc.iterdir():
        if e.name.isdigit():
            try:
                st = (e / "stat").read_text()
                f = st[st.rfind(")") + 2:].split()
                rss = next((int(l.split()[1]) for l in (e / "status").read_text().splitlines() if l.startswith("VmRSS:")), 0)
                tbl[int(e.name)] = (int(f[1]), int(f[11]) + int(f[12]), rss)
            except Exception:
                pass
    pids = {p for p in roots if p in tbl}
    changed = True
    while changed:
        changed = False
        for pid, (ppid, _, _) in tbl.items():
            if ppid in pids and pid not in pids:
                pids.add(pid)
                changed = True
    return {p: tbl[p] for p in pids}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", default="phase2")
    ap.add_argument("--scenarios", nargs="+", default=list(SCENARIOS.keys()), choices=list(SCENARIOS.keys()))
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--warmup", type=int, default=15)
    ap.add_argument("--duration", type=int, default=60)
    ap.add_argument("--k6", default=os.environ.get("K6", "k6"))
    ap.add_argument("--base-url", default=os.environ.get("BASE_URL", "http://127.0.0.1:8080"))
    ap.add_argument("--fixtures", default=os.environ.get("FIXTURES", str(SUITE / "fixtures.local.json")))
    ap.add_argument("--api-pids", default=os.environ.get("API_PIDS") or os.environ.get("API_PID", ""))
    ap.add_argument("--database-pid", type=int, default=int(os.environ.get("DATABASE_PID", "0")))
    ap.add_argument("--redis-pid", type=int, default=int(os.environ.get("REDIS_PID", "0")))
    ap.add_argument("--nginx-pid", type=int, default=int(os.environ.get("NGINX_PID", "0")))
    ap.add_argument("--strict-phase2", action="store_true")
    args = ap.parse_args()

    _, commit = sh(["git", "rev-parse", "HEAD"])
    cpu_cnt = os.cpu_count() or 1
    slug = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + re.sub(r"[^a-zA-Z0-9._-]+", "-", args.label)
    run_root = SUITE / "results" / slug
    run_root.mkdir(parents=True, exist_ok=True)
    api_pids = [int(x) for x in str(args.api_pids).split(",") if x.strip().isdigit() and int(x) > 0]

    _, pg_ver = psql("SELECT version();")
    env_meta = {
        "label": args.label, "git": {"commit": commit}, "collectedAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "hardware": {"os": platform.platform(), "logicalCpuCount": cpu_cnt},
        "versions": {
            "java": sh(["java", "-version"])[1].splitlines()[0],
            "postgres": pg_ver.splitlines()[0] if pg_ver else sh(["postgres", "--version"])[1].splitlines()[0],
            "redis": sh(["redis-server", "--version"])[1].splitlines()[0],
            "k6": sh([args.k6, "version"])[1].splitlines()[0],
        },
    }
    (run_root / "environment.json").write_text(json.dumps(env_meta, indent=2) + "\n", encoding="utf-8")

    clk = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
    for sc in args.scenarios:
        for rep in range(1, args.repeats + 1):
            name = f"{sc}-run{rep}"
            summary_path = run_root / f"{name}.json"
            sh(["node", str(SUITE / "reset-state.mjs")], timeout=30, env={**os.environ, "BASE_URL": args.base_url, "FIXTURES": args.fixtures})

            pg0, rd0, pr0 = snap_pg(), snap_redis(), snap_prom(args.base_url)
            k6_env = {
                **os.environ, "BASE_URL": args.base_url, "FIXTURES": str(pathlib.Path(args.fixtures).resolve()),
                "WARMUP_SECONDS": str(args.warmup), "DURATION_SECONDS": str(args.duration),
                "GIT_COMMIT": commit, "VARIANT_LABEL": args.label,
                "STRICT_PHASE2": "true" if args.strict_phase2 else "false", "SUMMARY_PATH": str(summary_path),
            }
            samples, prev_ticks, prev_t = {}, {}, time.monotonic()
            with (run_root / f"{name}.log").open("w", encoding="utf-8") as log_fp, (run_root / f"{name}-resources.csv").open("w", newline="", encoding="utf-8") as csv_fp:
                w = csv.DictWriter(csv_fp, fieldnames=("timestampUtc", "group", "cpuPercentMachine", "summedRssMiB"))
                w.writeheader()
                proc = subprocess.Popen([args.k6, "run", "--include-system-env-vars", str(SUITE / SCENARIOS[sc])], cwd=ROOT, env=k6_env, stdout=log_fp, stderr=subprocess.STDOUT)
                groups = {"api": api_pids, "database": [args.database_pid] if args.database_pid else [], "redis": [args.redis_pid] if args.redis_pid else [], "nginx": [args.nginx_pid] if args.nginx_pid else [], "k6": [proc.pid]}
                while proc.poll() is None:
                    now = time.monotonic()
                    dt_s = max(now - prev_t, 0.001)
                    ts = dt.datetime.now(dt.timezone.utc).isoformat()
                    for gname, roots in groups.items():
                        tree = proc_tree(roots)
                        ticks, rss = sum(v[1] for v in tree.values()), sum(v[2] for v in tree.values()) / 1024.0
                        if gname in prev_ticks and tree:
                            cpu = round(max(ticks - prev_ticks[gname], 0) / clk / dt_s / cpu_cnt * 100.0, 2)
                            w.writerow({"timestampUtc": ts, "group": gname, "cpuPercentMachine": cpu, "summedRssMiB": round(rss, 2)})
                            samples.setdefault(gname, []).append((cpu, rss))
                        prev_ticks[gname] = ticks
                    prev_t = now
                    time.sleep(1.0)
                exit_code = proc.wait()

            pg1, rd1, pr1 = snap_pg(), snap_redis(), snap_prom(args.base_url)
            inv_code, inv_out = psql(file_path=SUITE / "sql" / "verify-invariants.sql") if sc in WRITE_SCS else (0, "")
            inv = next((json.loads(l.split("INVARIANT_JSON=", 1)[1]) for l in inv_out.splitlines() if "INVARIANT_JSON=" in l), {"allInvariantsPassed": inv_code == 0}) if sc in WRITE_SCS else None

            if summary_path.exists():
                doc = json.loads(summary_path.read_text(encoding="utf-8"))
                doc["metadata"]["k6ExitCode"] = exit_code
                pg_d = {k: max(0, pg1[k] - pg0[k]) for k in pg0} if pg0 and pg1 else None
                rd_h, rd_m = (max(0, rd1.get("keyspace_hits", 0) - rd0.get("keyspace_hits", 0)), max(0, rd1.get("keyspace_misses", 0) - rd0.get("keyspace_misses", 0))) if rd0 and rd1 else (0, 0)
                pr_h, pr_m = (max(0.0, pr1["cacheHit"] - pr0["cacheHit"]), max(0.0, pr1["cacheMiss"] - pr0["cacheMiss"])) if pr0 and pr1 else (0.0, 0.0)
                doc["telemetry"] = {
                    "postgresDelta": pg_d,
                    "redisDelta": {"hitRatio": round(rd_h / (rd_h + rd_m), 4) if (rd_h + rd_m) > 0 else None} if rd0 and rd1 else None,
                    "prometheusDelta": {
                        "gcPauseMsDelta": round(max(0.0, pr1["gcSum"] - pr0["gcSum"]) * 1000.0, 2),
                        "hikariTimeoutDelta": int(max(0.0, pr1["hikariTimeout"] - pr0["hikariTimeout"])),
                        "l1CacheHitRatio": round(pr_h / (pr_h + pr_m), 4) if (pr_h + pr_m) > 0 else None,
                    } if pr0 and pr1 else None,
                    "resources": {g: {"cpuAvgPct": round(sum(x[0] for x in v) / len(v), 2), "rssPeakMiB": round(max(x[1] for x in v), 2)} for g, v in samples.items() if v},
                    "dbInvariants": inv,
                }
                summary_path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
                m = doc["metadata"]
                print(f"[{name}] exit={exit_code} | rps={m['measuredThroughputRps']:.1f} | bookings/s={m['successfulBookingsPerSec']:.1f} | inv={inv.get('allInvariantsPassed') if inv else 'N/A'}")

    print(f"[benchmark-v2] Saved results -> {run_root}")


if __name__ == "__main__":
    main()
