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

---

## Kết quả Đo Baseline Trước Tối Ưu (`phase1-before`) trên Kaggle CPU

### 1. Thông tin Phiên đo & Môi trường (`20261126-000242-phase1-before`)

| Hạng mục | Giá trị ghi nhận từ `environment.json` |
| :--- | :--- |
| **Nhãn phiên đo (`label`)** | `phase1-before` (Baseline đối chứng trước khi áp dụng tối ưu Phase 2) |
| **Git Commit SHA** | `21eec61ddf828606497daa538ff748fc56dfa3c8` |
| **Thời điểm thu thập (UTC)** | `2026-11-26T00:02:42Z` |
| **Hệ điều hành & CPU** | `Linux-6.18.55+-x86_64-with-glibc2.39` — **4 logical vCPUs** (Kaggle CPU Session) |
| **Phần mềm & Runtime** | OpenJDK `21.0.13.1`, PostgreSQL `16.15`, Redis `7.0.15` *(chạy nền rỗi ~0.04% CPU)*, `k6 v2.4.0` |
| **Cấu hình JVM & Pool** | `-Xms256m -Xmx768m`, HikariCP mặc định (`maximum-pool-size = 10`), GZIP tắt, chưa có Cache |
| **Dataset (`SEED_PROFILE=kaggle`)** | `3,000` phim (`600` xóa mềm), `34` phòng chiếu (suất nóng `12,000` ghế), `300` users, lịch sử `100 / 500 / 2,000` đơn |
| **Quy chuẩn lặp** | **3 lượt lặp / kịch bản** (`warmup = 15s`, `duration = 60s`; riêng `K5 = 30s`, `K3 = 25 waves × 40 VUs`) |

---

### 2. Bảng Tổng Hợp Hiệu Năng & Tài Nguyên — Median 3 Lượt (`K1` → `K6`)

| Kịch bản | Mục tiêu tải | Thông lượng đạt (`req/s`) | Đơn thành công (`201/s`) | Dropped Iterations | Read `p50 / p95 / p99` (ms) | Booking `p50 / p95 / p99` (ms) | DB Rows Fetched / req | API / DB CPU (%) | API / DB RSS Đỉnh (MiB) | Hiệu suất (`req / CPU-s`) |
| :--- | :---: | ---: | ---: | ---: | :---: | :---: | ---: | :---: | :---: | ---: |
| **`K1` Read Scalability** | Ramp `400→2,400/s` | **671.27** | — | 24,215 | `30.41 / 226.82 / 363.32` | — | 870.22 | `48.39% / 20.98%` | `672.9 / 354.7` | 241.78 |
| **`K2` Parallel Booking** | `50 POST/s` (4 ghế/đơn) | **10.65** | **10.65** | 2,258 | — | `21,400.3 / 21,870.7 / 21,977.6` | 18,096.69 | `20.58% / 9.47%` | `722.0 / 480.3` | 8.85 |
| **`K3` Contention & Rules** | `40 VUs × 25 waves` | **230.51** *(1,000 reqs)* | **25** *(tổng)* | 0 | — | `160.53 / 200.56 / 300.84` | 320.92 | `33.68% / 8.31%` | `742.7 / 490.7` | 594.67 |
| **`K4` History & N+1** | `80 req/s` | **10.58** | — | 4,078 | `3,361.3 / 51,855.9 / 54,584.3` | — | 10,142.48 | `61.39% / 29.77%` | `1,220.9 / 496.5` | **2.90** |
| **`K5` Security & DoS** | `50 atk/s + 40 cust/s` | **23.63** *(khách)* | **4.73** | 1,154 | `3,287.6 / 7,886.9 / 8,623.1` | `5,538.7 / 10,135.6 / 12,382.4` | 2,879.89 | **`71.51%`** `/ 4.81%` | `1,269.5 / 496.8` | 7.74 |
| **`K6` Mixed Peak Hour** | `350 req/s` hỗn hợp | **63.67** | **9.43** | 17,416 | `5,168.6 / 8,986.7 / 10,971.8` | `5,991.0 / 8,319.7 / 8,958.8` | 6,415.04 | `34.71% / 22.04%` | `1,270.3 / 502.1` | 28.03 |

