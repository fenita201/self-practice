# 6. Chạy mongosync: start → theo dõi → commit → reverse

Áp dụng cho hướng **A** (VM → VM) và **B** (VM → Atlas M10). Lab Docker: xem
[01 §1.4](01-local-docker.md#14-chạy-mongosync-trong-container) để khởi động, các bước còn lại giống trang này.

Trước khi bắt đầu cần có: source có data ([bước 5](05-data-and-traffic.md)), destination
**trống**, và connector sẵn sàng chạy.

## 6.1 Cài binary

Trên `lab-sync-1`:

```bash
bash ~/lab/scripts/download-mongosync.sh            # => ~/lab/bin/mongosync (mặc định 1.22.0)
sudo install -m 0755 ~/lab/bin/mongosync/bin/mongosync /usr/local/bin/mongosync
sudo install -m 0755 ~/lab/scripts/mongosync/ms.sh /usr/local/bin/ms.sh
mongosync --version
```

## 6.2 File cấu hình

```bash
sudo mkdir -p /etc/mongosync /var/log/mongosync
sudo chown "$(id -u):$(id -g)" /var/log/mongosync
sudo install -m 600 -o "$(id -u)" ~/lab/scripts/mongosync/config.example.yaml /etc/mongosync/config.yaml
nano /etc/mongosync/config.yaml
```

Trong [`config.example.yaml`](../scripts/mongosync/config.example.yaml):

- `cluster0` = source `src-rs`, user **`mongosync`**;
- `cluster1` = giữ dòng (A) **hoặc** bỏ comment dòng (B), đúng một dòng;
- `loadLevel: 2` (1–4, mặc định 3): mức song song khi copy. VM nhỏ/M10 nên để 1–2 để không làm
  nghẽn cluster đang phục vụ ứng dụng.

Không dùng user `admin` cho mongosync: dùng đúng user có quyền tối thiểu là một phần của bài học.

## 6.3 Chạy process

Chạy trong `tmux` để SSH bị ngắt thì process vẫn sống:

```bash
tmux new -s ms
mongosync --config /etc/mongosync/config.yaml
# Ctrl-b rồi d để thoát ra (detach); quay lại: tmux attach -t ms
```

Hoặc chạy bằng systemd: [`mongosync.service`](../scripts/mongosync/mongosync.service).

Mở pane/terminal khác và theo dõi:

```bash
ms.sh status        # chờ "state": "IDLE"
```

Process mới chạy lần đầu sẽ ở `INITIALIZING` vài giây tới khoảng 2 phút rồi sang `IDLE`.
Nếu `curl: Failed to connect ... 27182` thì process chưa chạy hoặc đã thoát, xem
[08 §8.2](08-troubleshooting.md#82-process--api).

Muốn gọi API từ máy local, mở SSH tunnel:

```bash
gcloud compute ssh lab-sync-1 --tunnel-through-iap -- -N -L 27182:127.0.0.1:27182
# terminal khác trên máy local:
./scripts/mongosync/ms.sh status
```

## 6.4 Start

Chọn một trong hai:

```bash
# Mặc định: embedded verifier BẬT (cần RAM, xem 00 §0.5; e2-standard-4 16 GB là đủ cho lab)
ms.sh start

# Có reverse (6.7) và tắt verifier
ms.sh start '{"source":"cluster0","destination":"cluster1","reversible":true,"verification":{"enabled":false}}'
```

Kết quả `{"success": true}`. Nếu nhận `VerifierMemoryLimit` thì xem
[08 §8.3](08-troubleshooting.md#83-verifier-thiếu-ram-verifiermemorylimit-).

Ngay sau khi start, bật traffic ở pane khác: `cd ~/lab/tools && npm run connector`.

## 6.5 Theo dõi

```bash
ms.sh watch            # 5 giây / lần; ms.sh progress để xem đầy đủ JSON
```

| Bạn thấy | Nghĩa là |
|---|---|
| `phase: "collection copy"`, `copied` tăng dần | đang copy dữ liệu có sẵn |
| `phase: "change event application"`, `copied: 100%` | copy xong, đang áp thay đổi mới |
| `lagTimeSeconds` nhỏ và ổn định | destination bám kịp source |
| `canCommit: true` | có thể commit |
| `lagTimeSeconds` tăng mãi | ghi vào source nhanh hơn tốc độ mongosync áp; giảm `WRITE_RATE` hoặc tăng `loadLevel` |

Đọc log (dạng JSON, mỗi dòng một event):

```bash
tail -f /var/log/mongosync/mongosync.log | jq -rc '"\(.time) \(.level) \(.message)"'
# chỉ cảnh báo/lỗi:
jq -c 'select(.level=="warn" or .level=="error" or .level=="fatal") | {time, level, message}' /var/log/mongosync/mongosync.log
```

Thử nhìn từ phía destination: DB `__mdb_internal_mongosync` xuất hiện (metadata của mongosync),
và các DB `synctest_db_*` được tạo dần. Ghi vào destination bằng user thường lúc này sẽ bị chặn.

## 6.6 Commit và cutover

1. Dừng connector (Ctrl+C) và mọi thứ đang ghi vào source. Nếu không dừng, mongosync vẫn tự khoá
   ghi source khi commit, nhưng ứng dụng sẽ nhận lỗi ghi.
2. Chờ `canCommit: true` và `lagTimeSeconds` về gần 0.
3. Commit đúng **một lần**:

   ```bash
   ms.sh commit
   ms.sh watch 2
   ```

4. Chờ `"state": "COMMITTED"` và `"canWrite": true`.
5. [Kiểm tra dữ liệu](07-verify.md) rồi mới chuyển ứng dụng sang destination: tạo user ứng dụng
   trên destination, đổi URI, chạy lại connector với destination.

Sau commit, **source bị khoá ghi** (user thường nhận `User writes blocked`). Đây là cơ chế bảo vệ
để không ai ghi nhầm vào cụm cũ. Nếu bỏ hẳn migration và muốn dùng lại source, xem
[08 §8.5](08-troubleshooting.md#85-gỡ-write-block-thủ-công-).

## 6.7 (Tuỳ chọn) Reverse: rollback về cụm cũ

Chỉ làm được khi đã start với `"reversible": true`. Đã thử với hướng A. Với Atlas, user phía
Atlas cần thêm quyền của vai trò source, xem tài liệu mongosync.

```bash
ms.sh reverse        # state: RUNNING, directionMapping đảo: Source = cluster1, Destination = cluster0
ms.sh watch          # chờ canCommit: true
ms.sh commit         # COMMITTED: giờ src ghi được, dst bị khoá ghi
```

Đã quan sát được: trong lúc reverse, `src-rs` (lúc này là đích) bị khoá ghi; sau commit reverse,
`src-rs` mở ghi còn `dst-rs` bị khoá. Metadata `__mdb_internal_mongosync` lúc này nằm trên
`src-rs`.

## 6.8 Bài tập: process chết giữa chừng

Trong lúc `RUNNING`, vào pane mongosync nhấn `Ctrl-C` (hoặc `pkill -x mongosync`), rồi chạy lại
**đúng lệnh cũ**:

```bash
mongosync --config /etc/mongosync/config.yaml
```

Sau khoảng 2 phút `INITIALIZING`, state tự về `RUNNING` và sync tiếp từ checkpoint. **Không gọi
`/start` lại**: sẽ nhận `InvalidStateTransition` vì migration đang chạy. Không xoá gì ở destination.

Tiếp theo: [Kiểm tra dữ liệu](07-verify.md).
