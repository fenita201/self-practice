# Codex Remote

Web điều khiển Codex và IDE mini, tiếng Việt, desktop/mobile. Production Fastify phục vụ React/Vite + API/SSE cùng một port. Có View all, history phân trang, chat/tool streaming, approval/input/interrupt, Usage/Status, editor nhiều tab và conflict khi lưu.

Runtime đã thử: Ubuntu 26.04.1 trên WSL2, Node **24.21.0**, npm **11.19.0**, Codex **0.161.0**, Chromium Playwright **1.64.0**. Đối chiếu [Codex App Server chính thức](https://learn.chatgpt.com/docs/app-server) và bindings sinh từ binary trong `src/shared/protocol`. Các dependency được pin trong package-lock.json.

**Giới hạn còn lại:** app-server riêng không nhận live output của process CLI độc lập trong probe thật. Session ngoài web chỉ đọc lịch sử đã lưu, trạng thái unknown; không takeover. [Báo cáo nghiệm thu](docs/implementation-status.md) phân biệt fixture/live và từng tiêu chí; không nhận hoàn tất toàn bộ v3.

## Cài và chạy

Dùng tài khoản Linux thường, cùng tài khoản sở hữu projects và Codex home. Không dùng root. Có Node 24 và npm trên PATH. Nếu chưa có Codex, cài theo [CLI reference](https://developers.openai.com/codex/cli/reference), rồi đăng nhập bằng đúng service user:

```bash
npm install --global @openai/codex@0.161.0
codex --version
codex login
codex login status
```

Không cần API key khi đã đăng nhập ChatGPT. Không copy auth.json giữa tài khoản. Với cài đặt Node qua nvm, kích hoạt Node 24 trước mỗi shell; systemd cần PATH riêng.

Trong folder dự án:

```bash
npm ci
npm run setup
npm run set-password
npm run doctor
npm run build
npm start
```

`setup` hỏi root/host/port/public URL trên terminal. Không có project thì mặc định tạo `workspace/` riêng để test; không tự chọn toàn home hoặc repo triển khai làm root. Không ghi đè .env/DB và không tạo password mặc định. `set-password` nhập kín và xác nhận, ít nhất 12 ký tự; chỉ lưu scrypt hash, đổi password thu hồi các login cũ. Doctor phải báo initialize/auth pass để coi Codex đã sẵn sàng. Thiếu Codex/auth vẫn dùng login/IDE/Status; chat không giả response.

Setup không tương tác có option thật:

```bash
npm run setup -- --root /home/myuser/projects --host 127.0.0.1 --port 3000 --public-url http://127.0.0.1:3000
```

Root phải tồn tại; setup chỉ tự tạo workspace mặc định. Mở URL của PUBLIC_URL (mặc định http://127.0.0.1:3000), đăng nhập bằng password vừa đặt. Thành công khi thấy View all, chọn project và mở/lưu file. Production đã chạy và kiểm tra trong session bàn giao, xem báo cáo cho trạng thái cuối.

Bản bàn giao ở máy hiện tại có .env trỏ `workspace/`, port 3000. Password bootstrap ngẫu nhiên riêng được lưu tại **data/initial-password.txt**, không in vào log và không commit. Có thể đọc file cục bộ để đăng nhập, hoặc chạy `npm run set-password` để đặt password của bạn, rồi xóa file bootstrap. File này chỉ phục vụ lần bàn giao hiện tại; setup trên checkout mới không tạo password/file đó.

## Cấu hình và ZeroTier

Sửa `.env` server-side rồi restart; đổi port không cần build lại frontend. `.env.example` chỉ là template. `PROJECT_ROOTS` là JSON array đường dẫn tuyệt đối có thật. `CODEX_HOME=` để trống dùng home của service user. SESSION_LIST_SCOPE=all_codex_home xem session cùng home ngoài roots nhưng không điều khiển hay truy cập IDE. Đặt allowed_projects để lọc cả transcript ở backend.

Máy A:

```dotenv
HOST=10.147.17.2
PORT=3000
PUBLIC_URL=http://10.147.17.2:3000
PROJECT_ROOTS=["/home/myuser/projects"]
DATA_DIR=./data
```

Máy B dùng cùng build:

```dotenv
HOST=10.147.17.3
PORT=4300
PUBLIC_URL=http://10.147.17.3:4300
PROJECT_ROOTS=["/home/otheruser/projects"]
DATA_DIR=./data
```

Các IP là ví dụ: thay bằng IP ZeroTier thật. Điện thoại/máy client phải ở cùng network ZeroTier được cho phép. Không tự sửa firewall/SSH/ZeroTier. HOST=0.0.0.0 mở trên mọi interface; nên dùng loopback hoặc IP ZeroTier cụ thể. PUBLIC_URL phải đúng origin browser để cookie/CSRF hoạt động. HTTPS reverse proxy tùy chọn cần proxy SSE không buffer, PUBLIC_URL=https://... và forward tới loopback. Không expose app ra Internet.

Trong WSL, nếu trình duyệt Windows mở `http://localhost:3000`, đặt `PUBLIC_URL=http://localhost:3000`. `localhost` và `127.0.0.1` là hai origin khác nhau dù cùng tới một server. Sau khi sửa `.env`, dừng instance cũ bằng Ctrl+C rồi chạy lại `npm start`; không cần build lại. Kiểm tra dòng startup `Codex Remote: ...` khớp URL trình duyệt. App nạp cấu hình lúc khởi động, không tự nạp lại `.env`; biến môi trường đã export trong shell có ưu tiên hơn `.env`.

Để phát triển (backend và Vite):

```bash
npm run dev
```

Vite port DEV_UI_PORT mặc định 5173. Khi dùng UI dev, tạm đổi PUBLIC_URL=http://127.0.0.1:5173 để Origin khớp; production đổi lại origin port backend. Hai child dev được dừng cùng nhau khi Ctrl+C.

## Sử dụng

Giao diện đã làm lại theo UI/UX Pro Max: nút Sáng/Tối ở header và màn login, nhớ lựa chọn sau reload; phone/tablet dùng4tab, desktop dùng panel co giãn. Usage/Status có thẻ tài khoản/gói, token, turn và thanh quota/reset; JSON nằm trong Chi tiết đóng mặc định. Sessions tự cập nhật mỗi5s khi tab đang hiển thị và khi quay lại cửa sổ, giữ filter/các trang đã tải. [Báo cáo kiểm tra nút và bố trí](docs/ui-ux-review.md).

- View all mặc định không đổi khi bạn chọn project. Bộ lọc Project hiện tại, nguồn, trạng thái, archived và tên/preview; không phải tìm toàn transcript. Tải thêm qua cursor upstream, gồm CLI/appServer/exec/vscode/sub-agents, không chỉ SQLite web. Bấm session chỉ đọc history, không gọi model. Ngoài roots/mất cwd vẫn có badge chỉ đọc.
- Chọn project → Chat mới → prompt multiline → Gửi. Model/effort từ catalog runtime, áp dụng turn tiếp theo; giá trị mặc định/policy hiệu lực ở header. Dừng ngắt turn được quản lý, Steer gửi hướng dẫn bổ sung khi đang chạy. Đóng tab/logout không dừng task.
- Timeline có prompt, commentary/final, tool input/output, diff, plan, error và approval/input. Final item là authoritative để reconcile delta. Log dài thu gọn có xem đầy đủ/copy/tìm trong phần đã tải/tải NDJSON. Các file change có nút mở bản đĩa; đó có thể khác snapshot diff. Không hiển thị reasoning text nội bộ, chỉ summary công khai.
- Refresh/reconnect chỉ đọc journal/history, không gửi lại prompt. Approval/input đúng request ID, không auto-approve; mở lại session vẫn thấy request còn chờ. Server crash đổi running sang unknown, không resubmit; mở history để đối chiếu trước thao tác chủ đích tiếp theo. Restart có thể ngắt turn.
- Usage/Status có nguồn/timestamp/stale và null/Không khả dụng. Quota là account-wide, token session lấy snapshot cumulative/last, không cộng cumulative hai lần. Cửa sổ phút/reset và phần còn lại dẫn xuất từ usedPercent; không suy quota từ token. Làm mới số liệu có cache chung, không gọi model hoặc suy chi phí USD. Một số account usage field có thể null theo plan/runtime.
- Files lazy, hidden toggle; ⋯ có create/rename/copy/chèn path vào prompt. Editor nhiều tab, Ctrl+S/Cmd+S/Lưu, theme và Markdown preview không execute HTML. Mobile mặc định xem, bấm Sửa. Tab dirty tồn tại khi đổi project; path tab gắn project gốc. Đóng tab/rời trang có cảnh báo draft.
- Khi watcher thấy file đổi, tab sạch reload và tab dirty giữ draft. Conflict có xem hai bản, tải bản mới hoặc ghi đè có xác nhận; overwrite vẫn dùng version mới nhất. Xóa/rename bên ngoài không tự tạo lại file. Lưu/tạo/rename bị khóa khi web turn chạy hoặc chờ approval/input. Chỉ UTF-8 text, giới hạn size, không binary; giữ mode và LF/CRLF.

Web project roots giới hạn API IDE, **không phải sandbox cho mọi command của Codex**. Runtime giữ approval/sandbox của service user, app không tự full-access. Writer/CLI ngoài app không tuân theo lock; etag + atomic rename không chống tuyệt đối race với external writer. Ownership bên ngoài unknown thì không có quyền chạy turn web. Watcher polling 1s, depth 6, tối đa 8 project, bỏ qua thư mục sinh tự động; đây không phải watcher toàn máy.

## Kiểm thử

```bash
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser dùng `.test-data/e2e`, fixture isolated chỉ nằm trong test entrypoint. Nếu thiếu thư viện OS cho Chromium, tham khảo hướng dẫn Playwright phù hợp distro; không tự sudo bằng script dự án. Báo cáo HTML tại playwright-report/index.html, ảnh fixture tại docs/evidence.

Task thật nhỏ, có dùng quota, trong project test riêng:

```bash
npm run smoke:live
```

Thiếu binary/auth trả pending/fail, không tính pass. Script chạy backend thật với DB `data/live-smoke`, dùng cùng Codex home, tạo `.codex-remote-live-test` trong root đầu, kiểm tra tool/message/history/dedupe/SSE disconnect và replay. Không tự replay prompt khi dispatch chưa rõ. Nếu script dừng sau dispatch, `npm run smoke:live -- --reconcile` chỉ đối chiếu request cũ; không gọi turn/start. Probe CLI riêng đã được thực hiện và lưu bằng chứng; `node --import tsx scripts/probe-external.ts` dùng thêm một task CLI, chỉ chạy chủ đích khi cần kiểm tra lại khả năng runtime.

## Service, backup, nâng cấp

[Hướng dẫn deployment](docs/deployment.md) và mẫu [systemd](scripts/codex-remote.service). Chưa cài service lên máy khác.

Backup nhất quán (lệnh này không gọi model):

```bash
npm run backup -- --out /safe/local/path/codex-remote.sqlite
```

Backup `.env` riêng vào vị trí riêng tư; Codex home có lifecycle/backup riêng, journal không thay thế lịch sử runtime. Restore khi service đã dừng: thay data/app.sqlite bằng backup, không giữ app.sqlite-wal/shm từ bản cũ. Thực hiện trên bản sao/backup trước, permissions DB 600/data 700. Không restore vào service còn chạy. Mật khẩu và phiên web ở DB; đổi password sau restore.

Nâng cấp: backup → dừng service → thay source (giữ .env/data) → npm ci → typecheck/test/build → doctor → start. Rollback: dừng → khôi phục source + lockfile tương ứng → npm ci/build; DB migration hiện tại additive, tương lai xem migration compatibility trước khi restore. Không nhận khả năng downgrade DB tùy ý.

## Troubleshoot

| Triệu chứng                           | Cách xử lý                                                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Port bận / EADDRINUSE                 | Dừng instance cũ hoặc đổi PORT + PUBLIC_URL; app không tự nhảy port                                                    |
| Origin/CSRF 403                       | PUBLIC_URL khớp origin client, refresh/login lại; đừng dùng xen kẽ localhost/127.0.0.1                                 |
| Codex PATH/CODEX_HOME sai khi systemd | Dùng đường dẫn CODEX_BIN tuyệt đối, PATH Node đúng và home của service user; chạy doctor bằng user đó                  |
| Auth thiếu                            | codex login bằng service user; không copy token; IDE vẫn hoạt động                                                     |
| Session cũ không hiện                 | Kiểm tra Codex home/user, scope, archived/filter, source và tải thêm; không đọc/sửa JSONL làm fallback                 |
| CLI bên ngoài không live              | Chỉ lịch sử đã lưu; status unknown không phải idle; task mới cần web quản lý để streaming                              |
| Stream ngắt                           | EventSource reconnect + cursor; reverse proxy tắt buffer, kiểm tra cookie TTL; không gửi lại prompt                    |
| Usage stale/null                      | Kiểm tra adapter/auth; chờ USAGE_REFRESH_SECONDS; null không phải 0                                                    |
| Save conflict                         | Giữ draft, xem hai bản, tải mới hoặc overwrite có xác nhận; kiểm tra external writer                                   |
| Watcher chậm                          | Polling tối đa ~1s + stability 200ms; depth 6, hidden dirs bỏ qua; mở lại file kiểm tra version                        |
| Journal hard limit                    | Badge degraded, send bị khóa, tăng budget nếu đủ disk và chạy doctor; xem hướng dẫn khôi phục journal trong deployment |
| Cursor hết retention                  | Có gap; tải history runtime còn cung cấp; log chỉ chứa output đã thu/còn giữ                                           |
| Sai password / rate limit             | npm run set-password; nhiều login sai chờ 15 phút                                                                      |

Không có arbitrary shell endpoint, không đọc credential qua browser và không có production mock response.

### Header chat và số liệu

Model/mức suy luận ở bộ chọn hiện giá trị kế thừa của session; lựa chọn mới áp dụng khi gửi lượt tiếp theo. Header hiện model/effort đã được xác nhận, % context và hạn mức 5 giờ/1 tuần còn lại. Thiếu số liệu không hiển thị 0 giả. Context tính token trong lần xử lý gần nhất trên kích thước cửa sổ, không chia tổng tích lũy. Ở phone/tablet, mở “Thông tin & thao tác session” để đổi tên, lưu trữ, tải log hoặc tìm output.

`.gitignore` loại trừ .env riêng, dữ liệu SQLite/password, workspace cục bộ, dependency, build và báo cáo test. `.env.example`, source, lockfile và bằng chứng nghiệm thu vẫn có thể đưa vào Git.
