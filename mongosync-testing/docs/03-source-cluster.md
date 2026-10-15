# 3. Cluster nguồn trên VM (`src-rs`)

Mục tiêu: 3 VM `lab-src-1..3` chạy MongoDB 8.0, replica set `src-rs`, bật auth + keyFile,
có user `admin` và `mongosync`.

```text
lab-src-1 10.20.0.11:27017  (priority 2 => thường là PRIMARY)
lab-src-2 10.20.0.12:27017
lab-src-3 10.20.0.13:27017
```

Mọi lệnh chạy từ **thư mục gốc repo** trên máy local, trừ khi ghi "trên VM".

## 3.1 Vì sao cần keyFile

Khi bật `authorization`, các member trong replica set cũng phải xác thực lẫn nhau. keyFile là
"mật khẩu chung" giữa các member. Mọi node của **cùng một** replica set phải dùng cùng một
keyFile. Cluster khác (đích) dùng keyFile khác cũng được, vì mongosync đăng nhập bằng user chứ
không bằng keyFile.

```bash
umask 077
openssl rand -base64 756 > /tmp/src-keyfile
```

## 3.2 Copy script + keyFile lên 3 VM

```bash
for vm in lab-src-1 lab-src-2 lab-src-3; do
  gcloud compute scp --tunnel-through-iap \
    scripts/mongo/install-mongodb.sh scripts/mongo/init-replset.js /tmp/src-keyfile \
    "$vm:/tmp/"
done
```

## 3.3 Cài MongoDB trên từng VM

[`install-mongodb.sh`](../scripts/mongo/install-mongodb.sh) làm các việc sau:

1. thêm apt repo MongoDB 8.0 và cài `mongodb-org` (gồm `mongod` + `mongosh`);
2. cài keyFile vào `/etc/mongodb-keyfile` (owner `mongodb`, quyền `400`);
3. ghi `/etc/mongod.conf`: bind `127.0.0.1` + IP nội bộ, `replSetName`, `oplogSizeMB: 2048`,
   `authorization: enabled`, WiredTiger cache 0.25 GB (VM e2-small chỉ có 2 GB RAM);
4. `systemctl enable --now mongod`.

```bash
for vm in lab-src-1 lab-src-2 lab-src-3; do
  gcloud compute ssh "$vm" --tunnel-through-iap --command \
    'sudo RS_NAME=src-rs KEYFILE_SRC=/tmp/src-keyfile bash /tmp/install-mongodb.sh && rm -f /tmp/src-keyfile'
done
```

Lúc này mỗi node đang chạy nhưng replica set **chưa được khởi tạo** và chưa có user nào.

## 3.4 Khởi tạo replica set + user

SSH vào node đầu tiên:

```bash
gcloud compute ssh lab-src-1 --tunnel-through-iap
```

Trên VM (nhập password, không để lộ trong history):

```bash
read -rsp 'admin password: ' ADMIN_PASSWORD; echo
read -rsp 'mongosync password: ' SYNC_PASSWORD; echo
export ADMIN_PASSWORD SYNC_PASSWORD ADMIN_USER=admin SYNC_USER=mongosync
export RS_NAME=src-rs RS_MEMBERS=10.20.0.11:27017,10.20.0.12:27017,10.20.0.13:27017

mongosh --quiet /tmp/init-replset.js
unset ADMIN_PASSWORD SYNC_PASSWORD
```

Kết quả mong đợi:

```text
[src-rs] rs.initiate done
created user admin
created role mongosyncOplog
created user mongosync
[src-rs] OK
```

Vì sao kết nối được dù đã bật auth? Nhờ **localhost exception**: khi chưa có user nào,
kết nối từ `localhost` được phép tạo user đầu tiên. Ngay khi `admin` được tạo, exception đóng
lại. Chạy lại script bao nhiêu lần cũng an toàn: nó nhận ra đã init và chỉ kiểm tra user/role.

Lưu hai password vào password manager. Password dùng trong URI phải **URL-encode**
(`@` → `%40`, `:` → `%3A`, `/` → `%2F`). Để đỡ rắc rối, dùng password chỉ gồm chữ và số.

## 3.5 Kiểm tra

Vẫn trên `lab-src-1`:

```bash
mongosh "mongodb://10.20.0.11:27017,10.20.0.12:27017,10.20.0.13:27017/?replicaSet=src-rs" \
  -u admin --authenticationDatabase admin \
  --eval 'rs.status().members.map(m => ({name: m.name, state: m.stateStr}))'
```

Phải có đúng **1 `PRIMARY` + 2 `SECONDARY`**. Thử failover cho hiểu replica set:

```bash
sudo systemctl stop mongod      # trên PRIMARY; chờ ~10 giây, một SECONDARY sẽ lên PRIMARY
sudo systemctl start mongod
```

Debug khi node không lên:

```bash
sudo systemctl status mongod
sudo tail -n 50 /var/log/mongodb/mongod.log | jq -c '{t: .t."$date", s, msg, attr}'   # log là JSON
```

Lỗi hay gặp: keyFile sai quyền (`permissions on /etc/mongodb-keyfile are too open`), các node
dùng keyFile khác nhau (log `Authentication failed` giữa các member), firewall chặn 27017 giữa các VM.

Tiếp theo: [Cluster đích](04-destination.md).