> **Ghi chú:** Tỷ lệ lỗi kỹ thuật HTTP 5xx/mạng (`technicalErrorRate`) ở cả 6 kịch bản đều là `0.00%`, nhưng hệ thống bị **nghẽn hàng đợi nghiêm trọng** thể hiện qua số lượng `Dropped Iterations` rất lớn và độ trễ `p95` vọt lên từ **8 giây đến 54.8 giây** ở các kịch bản `K2`, `K4`, `K5`, `K6`. *(Ở `K3`, `measuredThroughputRps` mặc định chia cho `measureDurationSeconds=1`, còn tốc độ thực tế ghi nhận từ k6 metric `measured_requests.rate` có median là `230.51 req/s`).*

---

### 3. Bảng Phân Tích Chuyên Sâu Từng Điểm Nghẽn (Bằng chứng Nhân quả)

#### 3.1. Bão truy vấn `1 + N` & Thiếu Phân trang (`K4` — Lịch sử đặt vé & Phòng chiếu Admin)

| Hạng mục đo lường | Kết quả `phase1-before` (Median) | Nguyên nhân gốc xác nhận từ Telemetry |
| :--- | ---: | :--- |
| **Lịch sử 100 đơn (`tier100 p95`)** | **5,147.83 ms** | `1 + 100` câu SQL riêng lẻ / request + không bọc `@Transactional(readOnly=true)` |
| **Lịch sử 500 đơn (`tier500 p95`)** | **15,926.35 ms** | Độ trễ tăng tuyến tính theo số lượng đơn của người dùng |
| **Lịch sử 2.000 đơn (`tier2000 p95`)** | **54,842.99 ms** (~54.8 giây) | Chậm gấp **`10.87x`** so với mức 100 đơn (`ratio2000vs100 = 10.87`) |
| **Dung lượng JSON trả về (`tier2000`)** | **190,001 Bytes** (~185.5 KB) | Trả toàn bộ mảng không có `page/size`, nạp thừa ghế rồi bỏ ở `BookingSummaryResponse` |
| **Danh sách 30 phòng Admin (`audList p95`)** | **3,105.61 ms** (Payload max `1.73 MB`) | Lỗi `1 + 30` queries tải toàn bộ ghế từng phòng + không nén GZIP |
| **Tổng `xact_commit` DB trong 60 giây** | **645,488 transactions** / `635` HTTP reqs | Trung bình **~1,016 giao dịch DB tự động mở/đóng cho mỗi 1 HTTP request** |

#### 3.2. Tính Đúng đắn Đồng thời, Tranh chấp Ghế & Quy tắc Nghiệp vụ (`K2` & `K3`)

