# Bộ Kiểm Thử Tải & Đối Chứng Phase 2 (`load_test_v2/`)

Bộ kiểm thử tải Open-Model chuyên dụng cho **Kaggle CPU (4 vCPU)** nhằm đo lường định lượng giá trị tối ưu **Before (Phase 1) vs After (Phase 2)**.

## Cấu trúc 6 kịch bản cốt lõi

| Kịch bản | Mục tiêu kiểm chứng | Chỉ số đầu ra chính |
| :--- | :--- | :--- |
| **`k1-read-scalability.js`** | Partial Index, SQL filter, giảm GC `/seats`, GZIP, Caffeine L1 + Redis L2, `@CacheEvict` | Max RPS (`400 → 2.400 req/s`), `seat_map_p95`, `cache_invalidation_verified` |
| **`k2-parallel-booking.js`** | Đổi `FOR UPDATE` sang Shared Lock (`PESSIMISTIC_READ`), Batch `IN`, Lean Snapshot, JDBC Batch, HikariCP/Virtual Threads | **`successfulBookingsPerSec` (`201/s`)** cho đơn 4 ghế rời nhau trên cùng 1 suất nóng |
| **`k3-contention-atomicity.js`** | 25–60 vòng tranh 1 ghế, đặt chéo 4 ghế ngược thứ tự, đua 2 lệnh hủy, Soft Delete & luật `<30 phút` | `409 SEAT_ALREADY_BOOKED` vs lỗi cũ `400/500`, Atomic Rollback, `0` Deadlock, `verify-invariants.sql` |
| **`k4-history-pagination.js`** | Triệt tiêu `1+N` queries lịch sử đặt vé (100 / 500 / 2.000 đơn) & 30 phòng Admin + Pagination | Tỷ lệ `p95[2000]/p95[100] ~ 1.0x`, giảm Payload từ >130 KB về ~2 KB |
| **`k5-resilience-security.js`** | `Idempotency-Key` storm, Rate Limit `429` chống BCrypt DoS `50 login/s`, Logout Blacklist, NIST | `attacker_blocked_429_rate`, `customer_p95_under_attack`, `idempotency_dedup_ok` |
| **`k6-mixed-peak-soak.js`** | Tải hỗn hợp giờ cao điểm (75% Read, 15% Booking, 5% History, 5% Cancel) & Soak test | Tổng RPS, `reqs/CPU-sec`, GC pause ms, ổn định RAM/Pool |

## Cách chạy nhanh

1. **Trên Kaggle CPU:** Push `load_test_v2/` lên GitHub $\rightarrow$ Import `cinema-kaggle-phase2.ipynb` lên Kaggle (**Accelerator = None**, **Internet = On**) $\rightarrow$ chỉnh `SUITE_REF`, `BEFORE_REF`, `AFTER_REF` ở Ô 1 $\rightarrow$ **Run All**.
2. **Trên Linux / WSL local:**
   ```bash
   node load_test_v2/seed.mjs
   python3 -B load_test_v2/run-phase2-benchmark.py --label phase2 --api-pids "$API_PID" --database-pid "$DB_PID"
   python3 -B load_test_v2/compare-results.py --before load_test_v2/results/<before> --after load_test_v2/results/<after>
   ```
