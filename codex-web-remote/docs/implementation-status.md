# Nghiệm thu Codex Remote v3

## Cập nhật model/effort, hạn mức và dừng server

Cập nhật mới nhất — 2026-10-09 09:52 UTC: model/effort hiển thị giá trị kế thừa từ session; header có nhãn model, mức suy luận, context đã dùng và hạn mức 5 giờ/1 tuần còn lại. Context dùng last.totalTokens/modelContextWindow (không dùng tổng token tích lũy). Status dịch thuật ngữ; trạng thái xanh/vàng/tím/đỏ; các khu vực có nền và điểm nhấn riêng ở cả hai theme. Phone/tablet gom thao tác phụ vào “Thông tin & thao tác session”, landscape có bố cục gọn. Bug register B24–B26.

Kiểm tra cuối: typecheck/format/build PASS, 18 unit/backend và 12 browser tests PASS. QA với backend Codex thật, không gọi model mới, 5 viewport × 2 theme PASS, contrast chip ≥4.5 và nút Gửi trong viewport. Evidence: docs/evidence/metadata-final.json, metadata-manual.json và metadata-real-*.png. Đã cập nhật .gitignore, xác nhận 10 loại file riêng được ignore, source/template/evidence được giữ.

**App và toàn bộ server QA đã dừng theo yêu cầu user.** PID78576 và app-server con PID78620 đã thoát; cổng3000 và3107 đóng. Không tự start lại. Người dùng chạy `npm start` từ thư mục dự án, rồi mở http://localhost:3000. Build đã có sẵn; không cần chạy app-server riêng. Không đổi password hay .env, không commit/push. Những dòng “đang chạy” phía dưới chỉ là lịch sử.


Ngày: 2026-10-09. Bản code được triển khai từ repo trống, giữ nguyên các Markdown đầu vào. Git root là repo cha `/mnt/d/tmp/self-practice`, branch main, origin self-practice; có dự án khác dirty. Không commit/push vào repo cha.

Môi trường: Ubuntu 26.04.1 LTS / Linux WSL2 6.18.33.2, Node 24.21.0, npm 11.19.0, Codex CLI 0.161.0, React/Fastify/Vite/SQLite/CodeMirror, Playwright 1.64.0 + Chromium 156. Auth metadata ChatGPT, không đọc/in auth.json hay transcript cá nhân. Binary protocol/bindings sinh tại máy này.

## Cập nhật UI/UX và regression — 2026-10-09

Đã cài skill từ repo người dùng yêu cầu, áp dụng UI tối giản cả login/Sessions/Files/editor/chat/Status, sáng/tối lưu lựa chọn. Usage/Status hiển thị thẻ tài khoản/gói, cumulative/last tokens, số turn và quota progress/remaining/reset; JSON chỉ ở Chi tiết. Editor lazy-load, JS đầu≈129.1KB gzip thay vì≈374.8KB. Không thêm dependency cho redesign.

Sửa ba lỗi user báo và các lỗi phát hiện khi kiểm tra nút: empty thread history, auto refresh Sessions5s/focus, Steer feedback và HTTP LAN ID; thêm snapshot gate chống bấm Gửi quá nhanh, rename/cache sync, Copy fallback, mobile modal containment/sticky Close, bỏ edit toggle không có tác dụng ở desktop. Bug register B15–B23; chi tiết thao tác/vị trí nút trong [ui-ux-review.md](ui-ux-review.md).

Kiểm tra backend thật trong DB/project test riêng: chat chưa materialize/history rỗng, list thấy fresh thread, Steer thật persist và marker cuối đúng; browser thực tế với metadata/token/quota thật, disk save và20 nhóm nút trong buttonAudit (kèm Status refresh/logout);10 viewport/theme cases pass. Evidence `chat-session-steer-live.json`, `redesign-manual.json`, ảnh `redesign-real-*`. `qa-live-regression.ts` dùng một task có chủ đích và quota; `qa-redesign.ts` chỉ metadata/UI/files, yêu cầu task test/evidence trước đó tồn tại. Probe name/archive của blank thread trả200; không gọi model.

