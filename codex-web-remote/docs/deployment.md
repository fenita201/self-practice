# Deployment

Build phục vụ một port theo .env; đổi PORT/PUBLIC_URL không rebuild. Default loopback, ZeroTier dùng IP interface riêng. Không triển khai public Internet. Ubuntu 26.04.1 WSL2 đã chạy; chưa kiểm tra native Mini PC/ZeroTier client thật.

```bash
npm ci
npm run setup -- --root /home/myuser/projects --host 127.0.0.1 --port 3000
npm run set-password
npm run doctor
npm run build
npm start
```

Foreground startup in origin và host:port; EADDRINUSE lỗi rõ, không fallback port. `/healthz` 200 = HTTP service, `/readyz` 200 = initialize ready (không khẳng định auth/quota/provider health). Login/IDE hoạt động khi adapter unavailable; Status đưa hướng khắc phục.

Mẫu systemd `scripts/codex-remote.service` thay User, WorkingDirectory, EnvironmentFile, ExecStart đường dẫn node, PATH. Cài bằng admin sau review trên máy đích:

```bash
sudo cp scripts/codex-remote.service /etc/systemd/system/codex-remote.service
sudo systemctl daemon-reload
sudo systemctl enable --now codex-remote
systemctl status codex-remote
journalctl -u codex-remote -n 50
```

Các lệnh sudo là tài liệu, chưa được agent chạy. Service user phải sở hữu data/project và đã codex login. CODEX_BIN tuyệt đối/PATH Node24, CODEX_HOME đúng user; không copy credential. Template không sandbox service bằng root hay tự cấp full-access. SIGTERM/SIGINT: đóng HTTP/streams, watchers, child rồi DB; restart có thể ngắt active turn, startup unknown, không replay.

Backup dùng `npm run backup -- --out /safe/local/path/app.sqlite` (SQLite VACUUM INTO snapshot; target chưa tồn tại, mode600). Backup env bằng công cụ cục bộ an toàn. Offline restore: stop service, backup DB hiện tại, đưa snapshot vào data/app.sqlite, loại WAL/SHM cũ của instance đã dừng, chmod data700/DB600, doctor/start. Không merge journal vào Codex home. Không sửa lịch sử Codex.

Journal degraded marker được giữ qua restart để không nhầm stream đầy đủ. Khôi phục có chủ đích sau khi tăng EVENT_JOURNAL_MAX_BYTES/giải phóng disk: dừng app, chạy `npm run journal:recover`. Lệnh kiểm tra byte budget và xóa degraded marker; lịch sử thiếu trước đó vẫn có badge/log warning lưu checkpoint thiếu. Không xóa transcript Codex. Retention chỉ web events (30 ngày default), không dọn turn đang chạy/waiting, TTL cookie không ảnh hưởng agent.

Production test đổi port dùng env override + DATA_DIR riêng nếu instance khác cùng lúc, ví dụ PORT=4300 PUBLIC_URL=http://127.0.0.1:4300 DATA_DIR=./.test-data/alternate npm start. Không chạy hai backend dùng chung data directory; main có process lock.
