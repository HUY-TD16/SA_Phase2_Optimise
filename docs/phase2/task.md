# PHÂN CHIA NHIỆM VỤ PHASE 2 — TEAM 3 THÀNH VIÊN

**Dự án:** Cinema Backend (`cinema-backend`)  
**Mục tiêu:** tăng throughput, giảm p95/p99, giảm tải PostgreSQL và bảo đảm không double-booking.

## TỔNG QUAN PHÂN CÔNG

| Thành viên | Phạm vi phụ trách |
|---|---|
| Thành viên 1 | Booking, concurrency, transaction và database correctness |
| Thành viên 2 | Read path, SQL, pagination và caching |
| Thành viên 3 | Load test, observability, runtime và deployment |

---

## THÀNH VIÊN 1 — BOOKING, CONCURRENCY & DATABASE

**Phạm vi sở hữu:** `modules/booking/**`, booking-facing contract của Theater, migration `V9`–`V11`.

| Mã | Nhiệm vụ | Đầu ra bắt buộc |
|---|---|---|
| B1 | Tối ưu khóa đồng thời khi đặt vé | Booking dùng shared/read lock hoặc cơ chế tương đương; hủy suất dùng exclusive/write lock; booking các ghế khác nhau không bị tuần tự hóa |
| B2 | Loại N+1 và tinh gọn Showtime Snapshot | Lấy toàn bộ ghế yêu cầu bằng một query `IN (:seatIds)`; không tải toàn bộ ghế phòng trong luồng tạo booking; không tải ghế hai lần |
| B3 | Hoàn thiện xử lý xung đột ghế | Constraint DB là lớp bảo vệ cuối; bắt `DataIntegrityViolationException`; trả `409 SEAT_ALREADY_BOOKED`; rollback toàn bộ booking nhiều ghế |
| B4 | Hoàn thiện hủy vé bằng soft delete | Thêm `status`, `cancelled_at`, `released_at`; chặn hủy trước giờ chiếu dưới 30 phút; cập nhật partial unique index; cho phép đặt lại ghế đã release |
| B5 | Cài đặt Idempotency Key | Nhận header `Idempotency-Key`; lưu key và request fingerprint trong PostgreSQL; cùng key/payload trả lại kết quả cũ; khác payload trả `409` |
| B6 | Tối ưu API lịch sử và chi tiết booking | DTO projection cho danh sách; pagination có giới hạn `size`; detail lấy booking và seats bằng số query cố định |

### Kiểm thử Thành viên 1 phải làm

- [ ] Hai request cùng ghế: đúng một `201`, các request còn lại `409`.
- [ ] Hai request khác ghế cùng showtime chạy song song.
- [ ] Booking 2–8 ghế rollback toàn bộ nếu một ghế bị trùng.
- [ ] Booking và cancel showtime chạy đồng thời không làm sai trạng thái.
- [ ] Cancel trước/sau mốc 30 phút.
- [ ] Ghế đã release đặt lại được.
- [ ] Hai request đồng thời cùng `Idempotency-Key` chỉ tạo một booking.
- [ ] Query-count test cho create/list/detail booking.
- [ ] Thêm `load-test/booking-write.js`.

---

## THÀNH VIÊN 2 — READ PATH, SQL & CACHING

**Phạm vi sở hữu:** Movie/Theater read API, repository query đọc, cache package, Redis package, migration từ `V12`.

| Mã | Nhiệm vụ | Đầu ra bắt buộc |
|---|---|---|
| R1 | Tối ưu query Movie, Showtime và Seat Availability | Lọc `SCHEDULED` tại SQL; dùng projection/join phù hợp; endpoint seat availability không tạo truy vấn và object dư thừa |
| R2 | Loại N+1 danh sách phòng chiếu | Gom auditorium và seats theo batch/query cố định; không gọi `findSeats()` riêng cho từng auditorium |
| R3 | Cài đặt Caffeine L1 Cache | Cache movie detail/list, showtime theo ngày và layout ghế; cấu hình TTL, maximum size, cache key; evict khi Admin thay đổi dữ liệu |
| R4 | Cài đặt Redis L2 Cache | Cache dữ liệu đọc dùng chung giữa các node; TTL, serialization version, TTL jitter, chống cache stampede và fallback khi Redis lỗi |
| R5 | Tối ưu cache trạng thái ghế | PostgreSQL vẫn là source of truth; cập nhật/evict cache sau booking và cancel; không trả dữ liệu stale vượt policy |
| R6 | Pagination, index và payload limit | Pagination cho auditorium/read API; giới hạn maximum `size`; dùng `EXPLAIN (ANALYZE, BUFFERS)` trước khi thêm partial/composite index |

### Kiểm thử Thành viên 2 phải làm

- [ ] Query-count test cho movie/showtime/seat/auditorium.
- [ ] Cache hit, miss, TTL và maximum size.
- [ ] Cache invalidation sau create/update/delete của Admin.
- [ ] Cache trạng thái ghế đúng sau booking và cancel.
- [ ] Concurrent cache miss không tạo cache stampede.
- [ ] API đọc vẫn hoạt động khi Redis mất kết nối.
- [ ] Pagination boundary và maximum page size.
- [ ] Lưu execution plan trước/sau cho từng index mới.
- [ ] Thêm `load-test/read-path.js`.

