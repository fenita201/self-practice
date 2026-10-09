# Handoff — 2026-10-09 07:36 UTC

Cập nhật mới nhất — 2026-10-09 09:52 UTC: model/effort hiển thị giá trị kế thừa từ session; header có nhãn model, mức suy luận, context đã dùng và hạn mức 5 giờ/1 tuần còn lại. Context dùng last.totalTokens/modelContextWindow (không dùng tổng token tích lũy). Status dịch thuật ngữ; trạng thái xanh/vàng/tím/đỏ; các khu vực có nền và điểm nhấn riêng ở cả hai theme. Phone/tablet gom thao tác phụ vào “Thông tin & thao tác session”, landscape có bố cục gọn. Bug register B24–B26.

Kiểm tra cuối: typecheck/format/build PASS, 18 unit/backend và 12 browser tests PASS. QA với backend Codex thật, không gọi model mới, 5 viewport × 2 theme PASS, contrast chip ≥4.5 và nút Gửi trong viewport. Evidence: docs/evidence/metadata-final.json, metadata-manual.json và metadata-real-*.png. Đã cập nhật .gitignore, xác nhận 10 loại file riêng được ignore, source/template/evidence được giữ.

**App và toàn bộ server QA đã dừng theo yêu cầu user.** PID78576 và app-server con PID78620 đã thoát; cổng3000 và3107 đóng. Không tự start lại. Người dùng chạy `npm start` từ thư mục dự án, rồi mở http://localhost:3000. Build đã có sẵn; không cần chạy app-server riêng. Không đổi password hay .env, không commit/push. Những dòng “đang chạy” phía dưới chỉ là lịch sử.


Update mới nhất 2026-10-09 08:54 UTC: đã hoàn tất redesign theo ui-ux-pro-max (cài `/home/ploi26/.codex/skills/ui-ux-pro-max`, nguồn repo user gửi). Login/header/theme, Sessions/Files/editor/chat/Status cùng design system; sáng/tối lưu lựa chọn. Usage/Status có metrics và quota bars/reset, raw JSON ở Chi tiết đóng mặc định. UI audit và các nút: docs/ui-ux-review.md; bug register B15–B23. Snapshot/composer khóa ngay khi bấm Chat mới để không gửi nhầm vào chat cũ; test xác nhận ID mới và decline/cancel đúng decision. Editor lazy-load: JS đầu129.12KB gzip, editor249.66KB gzip; chunk editor vẫn warning build.

Kiểm tra cuối PASS: typecheck, format, build,15 unit/backend,10 browser (1worker), doctor init/auth/list. Real QA ở5 kích thước×2themes PASS,20 nhóm nút/disk save/backend thật, không gọi thêm model trong UI QA. Real Steer task trước đó hoàn thành/persist đúng. Evidence docs/evidence/redesign-final.json, redesign-manual.json, chat-session-steer-live.json và redesign-real-*.png. scripts/qa-live-regression.ts dùng quota có chủ đích; scripts/qa-redesign.ts dùng DB/root test riêng và yêu cầu evidence/task test đã tồn tại.

App đang chạy npm start, PID78576 tại http://localhost:3000, HOST0.0.0.0; health/ready200 lúc08:54. Password user giữ nguyên. Refresh Ctrl+F5 để nạp UI mới. Các test server đã dừng, không có QA model task active. Không commit/push, không đổi firewall/ZeroTier/systemd. Vẫn thiếu live CLI độc lập (#11), chưa nghiệm thu phone/ZeroTier vật lý. Các update/bàn giao phía dưới là lịch sử trước cập nhật này.

Update 2026-10-09 08:16 UTC: sửa Chat mới chưa materialize (history rỗng đúng RPC), fresh thread vẫn hiện Sessions, auto refresh 5s/focus giữ pagination/filter, Steer có busy/feedback và request ID dùng getRandomValues cho HTTP LAN. Typecheck/build/format PASS, 15 unit/backend tests và 6 browser tests PASS. Real regression thread/turn/steer hoàn thành, message bổ sung persist: docs/evidence/chat-session-steer-live.json. App restart npm start ở localhost:3000; PID hiện tại xem lock. Đang tiếp tục yêu cầu cài ui-ux-pro-max-skill và redesign toàn UI/UX sáng/tối.

