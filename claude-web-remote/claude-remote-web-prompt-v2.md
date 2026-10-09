# Prompt v2: Claude Remote, web điều khiển Claude Code và IDE mini trên Ubuntu qua ZeroTier

> v2 dựa trên `claude-remote-web-prompt.md` và bổ sung: workspace `/home/phuloi/claude-vibe`, file explorer,
> editor (lưu bằng Ctrl+S, chống xung đột với Claude), tạo và đổi tên file/folder, yêu cầu README hướng dẫn chạy,
> cách dùng lại phiên đăng nhập `claude` có sẵn trên máy, UI cho câu hỏi/lựa chọn/approval, và vòng đời
> session (tự kết thúc khi idle hoặc không ai trả lời, nút Dừng/Kết thúc giống extension VSCode).

Bạn là coding agent, nhiệm vụ là triển khai hoàn chỉnh một web app tự host trên Ubuntu. Qua app này, tôi điều khiển
Claude Code và xem/sửa code của các project trên máy đó từ điện thoại hoặc máy khác qua ZeroTier. Hãy **làm thật**,
không dừng ở việc viết plan. Trước khi làm, đọc CLAUDE.md/AGENTS.md và repo. Nếu repo đã có code thì tích hợp vào
cấu trúc hiện có. Chi tiết thông thường thì tự quyết; chỉ hỏi khi thiếu thông tin thật sự chặn việc triển khai.

## 0. Thuật ngữ và ánh xạ sang Claude

| Khái niệm | Hiện thực |
|---|---|
| Agent runtime | `@anthropic-ai/claude-agent-sdk` (TypeScript), hàm `query()` ở **streaming input mode**. SDK spawn CLI `claude` làm subprocess |
| Session / turn / item | `session_id` / một lượt `query` (tính đến message `result`) / content block (`text`, `tool_use`, `tool_result`, `thinking`) |
| Approval | Callback `canUseTool(toolName, input, {signal, suggestions})` → `allow` / `deny`; tool `AskUserQuestion` dùng làm yêu cầu input |
| Interrupt / steer | `query.interrupt()`; steer = đẩy thêm user message vào async iterable đang mở (nếu version hỗ trợ) |
| Model / effort | `query.supportedModels()`, `setModel()`; effort/thinking theo option SDK có thực |
| Permissions | `permissionMode` (`default`/`acceptEdits`/`plan`/`bypassPermissions`) + `settingSources` để nạp settings của project |
| Lịch sử session | `~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`, resume bằng option `resume` |

Tên option và field trong bảng chỉ để định hướng. Trước khi code phải đối chiếu docs và type definitions của SDK đã cài.

## 1. Mục tiêu và phạm vi

- Single-user. Mỗi máy chạy một instance độc lập. MVP chưa cần dashboard multi-server.
- Workspace là `/home/phuloi/claude-vibe`, mỗi folder con là một project. Trên web có thể chọn project có sẵn hoặc tạo project mới.
- Với mỗi project:
  - xem các session cũ, resume, tạo chat mới, gửi prompt và xem streaming;
  - duyệt cây thư mục, đọc code và Markdown (có tô màu), sửa và lưu bằng Ctrl+S, tạo file/folder, đổi tên.
- Agent chạy trên server, browser chỉ điều khiển. Đóng tab hoặc mất kết nối ZeroTier **không** được hủy task.
- UI tiếng Việt, responsive, dùng được trên điện thoại. Không giả lập response hay session.
- Không public ra Internet, không dùng cloud hosting.

## 2. Kiến trúc

- Backend và frontend đều viết bằng TypeScript: Node.js + Fastify + React/Vite, SQLite lưu metadata và event journal. Ít dependency, pin version, commit lockfile.
- Production phục vụ API, frontend và stream trên **một port**. Lúc dev thì Vite chạy port riêng và proxy về API.
- **Adapter Claude:**
  - Mỗi session đang active giữ một `Query` sống lâu. Không spawn lại process cho mỗi prompt.
  - Khi nào đóng Query và mở lại bằng `resume` thì theo mục 6, phần "Vòng đời session". **Browser ngắt kết nối không bao giờ là lý do để đóng Query.**
  - Giới hạn số Query đồng thời bằng `MAX_ACTIVE_SESSIONS`.
  - Không scrape TUI, không gọi `claude -p` rồi parse text.