---

## THÀNH VIÊN 3 — PERFORMANCE TEST, OBSERVABILITY & RUNTIME

**Phạm vi sở hữu:** `load-test/**` dùng chung, observability, `Dockerfile`, `compose.yaml`, runtime configuration và báo cáo kết quả.

| Mã | Nhiệm vụ | Đầu ra bắt buộc |
|---|---|---|
| P1 | Chuẩn hóa baseline và môi trường đo | Ghi commit, dataset, CPU/RAM, Java/PostgreSQL/k6 version, JVM flags và pool size; chạy tối thiểu 3 lần/mức tải |
| P2 | Nâng cấp k6 thành Open Model | Dùng `constant-arrival-rate`; tìm saturation point; tách technical error, business conflict và dropped iterations |
| P3 | Bổ sung workload thực tế | Mixed workload; booking 4–8 ghế; contention lặp; user có lịch sử lớn; spike test và soak test |
| P4 | Cài đặt observability | Prometheus/Micrometer cho HTTP, JVM/GC và Hikari; PostgreSQL `pg_stat_statements`/lock wait; MDC requestId; dashboard giám sát |
| P5 | Tuning JVM, Hikari và JDBC | A/B test pool size, Virtual Threads, JDBC batching, heap/container limit và GZIP threshold; chỉ giữ cấu hình có số liệu tốt hơn |
| P6 | Scale-out và tối ưu deployment | Docker layer cache; resource limit/healthcheck; Nginx với 2–3 API replica; so sánh 1 node và nhiều node |

### Kiểm thử và bằng chứng Thành viên 3 phải làm

- [ ] Baseline 10/25/50 VU, tối thiểu ba lần mỗi mức.
- [ ] Arrival-rate test tăng dần tới điểm bão hòa.
- [ ] Contention test có nhiều vòng, luôn giữ invariant một ghế/một booking hiệu lực.
- [ ] Spike test và soak test.
- [ ] Thu CPU/RSS của API, PostgreSQL và k6.
- [ ] Thu p50/p95/p99, throughput, error rate và dropped iterations.
- [ ] Thu GC pause, allocation, Hikari pending/acquire time và DB lock wait.
- [ ] So sánh từng cấu hình tuning bằng A/B test.
- [ ] So sánh 1 API node với 2–3 API node.
- [ ] Tổng hợp bảng before/after cuối kỳ.

---

## NHIỆM VỤ STRETCH — CHỈ LÀM KHI HOÀN THÀNH TOÀN BỘ CORE

| Thành viên | Nhiệm vụ stretch |
|---|---|
| Thành viên 1 | Keyset pagination cho lịch sử booking; tối ưu batch insert bằng `reWriteBatchedInserts` nếu benchmark chứng minh có lợi |
| Thành viên 2 | Atomic Seat Hold bằng Redis Lua script; Rate Limiting cho `/auth/login` và `/auth/register` |
| Thành viên 3 | Redis Streams chỉ cho email/audit/background task; CI performance regression smoke test |

Không chuyển `POST /bookings` sang xử lý bất đồng bộ trong scope core.

---

## QUY TẮC LÀM SONG SONG, KHÔNG CHỜ NHAU

1. Thành viên 1 dùng migration `V9`–`V11`; Thành viên 2 dùng từ `V12` trở đi; Thành viên 3 không tạo migration nghiệp vụ.
2. Thành viên 1 không sửa cache/read controller; Thành viên 2 không sửa transaction ghi booking; Thành viên 3 không sửa business logic.
3. Thành viên 1 thêm `booking-write.js`; Thành viên 2 thêm `read-path.js`; Thành viên 3 sở hữu `load-test/lib/common.js` và runner dùng chung.
4. Mọi thay đổi tối ưu có feature flag để merge và benchmark độc lập.
5. Không đổi public API contract trong lúc ba nhánh đang làm song song.
6. `pom.xml`, `application.yml` và `compose.yaml` do Thành viên 3 resolve khi merge; Thành viên 1/2 ghi rõ dependency/config cần thêm trong PR.
7. Mỗi thành viên tự viết unit/integration/load test cho phạm vi của mình, không chờ kịch bản tổng hợp.


---

## DEFINITION OF DONE CHUNG

- [ ] Ba phần có thể bật/tắt và chạy độc lập.
- [ ] Unit, integration, concurrency, E2E và ArchUnit pass.
- [ ] Flyway chạy được từ database rỗng và nâng cấp được từ Phase 1.
- [ ] Không double-booking, không partial booking và không mất lịch sử cancel.
- [ ] Không còn N+1 tại các endpoint trong phạm vi tối ưu.
- [ ] Cache/Redis có invalidation và failure fallback.
- [ ] Baseline và optimized dùng cùng dataset, tài nguyên và thời lượng.
- [ ] Báo cáo đủ throughput, p50, p95, p99, error, CPU, RAM, GC, connection pool và DB lock.
- [ ] Mỗi kết luận hiệu năng có số liệu trước/sau đi kèm.
