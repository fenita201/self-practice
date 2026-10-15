# 4. Cluster đích

Làm **một** trong ba mục dưới đây, theo hướng bạn đã chọn ở [README](../README.md#chọn-destination).

| Mục | Destination | Kết quả cần có cho bước sau |
|---|---|---|
| [4A](#4a-cụm-vm-khác-dst-rs) | 3 VM `dst-rs` | URI `mongosync` + `admin` của `dst-rs` |
| [4B](#4b-atlas-m10-qua-vpc-peering) | Atlas M10 | private SRV + password user `mongosync` |
| [4C](#4c-atlas-m0-free-không-dùng-được-với-mongosync) | Atlas M0 | SRV + password user `lab_app` |

---

## 4A. Cụm VM khác (`dst-rs`)

Cần unit `gcp/dst-vms` đã apply ở [2.6](02-gcp-infra.md#26-tạo-hạ-tầng). Các bước giống hệt
[bước 3](03-source-cluster.md), chỉ đổi tên VM, replica set và IP:

```bash
umask 077 && openssl rand -base64 756 > /tmp/dst-keyfile      # keyFile riêng cho cụm đích

for vm in lab-dst-1 lab-dst-2 lab-dst-3; do
  gcloud compute scp --tunnel-through-iap \
    scripts/mongo/install-mongodb.sh scripts/mongo/init-replset.js /tmp/dst-keyfile "$vm:/tmp/"
  gcloud compute ssh "$vm" --tunnel-through-iap --command \
    'sudo RS_NAME=dst-rs KEYFILE_SRC=/tmp/dst-keyfile CACHE_GB=0.5 bash /tmp/install-mongodb.sh && rm -f /tmp/dst-keyfile'
done

gcloud compute ssh lab-dst-1 --tunnel-through-iap
```

Trên `lab-dst-1`:

```bash
read -rsp 'admin password: ' ADMIN_PASSWORD; echo
read -rsp 'mongosync password: ' SYNC_PASSWORD; echo
export ADMIN_PASSWORD SYNC_PASSWORD ADMIN_USER=admin SYNC_USER=mongosync
export RS_NAME=dst-rs RS_MEMBERS=10.20.0.21:27017,10.20.0.22:27017,10.20.0.23:27017
mongosh --quiet /tmp/init-replset.js
unset ADMIN_PASSWORD SYNC_PASSWORD
```

URI cho bước sau:

```text
mongosync: mongodb://mongosync:<DST_SYNC_PASSWORD>@10.20.0.21:27017,10.20.0.22:27017,10.20.0.23:27017/?replicaSet=dst-rs&authSource=admin
admin    : mongodb://admin:<DST_ADMIN_PASSWORD>@10.20.0.21:27017,10.20.0.22:27017,10.20.0.23:27017/?replicaSet=dst-rs&authSource=admin
```

Lưu ý: mongosync **không chuyển user/role**. User ứng dụng phải tạo lại trên `dst-rs` trước khi cutover.

---

## 4B. Atlas M10 qua VPC peering

> M10 tính phí theo giờ ngay khi được tạo. Tạo xong thì làm lab liền, xong thì destroy.

### Tạo bằng Terragrunt

```bash
source infra/.env                        # cần ATLAS_ORG_ID + MONGODB_ATLAS_* (xem 2.4)
cd infra/live/atlas
(cd m10-project && terragrunt apply)     # Atlas project + network container 10.30.0.0/21 + peering 2 chiều
(cd m10-cluster && terragrunt apply)     # cluster lab-m10 (3 node, 8.0) + user mongosync
```

`m10-project` tạo:

- network container `10.30.0.0/21` (không được trùng `10.20.0.0/24` và `10.21.0.0/24`);
- peering phía Atlas (`mongodbatlas_network_peering`) **và** phía GCP (`google_compute_network_peering`);
  thiếu một trong hai thì peering không `ACTIVE`;
- IP access list = subnet `sync` (`10.21.0.0/24`), vì Atlas vẫn kiểm tra access list kể cả khi đi qua peering.

`m10-cluster` tạo custom role `mongosyncDestination` (= `atlasAdmin` + `BYPASS_USER_WRITE_BLOCK`)
và user `mongosync` mang role đó, password do Terraform sinh.

Cluster M10 mất khoảng 7–15 phút để provision.

### Kiểm tra peering

```bash
gcloud compute networks peerings list --network=lab-vpc     # STATE phải là ACTIVE
```

Trong Atlas UI: **Network Access → Peering**, trạng thái *Available*.

### Lấy connection string và password

```bash
cd infra/live/atlas/m10-cluster
terragrunt output -json cluster        | jq -r '.connection_strings.private_srv'
terragrunt output -json database_users | jq -r '.mongosync.password'
```

`private_srv` có dạng `mongodb+srv://lab-m10-pri.xxxxx.mongodb.net`. Hostname `-pri` chỉ resolve
và kết nối được **từ bên trong VPC đã peering**, nên trên máy local sẽ không kết nối được, đó là
bình thường. Nếu `private_srv` rỗng thì peering chưa sẵn sàng: đợi rồi chạy `terragrunt apply -refresh-only`.

URI cho bước sau (dùng chung cho mongosync và tools):

```text
mongodb+srv://mongosync:<PASSWORD>@lab-m10-pri.xxxxx.mongodb.net/?authSource=admin
```

Thử kết nối từ `lab-sync-1` ở [bước 5](05-data-and-traffic.md#53-kiểm-tra-kết-nối).

---

## 4C. Atlas M0 (Free): không dùng được với mongosync

**mongosync không hỗ trợ M0/Flex** (shared tier). Hướng này dùng để:

- luyện Terraform cho Atlas (project, IP access list, cluster, database user);
- kết nối Atlas từ VM private qua **Cloud NAT IP tĩnh**;
- migrate **offline** bằng `mongodump`/`mongorestore`, rồi so với cách online của mongosync.

### Tạo bằng Terragrunt

```bash
source infra/.env
cd infra/live/atlas
(cd m0-project && terragrunt apply)      # project + access list = IP NAT của lab-vpc (+ MY_PUBLIC_IP nếu đặt)
(cd m0-cluster && terragrunt apply)      # cluster lab-m0 + user lab_app (readWriteAnyDatabase)

cd m0-cluster
terragrunt output -json cluster        | jq -r '.connection_strings.standard_srv'
terragrunt output -json database_users | jq -r '.lab_app.password'
```

M0 không có VPC peering, nên VM đi ra Internet qua Cloud NAT. `m0-project` tự lấy `nat_ip` từ unit
`gcp/vpc` để whitelist; mỗi lần đổi NAT IP thì apply lại `m0-project`.

Giới hạn M0 cần nhớ: 512 MB dung lượng, throughput bị giới hạn, không chỉnh version/oplog/backup.
Giữ data test nhỏ (`TARGET_MB_PER_DB` × `DB_COUNT` < 300 MB).

### Migrate offline: mongodump → mongorestore

Chạy trên `lab-sync-1` sau khi đã cài tools ở [bước 5](05-data-and-traffic.md) (gói
`mongodb-database-tools`):

```bash
SRC_ADMIN_URI='mongodb://admin:<SRC_ADMIN_PASSWORD>@10.20.0.11:27017,10.20.0.12:27017,10.20.0.13:27017/?replicaSet=src-rs&authSource=admin'
M0_URI='mongodb+srv://lab_app:<PASSWORD>@lab-m0.xxxxx.mongodb.net/?authSource=admin'

mongodump    --uri "$SRC_ADMIN_URI" --nsInclude 'synctest_db_*.*' --gzip --archive=/tmp/src.archive
mongorestore --uri "$M0_URI" --gzip --archive=/tmp/src.archive --drop
```

So sánh với mongosync:

| | mongodump/restore | mongosync |
|---|---|---|
| Ứng dụng phải dừng ghi | **suốt** quá trình dump + restore | chỉ lúc commit |
| Thay đổi sau thời điểm dump | mất (trừ khi dùng `--oplog`, chỉ áp dụng khi dump toàn cluster) | được áp liên tục |
| Phù hợp | data nhỏ, chấp nhận downtime, đích là M0/Flex | migrate online, data lớn |

Kiểm tra kết quả bằng `npm run compare` với `DST_URI=$M0_URI` ([bước 7](07-verify.md)).
Không dùng `HASH=true`: shared tier thường không cho chạy `dbHash`.

Tiếp theo: [Cài lab-sync-1, sinh data và traffic](05-data-and-traffic.md).
