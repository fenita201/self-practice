# 1. Lab local bằng Docker (miễn phí)

Cách nhanh nhất để thấy mongosync chạy mà không cần cloud: 2 replica set × 3 node trên máy bạn
và 1 container Ubuntu để chạy mongosync. Mô hình giống hướng (A) "cụm VM → cụm VM", chỉ khác
là mọi thứ chạy trong Docker.

| Cluster | Replica set | Node (`MONGO_HOST`:port) |
|---|---|---|
| source | `src-rs` | :27017, :27018, :27019 |
| destination | `dst-rs` | :27027, :27028, :27029 |

**Cần:** Docker + Docker Compose, Node.js ≥ 18, `curl`, `jq`. RAM: các mongod dùng ~2–3 GB.
Verifier của mongosync cần ≥ 10 GB, nên trên laptop thường phải tắt verifier
(xem [00 §0.5](00-how-mongosync-works.md#05-embedded-verifier-và-ram-)).

## 1.1 Dựng 2 cluster

```bash
cd local
cp .env.example .env      # sửa MONGO_HOST (xem 1.2), user/pass nếu muốn
docker compose up -d
docker compose ps -a      # src-init và dst-init phải "Exited (0)"
docker compose logs src-init dst-init
```

Container `*-init` chạy [`scripts/mongo/init-replset.js`](../scripts/mongo/init-replset.js):
`rs.initiate` → tạo user `admin` (root) → tạo user `mongosync` + custom role `mongosyncOplog`.
Script chạy lại nhiều lần vẫn an toàn.

Reset toàn bộ (xoá cả data): `docker compose down -v`.

## 1.2 `MONGO_HOST` là gì và vì sao cần

Mỗi member của replica set được đăng ký bằng `MONGO_HOST:port`. Driver (Compass, tools,
mongosync) đọc danh sách member này từ server rồi kết nối **trực tiếp** tới từng member. Vì vậy
`MONGO_HOST` phải là địa chỉ mà **cả container lẫn máy bạn** đều tới được:

- Docker trong WSL: chạy `hostname -I` trong WSL, lấy IP đầu tiên.
- Docker Desktop / Linux: dùng IP LAN của máy.

Nếu dùng `localhost`, container mongosync sẽ hiểu `localhost` là chính nó và không kết nối được.
Đây là lỗi kinh điển khi chạy replica set bằng Docker.

**IP WSL đổi sau khi restart?** Sửa `MONGO_HOST` trong `.env` rồi chạy:

```bash
docker compose up -d --force-recreate src-init dst-init   # init tự reconfig host member, giữ nguyên data
```

Connection string (dùng cho Compass, tools):

```text
mongodb://admin:admin_pass@<MONGO_HOST>:27017,<MONGO_HOST>:27018,<MONGO_HOST>:27019/?replicaSet=src-rs&authSource=admin
mongodb://admin:admin_pass@<MONGO_HOST>:27027,<MONGO_HOST>:27028,<MONGO_HOST>:27029/?replicaSet=dst-rs&authSource=admin
```

Compass chỉ để xem dữ liệu thì `mongodb://admin:admin_pass@localhost:27017/?directConnection=true` cũng được.

## 1.3 Sinh dữ liệu và traffic

```bash
cd tools
npm install
cp .env.example .env
```

Trong `tools/.env`, đặt `SRC_URI` / `DST_URI` bằng hai connection string ở 1.2 (password có ký tự
đặc biệt thì URL-encode, ví dụ `@` → `%40`). Bản nhỏ cho laptop:

```dotenv
DB_COUNT=2
COLLECTIONS_PER_DB=3
DOCS_PER_COLLECTION=3000
TARGET_MB_PER_DB=10
```

```bash
npm run generate    # ghi vào source
npm run stats
```

Chi tiết từng tool: [docs/05-data-and-traffic.md](05-data-and-traffic.md).

## 1.4 Chạy mongosync trong container

```bash
./scripts/download-mongosync.sh          # chạy ở thư mục gốc repo => bin/mongosync (mount vào /mongosync)
cd local && docker compose exec mongosync bash
```

Container đã có sẵn `libgssapi-krb5-2`, `curl`, `jq`; `PATH` có sẵn `mongosync` và `ms.sh`.
Trong container (thay `<MONGO_HOST>`):

```bash
mkdir -p /var/log/mongosync
mongosync \
  --cluster0 "mongodb://mongosync:mongosync_pass@<MONGO_HOST>:27017,<MONGO_HOST>:27018,<MONGO_HOST>:27019/?replicaSet=src-rs&authSource=admin" \
  --cluster1 "mongodb://mongosync:mongosync_pass@<MONGO_HOST>:27027,<MONGO_HOST>:27028,<MONGO_HOST>:27029/?replicaSet=dst-rs&authSource=admin" \
  --logPath /var/log/mongosync \
  --disableTelemetry --acceptDisclaimer
```

Mở terminal thứ hai: `docker compose exec mongosync bash`, rồi:

```bash
ms.sh status                                   # chờ state = IDLE
ms.sh start '{"source":"cluster0","destination":"cluster1","verification":{"enabled":false}}'
ms.sh watch
```

Trên máy bạn, chạy `cd tools && npm run connector` để có traffic trong lúc sync. Phần còn lại
(commit, reverse, kiểm tra) giống hệt bản VM: [docs/06](06-run-mongosync.md) → [docs/07](07-verify.md).

## 1.5 Ghi chú

- Mọi container `mongod` có `ulimits nofile 64000`. Mặc định 1024 sẽ làm mongod chết với lỗi
  "Too many open files" khi có vài trăm collection (WiredTiger mở 1 file / collection / index).
- Mỗi node giới hạn WiredTiger cache 0.5 GB để 6 node vừa RAM laptop.
- Gói cài trong container `mongosync` mất khi container bị tạo lại; lệnh `command` trong
  compose sẽ tự cài lại.