| Tiêu chí kiểm chứng | Kết quả `phase1-before` | Đánh giá hiện trạng |
| :--- | :---: | :--- |
| **Chống bán trùng ghế (`duplicateActiveSeats`)** | **`0`** (`25/25` winners chuẩn xác) | ✅ Đạt — Khóa DB và Unique Constraint bảo vệ toàn vẹn dữ liệu |
| **Rollback nguyên tử khi trùng 1 trong 4 ghế đặt chéo** | **`100%`** (`15/15` cặp, `0` Deadlock) | ✅ Đạt — Transaction rollback toàn bộ nhóm ghế khi va chạm |
| **Đặt vé song song khác ghế cùng suất (`K2`)** | **`10.65 đơn/s`**, `p95 = 21,870.65 ms` | ❌ Nghẽn nặng — `SELECT ... FOR UPDATE` tuần tự hóa mọi luồng + nạp thừa toàn bộ ghế phòng |
| **Chuẩn mã lỗi `409 SEAT_ALREADY_BOOKED` (`K3`)** | **`0 / 975`** (`975` lỗi cũ `400` plain text) | ❌ Lệch SPEC — `BookingExceptionHandler` trả `400` chuỗi trần (`28 B`) thay vì `409` JSON |
| **Chuẩn bọc JSON Envelope `{ "data": ... }` (`K2`)** | **`0%`** (`0 / 639` đơn) | ❌ Lệch SPEC — `BookingController` trả trực tiếp DTO ở cấp gốc |
| **An toàn khi đua 2 lệnh `DELETE` hủy vé cùng lúc** | **`0%`** (`0 / 3` lượt) | ❌ Lỗi Race Condition khi xóa vật lý (`deleteById`) đồng thời |
| **Chặn hủy vé sát giờ chiếu `< 30 phút` & Soft Delete** | **`0%`** (`schemaHasSoftDelete = false`) | ❌ Thiếu quy tắc 30 phút và xóa cứng làm mất lịch sử giao dịch |

#### 3.3. Khả năng Chống chịu Bảo mật & Cạn kiệt CPU (`K5` — Resilience & Security)

| Hạng mục kiểm toán & Chịu tải tấn công | Kết quả `phase1-before` (Median) | Tác động thực tế trên 4 vCPU Kaggle |
| :--- | ---: | :--- |
| **Tỷ lệ chặn Brute-force Login bằng `429` (`50 login/s`)** | **`0.00%`** (`0 / 839` req bị chặn) | ❌ Không có Rate Limiting — toàn bộ request sai mật khẩu đều chạy băm BCrypt cost=10 |
| **Mức chiếm dụng CPU của API khi bị tấn công** | **`71.51%`** *(đỉnh lượt 1: `76.32%`)* | ❌ Hiệu ứng **BCrypt CPU Starvation** vắt kiệt CPU tầng Web dù DB CPU chỉ `4.81%` |
| **Độ trễ `p95` của khách thật trong lúc bị tấn công** | **`8,127.27 ms`** *(Booking `p95`: `10.14s`)* | ❌ Khách hàng bình thường bị vạ lây, đóng băng hơn 8–10 giây mới xem/đặt được ghế |
| **Chống tạo đơn trùng bằng `Idempotency-Key`** | **`0.00%`** (`idempotency_dedup_ok = 0`) | ❌ Bấm lặp / retry mạng tạo nhiều request xử lý trùng, chưa đối chiếu payload mismatch |
| **Thu hồi JWT ngay khi Logout (`POST /auth/logout`)** | **`0.00%`** (`jwt_logout_revocation_ok = 0`) | ❌ Chưa có endpoint `/logout` và Redis Blacklist thu hồi token |
| **Hỗ trợ mật khẩu dài chuẩn NIST SP 800-63B (>16 ký tự)** | **`0.00%`** (`nist_long_password_supported = 0`) | ❌ `AccountPolicy` chặn cứng độ dài tối đa 16 ký tự |
| **HTTP Security Headers cơ bản (`nosniff`, `X-Frame-Options`)** | **`100.00%`** | ✅ Có mặc định từ Spring Security (cần bổ sung thêm CSP, HSTS, CORS ở Phase 2) |

---

### 4. Chi Tiết Toàn Bộ 18 Lượt Chạy Thực Nghiệm (`run1`, `run2`, `run3`)