Trạng thái này không đổi FAIL #11 live CLI độc lập; mobile là Chromium emulation, không phải nghiệm thu trên phone/ZeroTier vật lý. Báo cáo cũ bên dưới mô tả bàn giao trước redesign và số test/URL tại thời điểm đó; trạng thái mới nhất xem handoff và `redesign-final.json`.

## Kết quả theo 14 tiêu chí

| #   | Trạng thái                                           | Bằng chứng / phạm vi                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | PASS                                                 | npm ci, typecheck/test/build; production cùng port web/API/SSE. Fixture browser dùng chính static production build                                                                                                                                                             |
| 2   | PASS                                                 | Cùng build chạy 3000 và 4300; alternate-port.json. Port bận báo rõ EADDRINUSE, không đổi port ngầm                                                                                                                                                                             |
| 3   | PASS live backend + UI history                       | Doctor init/auth thật; live-smoke.json: task đọc file test, command outputDelta + 15 agent deltas, history đúng. Browser production login và đọc task này, không gọi thêm model                                                                                                |
| 4   | PASS                                                 | Unique clientRequestId/payload; retry không dispatch lần hai. Live smoke dedupe, SSE replay; fixture browser reload không trùng item                                                                                                                                           |
| 5   | PASS protocol/live disconnect                        | Stream disconnect không interrupt; task hoàn thành 35 journal events; mở lại replay. Startup/crash unknown và không resubmit; fixture/unit kiểm tra recovery, không claim recovery exactly-once upstream                                                                       |
| 6   | PASS protocol/UI, live approval/input chưa kích hoạt | Schema interrupt/approval/input/steer; fixture browser approval→input→complete đúng ID, UI card không auto approve. Các smoke lỗi đầu được interrupt thật và history interrupted. Không tiêu thêm quota để ép approval/input thật                                              |
| 7   | PASS fixture + live metadata/history                 | Fixture 46 session, >=2 cwd, CLI/appServer/multi pages, outside-root read-only, no takeover; scope filtering và ID authorization unit. Production View all lấy nguồn từ runtime (binary ghi web source vscode), CLI probe exec ở cwd khác. History phân trang bằng runtime API |
| 8   | PASS                                                 | Unit unauth transcript/file/stream/log/status 401, CSRF/origin 403, traversal/symlink. Browser unauth checks. Cookies HttpOnly/SameSite Strict, HTTPS Secure                                                                                                                   |
| 9   | PASS tài liệu                                        | README quick start, systemd template, config two machines, troubleshooting, backup/restore/upgrade/rollback. Service chưa cài trên Mini PC khác                                                                                                                                |
| 10  | PASS live + fixture                                  | Live 35 persisted events, SSE disconnect/replay, NDJSON log; fixture mở/reload khi waiting approval thấy old output + new input/final đúng. Final item canonical, render paging/long details; retention gap và storage degraded có nhãn                                        |
| 11  | FAIL tính năng live CLI độc lập                      | external-cli-probe.json: process CLI thật đang chạy, history 1→4 items theo thời điểm persist; **0 notifications**, runtime notLoaded. Không resume/start-turn/raw JSONL/TUI scrape. Đây không phải live subscription                                                          |
| 12  | PASS live metadata + unit                            | account/read, rateLimits/read, usage/read và model/list thật. Token notification cumulative/last lưu replace, quota đúng nguồn/window/reset. Null/stale/cache không model calls, adapter false phản ánh status. Production Status screenshots                                  |
| 13  | PASS browser fixture + production                    | Desktop/mobile CodeMirror, nhiều tab/Markdown, Ctrl+S/nút Lưu đổi file thật, dirty watcher/conflict giữ draft. Lock active/waiting server-side; async watcher/save regression. File mode/CRLF/UTF-8 unit                                                                       |
| 14  | PASS                                                 | Production browser tạo project/folder/file; fixture rename; unit tồn tại target/traversal/symlink/root/unauth. API không cho IDE ngoài roots                                                                                                                                   |

