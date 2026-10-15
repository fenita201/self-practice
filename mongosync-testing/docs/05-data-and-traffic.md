# 5. Cài `lab-sync-1`, sinh data và traffic

`lab-sync-1` là máy duy nhất nhìn thấy cả source lẫn destination, nên mọi tool đều chạy ở đây.
(Lab local Docker: chạy `tools/` ngay trên máy bạn, bỏ qua 5.1–5.2.)

## 5.1 Cài gói cần thiết

```bash
gcloud compute ssh lab-sync-1 --tunnel-through-iap
```

Trên VM:

```bash
sudo apt-get update
sudo apt-get install -y libgssapi-krb5-2 curl jq tmux gnupg nodejs npm   # libgssapi-krb5-2: mongosync bắt buộc

# mongosh + mongodump/mongorestore từ repo MongoDB
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/mongodb-server-8.0.gpg
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(. /etc/os-release; echo $VERSION_CODENAME)/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-mongosh mongodb-database-tools
node -v     # cần >= 18
```

## 5.2 Copy repo lên VM

Trên máy local, ở thư mục gốc repo. Chỉ gửi source, **không** gửi `node_modules` hay `.env`:

```bash
tar czf /tmp/lab.tgz --exclude=node_modules --exclude=.env scripts tools
gcloud compute scp --tunnel-through-iap /tmp/lab.tgz lab-sync-1:~/
gcloud compute ssh lab-sync-1 --tunnel-through-iap --command 'mkdir -p ~/lab && tar xzf ~/lab.tgz -C ~/lab && rm ~/lab.tgz'
```

Trên VM:

```bash
cd ~/lab/tools
npm install
cp .env.example .env && chmod 600 .env
nano .env          # điền SRC_URI, DST_URI (user admin hoặc mongosync), xem bên dưới
```

| Hướng | `SRC_URI` | `DST_URI` |
|---|---|---|
| A | `admin` @ `10.20.0.11-13` `src-rs` | `admin` @ `10.20.0.21-23` `dst-rs` |
| B | như trên | `mongodb+srv://mongosync:<PW>@lab-m10-pri.xxxxx.mongodb.net/?authSource=admin` |
| C | như trên | `mongodb+srv://lab_app:<PW>@lab-m0.xxxxx.mongodb.net/?authSource=admin` |

## 5.3 Kiểm tra kết nối

```bash
eval "$(grep -E '^(SRC|DST)_URI=' ~/lab/tools/.env | sed -E "s/^([A-Z_]+)=(.*)$/export \1='\2'/")"
mongosh "$SRC_URI" --quiet --eval 'db.hello().setName + " primary=" + db.hello().primary'
mongosh "$DST_URI" --quiet --eval 'db.hello().setName + " primary=" + db.hello().primary'
```

Khi không kết nối được, kiểm tra theo thứ tự:

```bash
ping -c 2 10.20.0.11                                    # (A) mạng nội bộ
nc -zv 10.20.0.11 27017                                 # firewall 27017
dig +short SRV _mongodb._tcp.lab-m10-pri.xxxxx.mongodb.net   # (B) DNS private SRV
curl -s https://checkip.amazonaws.com                   # (C) IP ra Internet = IP NAT đã whitelist?
```