| Lượt chạy | Requests đo | RPS (`req/s`) | Bookings/s | Dropped | Read `p50 / p95 / p99` (ms) | Booking `p50 / p95 / p99` (ms) | API CPU% | DB CPU% | PG `tup_fetched` |
| :--- | ---: | ---: | ---: | ---: | :---: | :---: | ---: | ---: | ---: |
| `k1-run1` | 30,072 | 501.20 | 0.00 | 39,882 | `101.61 / 651.33 / 1,016.73` | — | 63.92% | 14.20% | 23,390,393 |
| `k1-run2` | 44,092 | 734.87 | 0.00 | 18,112 | `30.08 / 185.55 / 286.48` | — | 48.39% | 21.37% | 37,233,862 |
| `k1-run3` | 40,276 | 671.27 | 0.00 | 24,215 | `30.41 / 226.82 / 363.32` | — | 28.55% | 20.98% | 35,048,888 |
| `k2-run1` | 669 | 11.15 | 11.15 | 2,161 | — | `21,780.4 / 22,905.6 / 23,000.5` | 22.16% | 9.02% | 5,322,306 |
| `k2-run2` | 639 | 10.65 | 10.65 | 2,258 | — | `21,352.1 / 21,809.2 / 21,903.1` | 20.58% | 9.47% | 11,577,172 |
| `k2-run3` | 635 | 10.58 | 10.58 | 2,259 | — | `21,400.3 / 21,870.6 / 21,977.6` | 20.03% | 9.48% | 11,563,783 |
| `k3-run1` | 1,000 | 54.86* | 25 *(tổng)* | 0 | — | `177.49 / 461.50 / 13,407.28` | 27.09% | 9.50% | 2,393,574 |
| `k3-run2` | 1,000 | 230.51* | 25 *(tổng)* | 0 | — | `160.53 / 197.12 / 286.70` | 33.68% | 8.31% | 320,916 |
| `k3-run3` | 1,000 | 231.13* | 25 *(tổng)* | 0 | — | `158.81 / 200.56 / 300.84` | 34.70% | 8.07% | 291,920 |
| `k4-run1` | 635 | 10.58 | 0.00 | 4,062 | `3,252.9 / 51,855.9 / 54,584.3` | — | 62.07% | 28.62% | 6,752,383 |
| `k4-run2` | 659 | 10.98 | 0.00 | 4,078 | `3,361.3 / 50,736.5 / 53,140.0` | — | 61.39% | 29.77% | 6,440,475 |
| `k4-run3` | 620 | 10.33 | 0.00 | 4,098 | `3,456.5 / 52,606.2 / 55,641.3` | — | 60.86% | 29.89% | 6,321,037 |
| `k5-run1` | 667 | 22.23 | 4.47 | 1,230 | `3,772.0 / 7,296.7 / 9,337.0` | `5,535.0 / 9,547.6 / 12,830.0` | 76.32% | 10.08% | 2,077,171 |
| `k5-run2` | 709 | 23.63 | 4.73 | 1,154 | `2,984.4 / 7,886.9 / 8,262.1` | `5,660.0 / 10,141.1 / 12,382.4` | 71.09% | 4.81% | 2,012,982 |
| `k5-run3` | 711 | 23.70 | 4.77 | 1,135 | `3,287.6 / 8,181.6 / 8,623.1` | `5,538.7 / 10,135.6 / 11,357.0` | 71.51% | 4.80% | 2,041,839 |
| `k6-run1` | 3,820 | 63.67 | 9.43 | 17,472 | `5,168.6 / 9,071.4 / 10,972.8` | `6,001.6 / 8,202.9 / 9,092.4` | 34.63% | 21.96% | 23,936,322 |
| `k6-run2` | 3,798 | 63.30 | 9.42 | 17,416 | `5,187.3 / 8,986.7 / 10,971.8` | `5,991.0 / 8,319.7 / 8,958.7` | 34.71% | 22.04% | 24,505,437 |
| `k6-run3` | 3,835 | 63.92 | 9.52 | 17,381 | `5,123.9 / 8,452.5 / 10,742.9` | `5,831.3 / 8,353.7 / 8,908.5` | 34.78% | 22.12% | 24,732,735 |

*(\*Ở `K3`, kịch bản chạy theo đợt cố định `1,000` requests thay vì cố định 60 giây nên cột RPS hiển thị `measured_requests.rate` thực tế của từng lượt).*