Không nhận hoàn tất toàn bộ v3: #11 thiếu live output CLI độc lập. Phương án cụ thể hiện có là task mới khởi chạy qua runtime do web quản lý để có stream; tích hợp shared daemon/subscribe vào CLI độc lập cần một lượt khảo sát riêng và bằng chứng không takeover. Không dùng disabled state/fixture để đổi FAIL thành PASS.

## Bằng chứng

- `docs/evidence/live-smoke.json`: real backend/app-server, thread/turn ID của project test, delta counts, dedupe, SSE replay, history.
- `docs/evidence/external-cli-probe.json`: real independent CLI probe, sampling timestamps, persisted item counts, không notification.
- `docs/evidence/manual-production.json`: browser-driven production desktop/mobile; file thật, conflict, preview, history, auth/status, không JS error/overflow. Xem timestamp và từng mode cho kết quả cuối.
- `docs/evidence/alternate-port.json`, `production-missing-codex.png`: cùng build đổi port, missing binary vẫn login/Status, health200/ready503, send disabled.
- `docs/evidence/desktop-*.png`, `mobile-*.png`: **fixture** UI session/timeline/IDE/status, không chứng minh quota/CLI live.
- `docs/evidence/production-*.png`: production thật, chỉ project/task test. Quota/Auth type lấy runtime, không credentials.
- `docs/bugs.md`: QA defect register; Playwright HTML/trace nằm playwright-report và test-results (ignored).

## Lệnh và kết quả

Bootstrap: npm run setup -- --root .../workspace --host 127.0.0.1 --port 3000; password bootstrap ngẫu nhiên qua stdin kín, hash scrypt, không password mặc định. Setup chạy lại không ghi đè .env. Doctor init/auth/list pass sau bootstrap. Cài Chromium bằng npx playwright install chromium.

Đã chạy npm run typecheck, npm test (14 tests), npm run build, npm run test:e2e (4 desktop/mobile tests), npm run doctor, npm run smoke:live, node --import tsx scripts/probe-external.ts, node --import tsx scripts/manual-production.ts, npm run backup. Các lỗi phát hiện trong lượt có sửa và retest, không tính lần fail đầu là pass. Build có warning JS bundle ~1.1MB (~374KB gzip); không lỗi build, có thể tách lazy editor trong lượt tối ưu sau.

Fixture không được import trong production, không có env bật fixture mode. Browser test ghi trong .test-data; live và manual ghi workspace test riêng. Không sửa/xóa project thật. Doctor/Usage không gọi model. Tổng task có chủ đích: CLI probe riêng, smoke hoàn thành; các lần smoke đầu dừng/interrupt trước khi có item, không auto replay.

## Vận hành bàn giao

Lệnh chính xác từ repo:

```bash
cd /mnt/d/tmp/self-practice/codex-web-remote
npm run set-password  # nếu muốn đặt password của bạn
npm start
```

`.env` đã có workspace riêng và origin http://127.0.0.1:3000. Password bàn giao cục bộ ở data/initial-password.txt (600, ignored); dùng file hoặc đặt password mới. Không in password vào báo cáo. App production **đang chạy** ở URL trên (PID 56705, 2026-10-09 07:36 UTC, health200/ready200); instance 4300/test servers đã dừng. Bằng chứng cuối: docs/evidence/final-verification.json. Xem handoff.md để xác nhận trạng thái cuối và PID lock. Nếu port đã chạy, không chạy thêm npm start cùng DATA_DIR.

Chưa nghiệm thu truy cập ZeroTier/điện thoại vật lý/native Mini PC; browser mobile là Chromium Pixel7 emulation trên WSL. systemd chỉ mẫu. Watcher polling1s, depth6/max8; ngoài giới hạn phải tải lại version. Etag/atomic rename không loại bỏ mọi race external writer. Output công khai/thực sự thu được, không reasoning nội bộ; source runtime truncate hay retention mất thì không thể phục hồi byte chưa thu.

Kiểm tra cuối sau npm ci: format:check/typecheck/build pass, 14 unit pass, 4 browser pass (1 worker), doctor tất cả pass; production manual cả desktop/mobile pass theo manual-production.json. Đây là agent QA, chưa thay thế nghiệm thu của người dùng trên môi trường đích. DB user_version=1, migration transaction và từ chối schema tương lai.