- Browser ↔ backend dùng SSE hoặc WebSocket. Adapter phải có type, map message SDK sang event nội bộ, có timeout và xử lý callback.
- Bật `includePartialMessages` để stream delta. Message `assistant` hoàn chỉnh là bản authoritative để reconcile.
- Feature chưa ổn định phải ghi rõ, có fallback hoặc trạng thái disabled.
- Claude Code là nguồn authoritative cho lịch sử hội thoại. SQLite chỉ lưu journal, trạng thái request, cấu hình và cursor, không tạo lịch sử LLM thứ hai.
- File watcher (`chokidar`) theo dõi project đang mở và đẩy event `file_changed` / `tree_changed` xuống browser.

## 3. Cấu hình

Có `.env.example`, validate lúc startup và báo lỗi rõ. Frontend không hardcode IP, port, path hay URL.

```dotenv
APP_NAME=Claude Remote
SERVER_LABEL=minipc-home
HOST=127.0.0.1
PORT=3000
DEV_UI_PORT=5173
PUBLIC_URL=http://127.0.0.1:3000
DATA_DIR=./data

# Workspace chứa các project (mỗi folder con là một project)
WORKSPACE_ROOT=/home/phuloi/claude-vibe

# Claude runtime
# Nên dùng đường dẫn tuyệt đối vì systemd không có PATH của shell
CLAUDE_BIN=/home/phuloi/.local/bin/claude
# Để trống = ~/.claude của user đang chạy service
CLAUDE_CONFIG_DIR=
# Để trống = dùng phiên login có sẵn của `claude`. Nếu đặt key thì key được ưu tiên và tính tiền theo API
ANTHROPIC_API_KEY=
DEFAULT_PERMISSION_MODE=default
MAX_ACTIVE_SESSIONS=3
# Vòng đời session (phút). Không có turn chạy quá IDLE thì kết thúc; câu hỏi/approval không ai trả lời quá INPUT thì kết thúc
SESSION_IDLE_TIMEOUT_MIN=10
INPUT_WAIT_TIMEOUT_MIN=10

# File explorer / editor
FILE_MAX_VIEW_BYTES=2097152
FILE_MAX_SAVE_BYTES=2097152
TREE_HIDDEN=["node_modules",".git","dist","build","vendor",".venv","__pycache__"]

SESSION_TTL_HOURS=24
LOG_LEVEL=info
```

- `HOST` có thể đặt là IP ZeroTier để chỉ listen trên interface đó. Mặc định là loopback. Nếu đặt `0.0.0.0` thì cảnh báo là app mở trên mọi interface.
- `PUBLIC_URL` dùng để kiểm tra origin và cookie. Validate port trong khoảng 1–65535. Gặp `EADDRINUSE` thì báo lỗi rõ, không tự nhảy sang port khác.
- Cùng một bản build phải chạy được cho máy khác chỉ bằng cách đổi env, không rebuild frontend.
- `WORKSPACE_ROOT` chỉ giới hạn những gì web được phép duyệt và sửa. Nó **không** sandbox các lệnh Bash mà Claude chạy, docs phải ghi rõ.
- Không tự sửa firewall, ZeroTier hay Node hệ thống.

## 4. Project và session

- Màn hình đầu liệt kê các folder con của `WORKSPACE_ROOT`, kèm thời gian cập nhật và số session.
- **Tạo project mới:**
  - Nhập tên, chỉ cho phép `[a-zA-Z0-9._-]`, không trùng project đã có.
  - Server `mkdir` trong workspace.
  - Tùy chọn chạy `git init`. `git clone <url>` là tùy chọn sau MVP.
- **Session của project:**
  - Lấy các session có `cwd` là project đó (Claude Code tự lưu riêng theo thư mục), có pagination, tìm kiếm và trạng thái.
  - Session tạo từ terminal (cùng user Linux và cùng `CLAUDE_CONFIG_DIR`) cũng hiện ra.
  - Ưu tiên dùng API session của SDK. Nếu SDK không có thì đọc JSONL **read-only**, coi là fallback và ghi rõ. Không sửa file session.
- Không tuyên bố tiếp quản được terminal `claude` đang chạy bên ngoài. Session không do instance này quản lý phải gắn nhãn rõ và chặn resume khi không xác minh được ownership.
- Mỗi session chỉ có một turn active. MVP chặn hai turn chạy song song trên cùng project.

