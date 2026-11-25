#!/usr/bin/env python3
"""Generates a Markdown & CSV Before-vs-After comparison report from two `run-phase2-benchmark.py` folders."""
import argparse, csv, json, pathlib, statistics


def med(vals):
    clean = [float(v) for v in vals if v is not None]
    return round(statistics.median(clean), 3) if clean else None


def fmt(v, suf="", d=2):
    return "—" if v is None else f"{v:,.{d}f}{suf}"


def delta(b, a, lower_better=False):
    if not b or a is None:
        return "—"
    pct = ((a - b) / abs(b)) * 100.0
    if not lower_better and a > b > 0 and (a / b) >= 1.5:
        return f"**{a / b:.2f}x** ({pct:+.1f}%)"
    return f"**{pct:+.1f}%**"


def load_dir(path):
    p = pathlib.Path(path)
    env = json.loads((p / "environment.json").read_text(encoding="utf-8")) if (p / "environment.json").exists() else {}
    grouped = {}
    for f in sorted(p.glob("*.json")):
        if f.name not in ("environment.json", "manifest.json"):
            d = json.loads(f.read_text(encoding="utf-8"))
            if "metadata" in d:
                grouped.setdefault(f.stem.split("-run")[0], []).append(d)

    agg = {}
    vcpus = (env.get("hardware") or {}).get("logicalCpuCount") or 4
    for sc, runs in grouped.items():
        ms = [r["metadata"] for r in runs]
        ts = [r.get("telemetry") or {} for r in runs]
        ls = [m.get("latenciesMs") or {} for m in ms]
        pgs = [t.get("postgresDelta") or {} for t in ts if t.get("postgresDelta")]
        rs = [t.get("resources") or {} for t in ts]
        hs = [m.get("historyLatencyP95Ms") or {} for m in ms]
        ss = [m.get("securityAudit") or {} for m in ms]

        reqs = med([m.get("measuredRequests") for m in ms]) or 1.0
        tup = med([x.get("tupFetched") for x in pgs])
        rps = med([m.get("measuredThroughputRps") for m in ms])
        api_cpu = med([(x.get("api") or {}).get("cpuAvgPct") for x in rs if x.get("api")])
        db_cpu = med([(x.get("database") or {}).get("cpuAvgPct") for x in rs if x.get("database")])
        rd_cpu = med([(x.get("redis") or {}).get("cpuAvgPct") for x in rs if x.get("redis")])
        cores_used = sum(c or 0.0 for c in (api_cpu, db_cpu, rd_cpu)) / 100.0 * vcpus

        agg[sc] = {
            "script": ms[0].get("script", sc), "rps": rps,
            "bps": med([m.get("successfulBookingsPerSec") for m in ms]),
            "readP95": med([l.get("readP95") for l in ls]),
            "bookP95": med([l.get("bookingP95") for l in ls]),
            "seatP95": med([l.get("seatMapP95") for l in ls]),
            "audP95": med([l.get("auditoriumListP95") for l in ls]),
            "errPct": (med([m.get("technicalErrorRate") for m in ms]) or 0.0) * 100.0,
            "t100": med([h.get("tier100") for h in hs]), "t500": med([h.get("tier500") for h in hs]),
            "t2000": med([h.get("tier2000") for h in hs]), "tRatio": med([h.get("ratio2000vs100") for h in hs]),
            "t2000B": med([m.get("tier2000AvgBytes") for m in ms]),
            "c409": med([m.get("expectedConflicts409") for m in ms]),
            "cLeg": med([m.get("legacyConflictErrors") for m in ms]),
            "rollback": med([m.get("overlapAtomicRollbackRate") for m in ms]),
            "u30m": med([m.get("cancelUnder30mBlockedRate") for m in ms]),
            "idem": med([s.get("idempotencyDedupRate") for s in ss]),
            "dos429": med([s.get("attackerBlocked429Rate") for s in ss]),
            "dosP95": med([s.get("customerP95UnderAttackMs") for s in ss]),
            "logout": med([s.get("jwtLogoutRevocationRate") for s in ss]),
            "nist": med([s.get("nistLongPasswordRate") for s in ss]),
            "tupPerReq": round(tup / reqs, 2) if tup is not None else None,
            "apiCpu": api_cpu, "dbCpu": db_cpu, "rdCpu": rd_cpu,
            "eff": round(rps / cores_used, 2) if rps and cores_used > 0.01 else None,
            "invOk": all((t.get("dbInvariants") or {}).get("allInvariantsPassed", True) for t in ts),
        }
    return env, agg


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--output-md", default="load_test_v2/results/comparison-report.md")
    ap.add_argument("--output-csv", default="load_test_v2/results/comparison-summary.csv")
    args = ap.parse_args()

    b_env, b_agg = load_dir(args.before)
    a_env, a_agg = load_dir(args.after)
    scs = sorted(set(b_agg) | set(a_agg))

    lines = [
        "# BÁO CÁO ĐỐI CHỨNG PHASE 1 (BEFORE) vs PHASE 2 (AFTER)",
        f"- **Commit:** `{(b_env.get('git') or {}).get('commit', '')[:10]}` → `{(a_env.get('git') or {}).get('commit', '')[:10]}`",
        f"- **PostgreSQL:** `{(a_env.get('versions') or {}).get('postgres', '—')}`",
        "",
        "## 1. Thông lượng (Throughput) & Độ trễ p95",
        "| Kịch bản | Chỉ số | Before | After | Cải thiện |",
        "| :--- | :--- | ---: | ---: | ---: |",
    ]
    for sc in scs:
        b, a = b_agg.get(sc, {}), a_agg.get(sc, {})
        lines.append(f"| **{sc.upper()}** | Throughput (req/s) | {fmt(b.get('rps'))} | {fmt(a.get('rps'))} | {delta(b.get('rps'), a.get('rps'))} |")
        if (b.get("bps") or 0) > 0 or (a.get("bps") or 0) > 0:
            lines.append(f"| ↳ *Write* | **Đơn thành công (`201/s`)** | {fmt(b.get('bps'))} | {fmt(a.get('bps'))} | {delta(b.get('bps'), a.get('bps'))} |")
        if b.get("readP95") or a.get("readP95"):
            lines.append(f"| ↳ *Read* | Read `p95` (ms) | {fmt(b.get('readP95'), ' ms')} | {fmt(a.get('readP95'), ' ms')} | {delta(b.get('readP95'), a.get('readP95'), True)} |")
        if b.get("bookP95") or a.get("bookP95"):
            lines.append(f"| ↳ *Book* | Booking `p95` (ms) | {fmt(b.get('bookP95'), ' ms')} | {fmt(a.get('bookP95'), ' ms')} | {delta(b.get('bookP95'), a.get('bookP95'), True)} |")

    bk4, ak4, bk3, ak3, bk5, ak5 = b_agg.get("k4", {}), a_agg.get("k4", {}), b_agg.get("k3", {}), a_agg.get("k3", {}), b_agg.get("k5", {}), a_agg.get("k5", {})
    lines += [
        "", "## 2. Triệt tiêu N+1, Phân trang & Tài nguyên DB/CPU",
        "| Hạng mục | Before | After | Cải thiện |", "| :--- | ---: | ---: | ---: |",
        f"| Lịch sử 100 → 2.000 đơn (`p95` ms) | {fmt(bk4.get('t100'))} → {fmt(bk4.get('t2000'))} ms | {fmt(ak4.get('t100'))} → {fmt(ak4.get('t2000'))} ms | {delta(bk4.get('t2000'), ak4.get('t2000'), True)} |",
        f"| Payload Lịch sử 2.000 đơn (Bytes) | {fmt(bk4.get('t2000B'), ' B', 0)} | {fmt(ak4.get('t2000B'), ' B', 0)} | {delta(bk4.get('t2000B'), ak4.get('t2000B'), True)} |",
        f"| 30 Phòng chiếu Admin (`p95` ms) | {fmt(bk4.get('audP95'), ' ms')} | {fmt(ak4.get('audP95'), ' ms')} | {delta(bk4.get('audP95'), ak4.get('audP95'), True)} |",
        "", "## 3. Bằng chứng Nhân quả PostgreSQL, CPU & Hiệu suất phần cứng (4-vCPU)",
        "| Kịch bản | DB Rows Fetched / req (Before → After) | DB CPU % (Before → After) | API CPU % (Before → After) | Hiệu suất `req / CPU-sec` (Before → After) |",
        "| :--- | :---: | :---: | :---: | :---: |",
        *[
            f"| **{sc.upper()}** | {fmt(b_agg.get(sc,{}).get('tupPerReq'))} → **{fmt(a_agg.get(sc,{}).get('tupPerReq'))}** | "
            f"{fmt(b_agg.get(sc,{}).get('dbCpu'), '%')} → **{fmt(a_agg.get(sc,{}).get('dbCpu'), '%')}** | "
            f"{fmt(b_agg.get(sc,{}).get('apiCpu'), '%')} → **{fmt(a_agg.get(sc,{}).get('apiCpu'), '%')}** | "
            f"{fmt(b_agg.get(sc,{}).get('eff'))} → **{fmt(a_agg.get(sc,{}).get('eff'))}** |"
            for sc in scs
        ],
        "", "## 4. Tính đúng đắn Đồng thời (K3) & An ninh / Độ tin cậy (K5)",
        "| Tiêu chí nghiệm thu | Before | After |", "| :--- | ---: | ---: |",
        f"| Phản hồi chuẩn `409 SEAT_ALREADY_BOOKED` / Lỗi cũ (`400/500`) | {fmt(bk3.get('c409'), '', 0)} / {fmt(bk3.get('cLeg'), '', 0)} | **{fmt(ak3.get('c409'), '', 0)} / {fmt(ak3.get('cLeg'), '', 0)}** |",
        f"| Rollback nguyên tử 4 ghế giao nhau & Chặn hủy `<30p` (%) | {fmt((bk3.get('rollback') or 0)*100)}% / {fmt((bk3.get('u30m') or 0)*100)}% | **{fmt((ak3.get('rollback') or 0)*100)}% / {fmt((ak3.get('u30m') or 0)*100)}%** |",
        f"| Idempotency chống trùng đơn & Chặn BCrypt DoS `429` (%) | {fmt((bk5.get('idem') or 0)*100)}% / {fmt((bk5.get('dos429') or 0)*100)}% | **{fmt((ak5.get('idem') or 0)*100)}% / {fmt((ak5.get('dos429') or 0)*100)}%** |",
        f"| Độ trễ `p95` khách thật khi bị tấn công BCrypt DoS | {fmt(bk5.get('dosP95'), ' ms')} | **{fmt(ak5.get('dosP95'), ' ms')}** |",
    ]

    md = "\n".join(lines) + "\n"
    out_md = pathlib.Path(args.output_md)
    out_md.parent.mkdir(parents=True, exist_ok=True)
    out_md.write_text(md, encoding="utf-8")

    with pathlib.Path(args.output_csv).open("w", newline="", encoding="utf-8") as fp:
        w = csv.DictWriter(fp, fieldnames=("scenario", "before_rps", "after_rps", "before_bookings_s", "after_bookings_s", "before_read_p95", "after_read_p95", "before_book_p95", "after_book_p95", "before_tup_req", "after_tup_req", "before_eff", "after_eff"))
        w.writeheader()
        for sc in scs:
            b, a = b_agg.get(sc, {}), a_agg.get(sc, {})
            w.writerow({"scenario": sc, "before_rps": b.get("rps"), "after_rps": a.get("rps"), "before_bookings_s": b.get("bps"), "after_bookings_s": a.get("bps"), "before_read_p95": b.get("readP95"), "after_read_p95": a.get("readP95"), "before_book_p95": b.get("bookP95"), "after_book_p95": a.get("bookP95"), "before_tup_req": b.get("tupPerReq"), "after_tup_req": a.get("tupPerReq"), "before_eff": b.get("eff"), "after_eff": a.get("eff")})

    print(md)


if __name__ == "__main__":
    main()
