# 8. Troubleshooting

Những mục ghi ✔ đã được tái hiện thật khi xây lab (mongosync 1.22.0, MongoDB 8.0).

**Quy trình chung khi có sự cố:**

1. `ms.sh status`: process còn sống không, đang ở state nào?
2. Log mongosync: `jq -c 'select(.level!="info" and .level!="debug") | {time,level,message}' /var/log/mongosync/mongosync.log | tail`
3. Lỗi trả về từ API có `error` + `errorDescription`: đọc kỹ, thường đã nói cách sửa.
4. Kiểm tra từ phía cluster: `rs.status()`, log mongod, DB `__mdb_internal_mongosync` trên đích.

## 8.1 Lỗi kết nối / xác thực

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| `Authentication failed` | sai password; password có `@ : /` mà chưa URL-encode; thiếu `authSource=admin` | encode password (`@`→`%40`), thêm `authSource=admin` |
| `ServerSelectionTimeout` / `ECONNREFUSED` | firewall, mongod không chạy, sai IP/port | `nc -zv <ip> 27017`; trên VM: `systemctl status mongod` |
| Kết nối được 1 node nhưng lỗi với replica set | tên member trong `rs.conf()` không tới được từ máy client (`localhost`, IP WSL cũ, hostname container) | `rs.conf().members.map(m=>m.host)` phải là địa chỉ client tới được. Docker: sửa `MONGO_HOST` + recreate `*-init` |
| (B) `no such host lab-m10-pri...` | chạy ngoài VPC, hoặc peering chưa `ACTIVE` | chỉ kết nối từ `lab-sync-1`; `gcloud compute networks peerings list --network=lab-vpc` |
| (B/C) kết nối Atlas bị treo rồi timeout | IP/subnet chưa có trong Atlas IP Access List | (B) subnet `10.21.0.0/24`; (C) IP NAT: `curl -s https://checkip.amazonaws.com` trên VM phải khớp |
| Lỗi quyền khi `/start` | user thiếu role | self-managed: chạy lại `init-replset.js`; Atlas: user phải có `mongosyncDestination` |

## 8.2 Process / API

**`curl: (7) Failed to connect to 127.0.0.1 port 27182`** ✔: process chưa chạy, đã thoát, hoặc
chạy port khác.

```bash
pgrep -a mongosync
ss -lntp | grep 27182
tail -n 50 /var/log/mongosync/mongosync.log | jq -rc '"\(.time) \(.level) \(.message)"'
```

**Kẹt ở `INITIALIZING` lâu** ✔: sau restart có thể mất khoảng 2 phút, đó là bình thường. Nếu sau
đó process tự thoát, đọc dòng `fatal` cuối trong log (ví dụ gặp lại `VerifierMemoryLimit` ở 8.3).

**`StartWhileInitializing`** ✔: gọi `/start` khi chưa `IDLE`. Đợi `ms.sh status` ra `IDLE`.

**`InvalidStateTransition ... cannot transition from RUNNING to RUNNING`** ✔: migration đã chạy
(thường do restart và mongosync tự resume). Không cần `/start` nữa.

**`InvalidStateTransition ... from COMMITTED`** ✔: metadata của một migration đã commit vẫn còn
trên cụm đích. Muốn chạy migration mới, reset theo 8.7.