Xem thêm [08 · Lỗi kết nối](08-troubleshooting.md#81-lỗi-kết-nối--xác-thực).

## 5.4 Sinh data: `npm run generate`

[`tools/src/generate.js`](../tools/src/generate.js) tạo `DB_COUNT` DB × `COLLECTIONS_PER_DB`
collection × `DOCS_PER_COLLECTION` doc vào cluster `GEN_TARGET` (mặc định `src`). Field
`payload` (chuỗi ngẫu nhiên, khó nén) được đệm sao cho mỗi DB đạt khoảng `TARGET_MB_PER_DB`
MB (BSON `dataSize`). Mỗi collection có thêm `INDEXES_PER_COLLECTION` index để kiểm tra
mongosync có tạo đủ index trên đích không.

```bash
npm run generate      # = node src/generate.js run
npm run stats         # bảng DB / collection / doc / MB
npm run clean         # drop mọi DB có prefix DB_PREFIX
```

Output mẫu (2 DB × 3 collection × 3000 doc, 10 MB/DB):

```text
Target src: mongodb://admin:***@10.20.0.11:27017,...
Plan: 2 DB x 3 coll x 3000 docs (seed=...)
Doc size: base ~207 B + payload 958 B => ~1165 B/doc
...
DB                         colls    objects     dataMB   storageMB   indexMB
synctest_db_001                3       9000       9.99        9.38      0.51
synctest_db_002                3       9000       9.99        9.53      0.51
TOTAL                          6      18000      19.99       18.91      1.02
```

Gợi ý cỡ data:

| Mục đích | Cấu hình |
|---|---|
| Chạy thử nhanh | `DB_COUNT=2`, `COLLECTIONS_PER_DB=3`, `DOCS_PER_COLLECTION=3000`, `TARGET_MB_PER_DB=10` |
| Thấy rõ giai đoạn copy (vài phút) | `DB_COUNT=5`, `COLLECTIONS_PER_DB=10`, `DOCS_PER_COLLECTION=20000`, `TARGET_MB_PER_DB=200` |
| M0 | tổng < 300 MB |

Đặt `SEED=123` để lần sau sinh lại đúng bộ dữ liệu đó.

## 5.5 Traffic liên tục: `npm run connector`

[`tools/src/connector`](../tools/src/connector) giả lập ứng dụng đang chạy:

- khi start, liệt kê mọi DB/collection (bỏ DB hệ thống và DB nội bộ của mongosync), sau đó quét
  lại mỗi `DISCOVERY_REFRESH_SEC` giây;
- `READ_RATE` / `WRITE_RATE` op/giây; `WRITE_UPDATE_PERCENT` % số lần ghi là update, còn lại là insert;
- chọn doc ngẫu nhiên theo khoảng `_id` (dùng index, nhẹ cho DB);
- in thông lượng thật, latency p50/p95, số lỗi, số op bị `drop` (DB không theo kịp `MAX_INFLIGHT`).

```bash
npm run connector        # Ctrl+C để dừng; CONNECTOR_TARGET=src (mặc định)
```

```text
[03:51:42] read 50/s (target 50) p50 1.6ms p95 3.1ms err 0 drop 0 | write 20/s (target 20) p50 3.7ms p95 6.1ms err 0 drop 0 | targets 2 db / 6 coll
```

Để connector chạy trong `tmux` (pane riêng) suốt lúc sync, sẽ thấy:

- trong lúc `RUNNING`: không có lỗi; lag của mongosync tăng/giảm theo `WRITE_RATE`;
- sau `commit`: **`err` tăng, `last write error: User writes blocked`**, vì source đã bị khoá ghi
  ([00 §0.4](00-how-mongosync-works.md#04-write-blocking-ai-được-ghi-vào-đâu-lúc-nào-)).
  Lỗi này **chỉ xuất hiện khi connector dùng user không phải root**. Với user `admin` (root),
  ghi vẫn thành công. Muốn quan sát, tạo user app trên source:

  ```bash
  mongosh "$SRC_URI" --eval 'db.getSiblingDB("admin").createUser({user:"app", pwd:"app_pass", roles:["readWriteAnyDatabase"]})'
  ```

  rồi đặt `CONNECTOR_URI=mongodb://app:app_pass@10.20.0.11:27017,10.20.0.12:27017,10.20.0.13:27017/?replicaSet=src-rs&authSource=admin`
  trong `tools/.env`. Generator và compare vẫn dùng `SRC_URI`.

Cutover thật sự = tạo user `app` trên destination (mongosync không chuyển user), đổi
`CONNECTOR_URI` sang destination rồi chạy lại connector.

Tiếp theo: [Chạy mongosync](06-run-mongosync.md).