## 5. File explorer và editor

### Bố cục
- Desktop: 3 cột, **cây thư mục | editor (nhiều tab) | chat**. Các cột kéo giãn được, cột chat thu gọn được.
- Điện thoại: 3 tab **Files / Code / Chat**. Editor mặc định ở chế độ xem, bấm nút "Sửa" mới bật bàn phím, tránh vô tình gõ nhầm.

### Cây thư mục
- Tải lazy theo từng cấp.
- Ẩn các mục trong `TREE_HIDDEN`, có toggle "hiện tất cả". Tôn trọng `.gitignore` là tùy chọn.
- File `.env` hiển thị như file bình thường (môi trường test, không cần che).
- Đánh dấu file Claude vừa sửa trong turn gần nhất và file đang có thay đổi chưa lưu.
- Context menu (hoặc long-press trên điện thoại): **Tạo file**, **Tạo folder**, **Đổi tên**, **Copy path**, **Chèn `@path` vào prompt**.

### Editor
- Dùng **CodeMirror 6** cho cả xem và sửa. Tô màu ít nhất: JS/TS/JSX/TSX, Go, Python, JSON, YAML, Markdown, Shell, Dockerfile, SQL, HTML/CSS. Có line number, tìm kiếm trong file, theme sáng/tối.
- Markdown có nút chuyển giữa **xem trước** và **mã nguồn**. Xem trước dùng `react-markdown` + `remark-gfm` + `rehype-sanitize`.
- File lớn hơn `FILE_MAX_VIEW_BYTES`: báo quá lớn, không load. File nhị phân: báo không hiển thị (ảnh có thể preview, không bắt buộc).

### Lưu file (Ctrl+S / Cmd+S / nút Lưu)
- Chỉ ghi lên server khi bấm lưu, không auto-save.
- Tab có dấu ● khi chưa lưu. Đóng tab hoặc rời trang khi còn thay đổi chưa lưu thì hỏi xác nhận.
- Ghi atomic: ghi ra file tạm cùng thư mục, rồi `rename` đè lên. Giữ nguyên mode của file, kiểu xuống dòng (LF/CRLF) và encoding (UTF-8; file không phải UTF-8 thì chỉ cho xem).
- **Chống xung đột:**
  - `GET` file trả về `etag` (hash nội dung).
  - `PUT` phải gửi `If-Match: <etag>`. Nếu file trên đĩa đã đổi thì trả `409`.
  - UI cho 3 lựa chọn: **Xem diff**, **Tải bản mới**, **Ghi đè**.
- Nhận event `file_changed` cho file đang mở:
  - tab chưa có thay đổi thì tự reload;
  - tab đang sửa dở thì hiện banner "file đã thay đổi trên server".
- Nếu Claude đang chạy turn trong project thì vẫn cho lưu, nhưng hiện cảnh báo.
- Sửa file trên web **không gọi model** và không tốn token.

### Tạo và đổi tên
- Tạo file hoặc folder rỗng tại thư mục đang chọn. Nếu đã tồn tại thì báo lỗi, không ghi đè.
- Đổi tên hoặc di chuyển trong cùng project:
  - đích đã tồn tại thì báo lỗi;
  - không cho đổi tên root của project;
  - các tab đang mở theo path cũ được cập nhật sang path mới.
- **Xóa file/folder không nằm trong MVP.**

### API (gợi ý)
```
GET   /api/projects/:p/tree?path=
GET   /api/projects/:p/file?path=          -> { content, etag, size, language, binary }
PUT   /api/projects/:p/file?path=          (If-Match) -> { etag }
POST  /api/projects/:p/files               { path, type: "file" | "dir" }
POST  /api/projects/:p/rename              { from, to }
```

### An toàn đường dẫn
- Mọi path đều resolve bằng realpath và phải nằm trong project. Chặn `..`, path tuyệt đối và symlink trỏ ra ngoài, áp dụng cho cả nguồn và đích khi đổi tên.
- Không có endpoint chạy shell tùy ý cho browser.

## 6. Chat và chi tiết thực thi