Update 2026-10-09 07:54 UTC: theo yêu cầu dùng localhost trong WSL, `.env` hiện HOST=0.0.0.0, PORT=3000, PUBLIC_URL=http://localhost:3000. Instance cũ đã dừng và production đã restart bằng npm start; PID hiện tại xem data/instance.lock. health/ready 200. Browser login localhost vượt Origin check; thử password sai trả 401, origin 127.0.0.1/IP cũ vẫn 403 đúng policy. Không xác minh login thành công với password hiện tại của user, không đổi password. Evidence docs/evidence/localhost-origin.json. Trạng thái URL/PID bên dưới là lịch sử của bàn giao trước update này.

App **đang chạy production**, foreground `npm start`, http://127.0.0.1:3000; PID 56705 (kiểm tra hiện tại trong data/instance.lock), health200/ready200. Port4300 và test server3107 đã dừng. Không có active model task của QA còn chạy. Không cài systemd/không đổi SSH/ZeroTier/firewall/không root.

```bash
cd /mnt/d/tmp/self-practice/codex-web-remote
npm start
```

Chỉ chạy lệnh trên khi instance hiện tại đã dừng. Đổi password bằng npm run set-password (không cần restart, thu hồi login cũ). Password bootstrap ngẫu nhiên riêng trong data/initial-password.txt, ignored/mode600, không in vào chat/log. .env dùng root workspace/ riêng, loopback3000. Chỉnh PROJECT_ROOTS/HOST/PORT/PUBLIC_URL cho môi trường đích rồi restart; không rebuild frontend khi đổi port.

Nguồn: đặc tả v3 giữ nguyên. Root Git repo cha `/mnt/d/tmp/self-practice`, main/origin self-practice; có dự án khác dirty. Không commit/push/stage repo cha. Thay đổi chỉ nằm folder codex-web-remote; package-lock pin đầy đủ.

Đã qua npm ci, format:check, typecheck, 14 unit/backend/protocol tests, build, 4 Playwright desktop/mobile fixtures, doctor init/auth/list thật. Live smoke qua backend/app-server: 35 journal events, delta tool/message, history, dedupe và SSE replay; CLI probe riêng chỉ persisted history, 0 live notification. Browser-driven production desktop/mobile file/create/project/folder/conflict/preview/history/status: pass, không JS error hoặc overflow. Backup VACUUM INTO đã thử trong .test-data. DB schema1, forward-version guard, startup crash recovery không auto replay. 13 bugs QA sửa/retest ghi docs/bugs.md.

Bằng chứng: docs/evidence/final-verification.json, manual-production.json, live-smoke.json, external-cli-probe.json, alternate-port.json và PNG fixture/production. Fixture không chứng minh live/quota. Không gọi thêm model để load UI/Usage/doctor. Nếu tiếp tục runtime smoke bị dừng, `npm run smoke:live -- --reconcile` chỉ đối chiếu submission cũ; không auto replay.

**Chưa hoàn thành toàn bộ v3:** live CLI độc lập (#11) không đạt trên kết nối stdio riêng hiện tại. CLI probe thật đang chạy ~38s, history items1→4 nhưng 0 notifications. Không resume/start-turn để giả attach, không raw JSONL/TUI watcher. Phương án hiện có: task mới khởi chạy qua runtime do web quản lý. Hướng khảo sát thêm: shared daemon/proxy với readonly subscribe được hỗ trợ và ownership rõ; help/schema chưa chứng minh khả năng này, không restart/takeover daemon user.

Chưa test ZeroTier từ điện thoại thật, native Mini PC và systemd thực tế; đây là Ubuntu26 WSL2 + Chromium mobile emulation. Approval/input UI/protocol fixture pass; không ép thêm prompt thật để gây approval/input. Browser bundle ~1.1MB/374KB gzip, có warning size nhưng build pass. Watcher polling1s/depth6/max8; outside limits tải lại version. Không bảo đảm loại bỏ race external writer; output giới hạn nội dung runtime công khai/backend đã thu/retention còn giữ.

File chính: src/server/app.ts (auth/roots/ownership/turn/journal/status/IDE), adapter.ts (typed schema/correlation/stdio), paths.ts/store.ts/instance.ts; src/client/main.tsx/style.css; src/shared/timeline.ts/drafts.ts; scripts vận hành; tests; README/docs.