**`Unrecognized key in request: enableUserWriteBlocking`** ✔: khoá của bản cũ, 1.22 không nhận.
Bỏ khoá này đi (write blocking giờ luôn bật, xem [00 §0.4](00-how-mongosync-works.md#04-write-blocking-ai-được-ghi-vào-đâu-lúc-nào-)).

**Process chết khi đang `RUNNING`**: chạy lại **đúng lệnh cũ, cùng URI**. Mongosync đọc metadata
trên destination và tự resume ✔. Không gọi `/start` lại, không xoá destination.

## 8.3 Verifier thiếu RAM: `VerifierMemoryLimit` ✔

```text
"error": "VerifierMemoryLimit",
"errorDescription": "Approximately 18000 docs found on the source cluster. At least 11 GB of RAM is
estimated to be required for running mongosync with verification in this migration, but only 7 GB is available..."
```

Cách xử lý:

1. **Chưa từng start thành công**: start lại với verifier tắt:
   `ms.sh start '{"source":"cluster0","destination":"cluster1","verification":{"enabled":false}}'`
2. **Restart và mongosync tự resume rồi lại chết vì lỗi này** (metadata đã ghi verifier = bật):
   chạy lại process kèm cờ `--disableVerification`:

   ```bash
   mongosync --config /etc/mongosync/config.yaml --disableVerification
   ```

3. Hoặc tăng RAM cho VM (`machine_type` trong `infra/live/gcp/sync-vm`).

**`DisableVerificationOnStart: the flag DisableVerification should only be passed in when mongosync
is restarted`** ✔: cờ `--disableVerification` chỉ dùng khi **resume** migration cũ. Với migration
mới thì bỏ cờ, tắt verifier bằng body `/start` như cách 1.

## 8.4 Lag tăng mãi, không bao giờ `canCommit`

- Ghi vào source nhanh hơn mongosync áp được: giảm `WRITE_RATE` của connector, tăng `loadLevel`, tăng cỡ VM đích.
- Destination quá yếu (M10, e2-small): theo dõi CPU/disk của destination.
- **Oplog quá nhỏ**: nếu giai đoạn copy kéo dài hơn khoảng thời gian oplog source giữ được, change
  stream mất điểm resume (log có `ChangeStreamHistoryLost` hoặc thông báo oplog rollover). Migration
  đó không cứu được: reset theo 8.7, tăng `OPLOG_MB` khi cài source (hoặc
  `db.adminCommand({replSetResizeOplog: 1, size: 4096})` trên từng node), rồi chạy lại.

Xem oplog source đang giữ được bao lâu:

```bash
mongosh "$SRC_URI" --quiet --eval 'rs.printReplicationInfo()'
```

## 8.5 Gỡ write block thủ công ✔

Sau commit, source bị khoá ghi (đích bị khoá trong lúc sync). Chỉ gỡ tay khi **bỏ hẳn**
migration, hoặc mongosync chết trong lúc commit và bạn quyết định chạy lại từ đầu.

Triệu chứng ở ứng dụng (user không phải root): `User writes blocked, reason: Unspecified`.

Chạy trên PRIMARY bằng user `admin`:

```javascript
db.adminCommand({ setUserWriteBlockMode: 1, global: false })
```

Nếu báo lỗi kiểu:

```text
Cannot release user writes critical section with different reason than the already existing one.
reason: ClusterToClusterMigrationInProgress, current: Unspecified
```

thì **reason lúc gỡ phải giống reason lúc khoá**. Đọc giá trị `current:` trong lỗi:

```javascript
// current: Unspecified
db.adminCommand({ setUserWriteBlockMode: 1, global: false })
// current: ClusterToClusterMigrationInProgress
db.adminCommand({ setUserWriteBlockMode: 1, global: false, reason: "ClusterToClusterMigrationInProgress" })
```

MongoDB không có lệnh `getUserWriteBlockMode`; cách nhanh nhất để biết đang bị khoá không là ghi
thử bằng user **không phải root** (root luôn bypass được).

## 8.6 Process chết trong lúc commit

Nếu verifier đang bật và mongosync chết trước khi đạt `COMMITTED`, khi restart có thể gặp:

```text
failed to restart mongosync during commit ... please restart the migration
```

Dừng mọi chương trình ghi vào source và destination, rồi chọn:

**Phương án A: tiếp tục migration hiện tại, tắt verifier.** Giữ nguyên dữ liệu và metadata ở
destination, không gọi `/start`:

```bash
mongosync --config /etc/mongosync/config.yaml --disableVerification
```

Chờ `COMMITTED` + `canWrite: true`, rồi kiểm tra thủ công ([bước 7](07-verify.md)) vì verifier đã tắt.

**Phương án B: xoá đích và chạy lại từ đầu.** Dùng khi A vẫn lỗi, hoặc source đã có ghi sau khi
commit bị gián đoạn: làm theo 8.7.

## 8.7 Reset để chạy migration mới từ đầu ✔

1. Dừng mongosync (`Ctrl-C` hoặc `pkill -x mongosync`) và connector.
2. Gỡ write block trên **cả hai** cụm (8.5).
3. Xoá metadata `__mdb_internal_mongosync` trên **cả hai** cụm. Sau reverse, metadata nằm trên
   cụm nguồn ✔; quên bước này thì mongosync vẫn nhớ trạng thái `COMMITTED`.
4. Xoá dữ liệu đã sync trên destination.

Xem trước những gì sẽ bị xoá trên destination:

```bash
mongosh "$DST_URI" --quiet --eval '
  db.adminCommand({listDatabases: 1, nameOnly: true}).databases
    .map(x => x.name).filter(x => !["admin", "config", "local"].includes(x)).forEach(x => print(x))'
```

Xoá (**chỉ khi destination dành riêng cho lab này**):

```bash
mongosh "$DST_URI" --quiet --eval '
  db.adminCommand({listDatabases: 1, nameOnly: true}).databases
    .map(x => x.name).filter(x => !["admin", "config", "local"].includes(x))
    .forEach(x => { print("drop " + x); db.getSiblingDB(x).dropDatabase(); })'

mongosh "$SRC_URI" --quiet --eval 'db.getSiblingDB("__mdb_internal_mongosync").dropDatabase()'
```

Không xoá dữ liệu ứng dụng trên source. Nếu giữ dữ liệu cũ ở đích rồi `/start` migration mới,
có thể gặp namespace conflict, doc thừa/cũ, lệch count/hash.

5. Chạy lại mongosync (không cờ `--disableVerification`), chờ `IDLE`, rồi `/start`.

## 8.8 Lỗi phía MongoDB / Docker

| Triệu chứng | Xử lý |
|---|---|
| mongod chết, log `Too many open files` | tăng `nofile` (compose đã đặt 64000; systemd của gói `mongodb-org` đặt sẵn) |
| mongod bị OOM kill trên VM nhỏ | giảm `CACHE_GB` khi cài, hoặc tăng machine type |
| `*-init` (Docker) không `Exited (0)` | `docker compose logs src-init`; thường do `MONGO_HOST` sai |
| IP WSL đổi sau restart | sửa `MONGO_HOST` rồi `docker compose up -d --force-recreate src-init dst-init` |
| VM: `permissions on /etc/mongodb-keyfile are too open` | `sudo chmod 400 /etc/mongodb-keyfile && sudo chown mongodb:mongodb /etc/mongodb-keyfile` |
| VM: member không vào replica set, log `Authentication failed` giữa các node | các node đang dùng keyFile khác nhau, copy lại cùng một file |

## 8.9 Lỗi Terraform / Terragrunt

| Triệu chứng | Xử lý |
|---|---|
| `GCP_PROJECT_ID` / `ATLAS_ORG_ID` not found | `source infra/.env` (chạy từ thư mục gốc repo) |
| `Unsupported attribute` / thiếu key khi render | tên block trong `values.yaml` phải trùng tên folder unit |
| `cached package ... does not match any of the checksums` | bỏ `TF_PLUGIN_CACHE_DIR`, dùng `TG_PROVIDER_CACHE=1`; xoá `.terragrunt-cache` rồi chạy lại |
| Atlas `401` / `IP_ADDRESS_NOT_ON_ACCESS_LIST` | thêm IP máy bạn vào API Access List của API key |
| Peering không `ACTIVE` | cần cả hai phía; apply lại `atlas/m10-project`; CIDR không được trùng |
| `terragrunt` dùng output giả (`mock`) khi apply | unit phụ thuộc chưa apply: apply theo đúng thứ tự trong [2.6](02-gcp-infra.md#26-tạo-hạ-tầng) |
| Lỗi lạ sau khi đổi module | xoá cache: `find infra -name .terragrunt-cache -prune -exec rm -rf {} +` |