- Composer multiline, render Markdown/code block, có nút gửi, nút dừng, copy. Chỉ auto-scroll khi user đang ở cuối. Hỗ trợ chèn `@path` từ cây thư mục.
- Timeline gồm: message, todo/plan, tool input (Bash, Edit, Write…), tool result/stdout/stderr, diff, approval, kết quả cuối (`result`, usage).
- Bấm vào sự kiện Edit/Write thì mở file tương ứng trong editor.
- Dùng ID ổn định (session/message/tool_use_id). Cập nhật theo delta, không tạo item trùng.
- Thinking chỉ hiển thị phần API trả về. Không bịa exit code khi tool result không có.
- Model/effort lấy từ runtime. Thay đổi áp dụng cho turn tiếp theo.
- Interrupt và steer: dùng nếu SDK hỗ trợ. Nếu không thì disable kèm lý do.
- Usage và cost chỉ lấy từ message `result` (nếu có). Không tự suy ra quota subscription còn lại.

### Câu hỏi, lựa chọn và approval (giống extension VSCode)

- **Câu hỏi/lựa chọn** (tool `AskUserQuestion`):
  - Hiện thành card trong timeline: tiêu đề câu hỏi, các option dạng nút (có mô tả), hỗ trợ chọn một hoặc nhiều, luôn có ô "Khác…" để nhập text tự do.
  - Nếu một lần có nhiều câu hỏi thì hiện đủ, trả lời xong mới gửi.
  - Kết quả trả về Claude qua `canUseTool` dưới dạng câu trả lời của tool.
- **Approval tool** (Bash, Edit, Write, WebFetch…):
  - Card hiện tên tool, input (lệnh Bash, đường dẫn, diff nếu là Edit) và các nút **Cho phép**, **Cho phép luôn trong session này** (nếu SDK có `suggestions`), **Từ chối** (kèm ô ghi lý do gửi cho Claude).
- **Plan mode:** khi Claude trình plan để xin duyệt thì hiện plan dạng Markdown, kèm nút **Duyệt plan** / **Yêu cầu sửa**.
- Quy tắc chung:
  - Mỗi card gắn đúng `tool_use_id`, chỉ trả lời được một lần. Đã trả lời hoặc hết hạn thì khóa card và ghi rõ kết quả.
  - Card đang chờ hiện **đồng hồ đếm ngược** tới lúc hết hạn (`INPUT_WAIT_TIMEOUT_MIN`).
  - Trong lúc chờ, `canUseTool` treo ở backend. Mở lại web từ thiết bị khác vẫn thấy và trả lời được.
  - Reconnect **không** được tự động approve. Hết hạn thì luôn coi là **từ chối**, không bao giờ coi là cho phép.
  - Không tự bật `bypassPermissions`.
- Danh sách project/session hiện badge cho session đang **chờ trả lời**, để mở web lên là thấy ngay chỗ cần xử lý.

### Vòng đời session, timeout và nút Dừng

Trạng thái của một session đang được instance quản lý:

| Trạng thái | Ý nghĩa | Process `claude` |
| --- | --- | --- |
| `running` | Đang chạy turn | Sống |
| `waiting_input` | Đang chờ trả lời câu hỏi/approval | Sống |
| `idle` | Không có turn, đang chờ prompt mới | Sống |
| `ended` | Đã kết thúc (do timeout hoặc user bấm) | Đã đóng, resume được |
| `interrupted` / `unknown` | Bị ngắt do crash/restart | Đã đóng, resume được |

Quy tắc:

- `idle` quá `SESSION_IDLE_TIMEOUT_MIN` → **tự kết thúc**: đóng Query, giải phóng process, ghi event `session_ended(reason=idle_timeout)`. Không mất gì vì lịch sử nằm ở Claude Code.
- `waiting_input` quá `INPUT_WAIT_TIMEOUT_MIN` → **tự kết thúc**:
  1. resolve `canUseTool` thành **deny**, kèm message "Người dùng không phản hồi, session tạm dừng";
  2. `interrupt()` turn;
  3. đóng Query, ghi `session_ended(reason=input_timeout)`;
  4. card câu hỏi chuyển sang "hết hạn" và vẫn hiện nội dung câu hỏi để user đọc lại.
