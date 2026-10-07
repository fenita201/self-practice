# mongosync-testing

2 cluster MongoDB CE 8.0 (replica set 3 node, auth + keyFile) để thử `mongosync`, kèm tool sinh fake data (Node.js / Go) cấu hình bằng `.env`.

| Cluster | RS | Node (`MONGO_HOST`:port) |
|---|---|---|
| source | `src-rs` | :27017, :27018, :27019 |
| destination | `dst-rs` | :27027, :27028, :27029 |

## 1. Dựng cluster
```bash
cp .env.example .env          # sửa MONGO_HOST, user/pass/port nếu cần
docker compose up -d --build
docker compose ps -a          # src-init / dst-init phải Exited (0)
docker compose logs src-init dst-init
```
`*-init` tự: `rs.initiate` → tạo user `admin` (root) → tạo user `mongosync` + custom role `mongosyncOplog` trên **cả 2 cluster**.

Reset hoàn toàn: `docker compose down -v`.

## 2. MONGO_HOST (thay cho hosts file)
Member của replica set được đăng ký bằng `MONGO_HOST:port` (IP/host mà **cả container lẫn client trên Windows** đều tới được các cổng đã publish). Với Docker trong WSL: `wsl hostname -I` → lấy IP đầu tiên, điền vào `MONGO_HOST` trong `.env`.

IP WSL đổi sau khi restart WSL/máy → sửa `MONGO_HOST` rồi chạy:
```bash
docker compose up -d --force-recreate src-init dst-init   # init tự reconfig host member, giữ nguyên dữ liệu
```
URL kết nối 3 node (Compass, generator...):
```
mongodb://admin:admin_pass@<MONGO_HOST>:27017,<MONGO_HOST>:27018,<MONGO_HOST>:27019/?replicaSet=src-rs&authSource=admin
```
(Compass chỉ để xem dữ liệu: `localhost:27017` + `directConnection=true` cũng được.)

## 3. Sinh dữ liệu (đổ vào source)
Cấu hình trong `.env` (phần generator): `DB_COUNT`, `COLLECTIONS_PER_DB`, `DOCS_PER_COLLECTION`, `TARGET_MB_PER_DB`, ...
Số doc là chính; kích thước mỗi doc = `TARGET_MB_PER_DB / (COLLECTIONS_PER_DB × DOCS_PER_COLLECTION)` (padding field `payload`). MB là BSON `dataSize` (chưa nén), `storageSize` trên đĩa có thể khác chút.

```bash
# Node.js
cd generator-node && npm install
npm start           # sinh data
npm run stats       # xem DB/coll/doc/MB
npm run clean       # drop các DB có prefix DB_PREFIX

# Go
cd generator-go && go run .          # = run;  go run . stats | clean
```
Đổi `TARGET=dst` để đổ vào cluster đích (hoặc `TARGET=custom` + `MONGO_URI`).

## 4. Container mongosync (Ubuntu trơn)
Binary mongosync không nằm trong git. Tải về và giải nén vào `mongosync-ubuntu2404/` trước (cần `curl`, `tar`; chạy được trên Git Bash/WSL):
```bash
./download-mongosync.sh            # mặc định 1.22.0; chọn bản khác: ./download-mongosync.sh 1.21.0
FORCE=1 ./download-mongosync.sh    # tải lại, container đang chạy vẫn thấy file mới
```
Service `mongosync` là `ubuntu:24.04` thuần, chỉ mount `./mongosync-ubuntu2404` vào `/mongosync` (không cài/cấu hình gì sẵn). Tự setup trong đó:
```bash
docker compose exec mongosync bash
apt-get update && apt-get install -y libgssapi-krb5-2 curl   # libgssapi-krb5-2 BẮT BUỘC để mongosync chạy; curl để gọi API 27182
# (container tạo lại thì mất các gói đã cài — chạy lại lệnh trên)
/mongosync/bin/mongosync --help
```
Kết nối 2 cluster bằng URL 3 node (`<MONGO_HOST>` = giá trị trong `.env`), user `mongosync` / `mongosync_pass`:
```
mongodb://mongosync:mongosync_pass@<MONGO_HOST>:27017,<MONGO_HOST>:27018,<MONGO_HOST>:27019/?replicaSet=src-rs&authSource=admin
mongodb://mongosync:mongosync_pass@<MONGO_HOST>:27027,<MONGO_HOST>:27028,<MONGO_HOST>:27029/?replicaSet=dst-rs&authSource=admin
```
User `mongosync` có roles theo [docs](https://www.mongodb.com/docs/mongosync/current/reference/permissions/): `backup, clusterManager, clusterMonitor, readWriteAnyDatabase, restore, dbAdminAnyDatabase` + custom role `mongosyncOplog` — đủ cho cả reverse sync.

## 5. mongo-connector (app giả lập đọc/ghi liên tục)
Chạy trên Windows (hoặc nơi nào tới được `MONGO_HOST`), cấu hình trong `mongo-connector/.env` (mẫu: `.env.example`):
```bash
cd mongo-connector && npm install && cp .env.example .env
npm start            # Ctrl+C để dừng
```
- Khi start: liệt kê DB + collection (bỏ `admin/local/config`, `system.*`; lọc bằng `DB_INCLUDE_REGEX` / `COLLECTION_INCLUDE_REGEX`), rồi quét lại mỗi `DISCOVERY_REFRESH_SEC` giây để thấy DB/collection mới.
- `READ_RATE` / `WRITE_RATE`: số op mỗi giây (0 = tắt). `WRITE_UPDATE_PERCENT`: % write là update doc có sẵn, còn lại là insert. Mỗi op chọn ngẫu nhiên 1 collection (`PICK_BY=db` thì chọn DB trước).
- Cứ `STATS_INTERVAL_SEC` giây in tốc độ thực tế, p50/p95 latency, lỗi, số op bị drop (khi DB không theo kịp `MAX_INFLIGHT`).
- Trỏ `MONGO_URI` vào cluster **source** để vừa sync vừa có traffic.

Dev/test only — password mặc định yếu.