- `running` **không bao giờ** bị timeout, dù chạy lâu (ví dụ build 30 phút) và dù không có browser nào mở.
- Đồng hồ timeout tính theo hoạt động của agent và user (gửi prompt, trả lời, agent ra output), **không** tính theo việc browser có mở hay không.
- **Mở lại session `ended`:**
  - user chọn session trong danh sách thì xem lại được toàn bộ lịch sử ngay, chưa cần spawn process;
  - chỉ khi gửi prompt mới thì backend mới `resume` (spawn lại `claude`);
  - nếu session kết thúc vì câu hỏi hết hạn thì composer gợi ý sẵn ngữ cảnh "Trả lời câu hỏi trước: …" để user trả lời dưới dạng prompt mới.
- **Hai nút trên header của chat:**
  - **Dừng** (■): `interrupt()` turn đang chạy, session về `idle`, gửi prompt tiếp được ngay. Giống nút Stop của extension VSCode.
  - **Kết thúc session**: dừng turn (nếu có) rồi đóng Query, chuyển sang `ended`. Có xác nhận nếu đang `running`.
- Header luôn hiển thị trạng thái hiện tại và thời gian còn lại trước khi tự kết thúc (khi đang `idle` hoặc `waiting_input`).
- Ghi chú chi phí: resume sau khi đã kết thúc không gửi lại transcript từ web, nhưng prompt cache phía Anthropic có thể đã hết hạn, nên lượt đầu sau resume có thể tốn token hơn một chút. Ghi điều này trong docs.
- Phase 2 (không bắt buộc): gửi thông báo đến điện thoại (ntfy/Telegram/Web Push) khi session chuyển sang `waiting_input`, hoặc khi turn xong.

## 7. Reconnect, persistence, tránh hao token

- Mỗi lần gửi chỉ đẩy prompt mới. Không gửi lại transcript, không chèn system prompt dài, không gọi model để tóm tắt log hay render UI.
- Mỗi lần gửi có một `clientRequestId` duy nhất. Backend dedupe khi retry hoặc double click.
- Nếu đã dispatch rồi mới mất kết nối: đánh dấu `unknown` rồi reconcile. **Không bao giờ** tự resubmit.
- Persist event vào SQLite **trước** khi broadcast, gán sequence/cursor để browser catch up. Dùng unique constraint và transaction.
- Đóng tab không làm dừng Query. Approval đang chờ vẫn được giữ cho đến khi hết `INPUT_WAIT_TIMEOUT_MIN`.
- Timer timeout được persist (thời điểm hết hạn lưu trong SQLite) để backend restart vẫn xử lý đúng.
- Nếu process `claude` hoặc backend crash: đánh dấu `interrupted`/`unknown`, reconcile khi khởi động. Không báo hoàn tất, không tự chạy lại.
- Log/render dùng pagination và virtualization. Có retention cấu hình được.

## 8. Xác thực và đăng nhập

### Login của web app
- Single-user, password đặt bằng lệnh bootstrap (`npm run set-password`), hash bằng argon2 hoặc bcrypt. Không commit credential.
- Cookie HttpOnly, SameSite, bật Secure khi chạy HTTPS. Có CSRF cho mutation (kể cả lưu, tạo, đổi tên file), kiểm tra Origin cho stream và mutation, rate-limit login.
- Stream, file, diff và lịch sử đều yêu cầu login.

### Dùng lại phiên đăng nhập `claude` có sẵn
- Agent SDK gọi chính binary `claude`, nên dùng đúng credentials mà CLI đã lưu (`~/.claude/.credentials.json` trên Linux). **Nếu service chạy bằng cùng user Linux đã login `claude` (`phuloi`) thì không cần login lại.**
- Điều kiện:
  - systemd có `User=phuloi`;
  - `HOME=/home/phuloi` đúng;
  - `CLAUDE_BIN` là đường dẫn tuyệt đối;
  - `CLAUDE_CONFIG_DIR` để trống hoặc trỏ đúng `~/.claude`.
- Nếu chạy bằng user khác thì user đó phải tự `claude` → `/login` một lần. **Không copy credentials** từ user khác.
- Nếu `ANTHROPIC_API_KEY` có trong env thì key được ưu tiên hơn subscription và tính tiền theo API. Docs phải cảnh báo điều này. `/readyz` hoặc trang Settings hiển thị **nguồn auth đang dùng** (subscription hay API key), không hiển thị giá trị.
- Token hết hạn hoặc bị thu hồi: UI báo "Claude chưa đăng nhập" và hướng dẫn SSH vào server chạy `claude` → `/login`. Không làm luồng login qua web trong MVP.
- Ghi chú điều khoản: docs Agent SDK yêu cầu sản phẩm bên thứ ba dùng API key. App này là công cụ cá nhân, tự chạy trên máy mình, nhưng README vẫn nhắc người dùng tự kiểm tra điều khoản hiện hành.
- Terminal `claude` và web dùng chung tài khoản nên **chung rate limit / quota**.

### An toàn chung
- Credentials của Claude chỉ nằm ở server: không trả cho browser, không ghi vào log.
- Không chạy root, không sửa sudoers.
- Escape và sanitize output. Không execute script lấy từ tool output.

## 9. Deployment Ubuntu

- Có scripts install/build/start và systemd unit mẫu: `User=phuloi`, `WorkingDirectory`, `EnvironmentFile`, `Environment=HOME=/home/phuloi`, `Restart=on-failure`.
- Graceful shutdown: báo cho client, `interrupt()` các Query một cách có kiểm soát. Restart service sẽ ngắt turn đang chạy.
- `/healthz` kiểm tra web. `/readyz` kiểm tra `claude --version`, trạng thái auth và adapter. Probe chưa login chỉ thấy `ok`/`not ready`.
- Backup SQLite khi đang chạy bằng `.backup` hoặc `VACUUM INTO`. Có hướng dẫn nâng cấp và rollback app cũng như `claude` CLI.
- Docker để sau MVP.

## 10. Kiểm thử và nghiệm thu

Viết test cho:
- adapter (map SDK message → event)
- delta reconciliation
- dedupe `clientRequestId`
- login/CSRF/origin
- path traversal/symlink (đọc, ghi, tạo, đổi tên)
- lưu file với etag đúng/sai (`409`)
- ghi atomic
- tạo/đổi tên khi đích đã tồn tại
- reconnect replay
- `canUseTool` pending/resolve
- state machine của session: các chuyển trạng thái, timeout idle/input (dùng fake timer), hết hạn thì luôn deny, `running` không bị timeout, Dừng và Kết thúc

CI mock SDK bằng fixture. Smoke test thật chỉ chạy một prompt nhỏ. Nếu thiếu `claude` hoặc auth thì **không** được nhận là đã test.

Tiêu chí nghiệm thu:
1. Build, typecheck, test pass. Web, API và stream chạy trên một port. Đổi `PORT`/`PUBLIC_URL` không cần rebuild.
2. Service chạy bằng user `phuloi` dùng được phiên `claude` có sẵn, không phải login lại.
3. Tạo project mới trong `/home/phuloi/claude-vibe` từ web. Chọn project thì thấy session cũ, kể cả session tạo từ terminal.
4. Gửi prompt thật: stream đúng, khớp lịch sử. Refresh hoặc reconnect không tạo turn mới.
5. Duyệt cây thư mục, mở `.go`, `.py`, `.js`, `.md` đều có tô màu, Markdown xem trước được.
6. Sửa file, bấm Ctrl+S thì nội dung trên đĩa thay đổi. Claude sửa cùng file trước đó thì lưu nhận `409` và có UI xử lý.
7. Claude sửa file thì cây thư mục và tab đang mở cập nhật mà không cần F5.
8. Tạo và đổi tên file/folder hoạt động. Không tạo hay đổi tên được ra ngoài project.
9. Đóng tab thì agent vẫn chạy. Crash hiển thị đúng tình trạng, không resubmit.
10. Chưa login web thì không đọc được file, transcript hay stream.
11. Có README đủ nội dung như mục 11.
12. Câu hỏi/lựa chọn và approval hiện thành card có nút và chọn được. Trả lời từ thiết bị khác với thiết bị đã gửi prompt vẫn được.
13. Không trả lời quá `INPUT_WAIT_TIMEOUT_MIN` → session `ended`, tool bị deny (không bao giờ allow). Chọn lại session thì xem được lịch sử và gửi prompt để chạy tiếp.
14. `idle` quá `SESSION_IDLE_TIMEOUT_MIN` → process `claude` được đóng (kiểm bằng `ps`). Turn chạy lâu hơn timeout không bị ngắt.
15. Nút Dừng ngắt turn và vẫn chat tiếp được. Nút Kết thúc đóng session.

## 11. README bắt buộc (hướng dẫn chạy sau khi code xong)

README ở root là tài liệu để **tôi tự cài và chạy lại từ đầu** trên một máy Ubuntu mới. Mỗi bước phải có lệnh copy-paste
được và cách kiểm tra bước đó đã thành công. Tối thiểu gồm các phần sau:

1. **Giới thiệu ngắn:** app làm được gì, ảnh chụp màn hình (nếu có), giới hạn đã biết.
2. **Yêu cầu:** Ubuntu version, Node version, `claude` CLI version đã kiểm thử, ZeroTier đã join network.
3. **Chuẩn bị Claude:**
   - cài `claude`;
   - login bằng user `phuloi`;
   - kiểm tra bằng `claude --version` và một lệnh test nhỏ.
4. **Cài app:** clone repo → `npm ci` → `cp .env.example .env` → sửa các biến quan trọng → `npm run set-password` → `npm run build`.
5. **Chạy thử (foreground):** `npm start`, mở `http://<ip-zerotier>:<port>`, login, tạo project test, gửi prompt "hello".
6. **Chạy dev:** `npm run dev`, gồm port của Vite và API.
7. **Chạy nền bằng systemd:**
   - copy unit file, `systemctl daemon-reload`, `enable --now`;
   - xem log bằng `journalctl -u claude-remote -f`;
   - ghi rõ các lệnh cần sudo.
8. **Truy cập qua ZeroTier:** đặt `HOST` là IP ZeroTier, mở từ điện thoại. HTTPS qua reverse proxy (tùy chọn).
9. **Cấu hình cho máy thứ hai:** ví dụ env khác port, không rebuild.
10. **Vận hành:**
    - backup và restore SQLite;
    - nâng cấp app và `claude` CLI;
    - rollback;
    - đổi password web.
11. **Troubleshooting:**
    - port bận;
    - `claude` không tìm thấy (PATH trong systemd);
    - Claude báo chưa login;
    - đang dùng nhầm API key;
    - lưu file bị `409`;
    - session cũ không hiện;
    - stream bị ngắt qua proxy.
12. **Bảo mật:**
    - chỉ dùng qua ZeroTier;
    - `WORKSPACE_ROOT` không sandbox lệnh của Claude;
    - không chạy root;
    - lưu ý điều khoản auth.

Ngoài README còn có: `CLAUDE.md` (hướng dẫn nhanh cho agent), `docs/architecture.md` (adapter, event flow, ownership,
chống xung đột file) và `docs/deployment.md` (chi tiết env/systemd). Cập nhật docs khi hành vi thay đổi.

## 12. Cách làm và bàn giao

- Khảo sát repo/runtime → viết plan ngắn và capability matrix theo SDK/CLI thật → triển khai cho đến khi MVP chạy được.
- Nếu môi trường build chưa có `claude`: viết adapter theo type của SDK, test bằng fixture, ghi rõ việc tích hợp live còn pending.
- Bàn giao: code chạy được, README theo mục 11, kết quả test, các version tương thích, giới hạn còn lại.

## Nguồn cần đối chiếu trước khi code

- Agent SDK overview: https://platform.claude.com/docs/en/agent-sdk/overview
- Agent SDK TypeScript reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- Sessions, permissions, streaming input: các trang con trong mục Agent SDK
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- CodeMirror 6: https://codemirror.net/docs/
- Type definitions của version SDK đã cài là căn cứ cuối cùng.

## Quyền thực thi trên Mini PC

Tôi cho phép agent chạy với full machine access trên Mini PC chuyên dụng này. Agent được tự cài dependency của dự án,
tạo/sửa file, build, chạy app và test mà không cần hỏi lại với các thao tác thông thường.

Được commit và push lên repo GitHub của dự án. Không force-push và không rewrite lịch sử Git nếu tôi chưa yêu cầu.

Backend và các process `claude` chạy dưới user `phuloi`, không chạy root. Thao tác nào cần sudo thì ghi rõ trong docs deployment.

Web chỉ được truy cập qua ZeroTier và luôn yêu cầu login. Không tự mở app ra Internet.
Không động vào SSH, ZeroTier, firewall, và không xóa dữ liệu ngoài dự án nếu việc đó không thuộc task.
