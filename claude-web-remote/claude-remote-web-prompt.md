# Prompt: xây web điều khiển Claude Code trên Ubuntu qua ZeroTier

> Bản tóm tắt và chuyển thể từ `../codex-web-remote/codex-remote-web-prompt.md`: giữ nguyên các yêu cầu,
> chỉ thay Codex app-server bằng Claude Agent SDK / Claude Code CLI.

Bạn là coding agent, nhiệm vụ là triển khai hoàn chỉnh một web app tự host trên Ubuntu để tôi điều khiển
Claude Code trên máy đó từ điện thoại hoặc máy khác qua ZeroTier. Hãy **làm thật**, không dừng ở việc viết plan.
Trước khi làm, đọc CLAUDE.md/AGENTS.md và repo. Nếu repo đã có code thì tích hợp vào cấu trúc hiện có.
Chi tiết thông thường thì tự quyết; chỉ hỏi khi thiếu thông tin thật sự chặn việc triển khai.

## 0. Ánh xạ Codex → Claude

| Bản Codex | Bản Claude |
|---|---|
| `codex app-server` (stdio JSON-RPC, một process lâu dài) | `@anthropic-ai/claude-agent-sdk` (TypeScript), hàm `query()` ở **streaming input mode**. SDK spawn CLI `claude` làm subprocess |
| thread / turn / item | `session_id` / một lượt `query` (tính đến `result`) / content block (`text`, `tool_use`, `tool_result`, `thinking`) theo `message.id` + block index |
| `codex --version`, `app-server --help`, schema sinh từ binary | `claude --version`, phiên bản SDK trong lockfile, type definitions `sdk.d.ts` của SDK đã cài |
| `CODEX_BIN`, `CODEX_HOME` | `CLAUDE_BIN` (truyền vào `pathToClaudeCodeExecutable`), `CLAUDE_CONFIG_DIR` (mặc định `~/.claude` của service user) |
| Đăng nhập ChatGPT | `claude` đã login (subscription) **hoặc** `ANTHROPIC_API_KEY` (xem mục 6) |
| Approval request | Callback `canUseTool(toolName, input, {signal, suggestions})` → `allow` / `deny`; tool `AskUserQuestion` dùng làm yêu cầu input |
| Interrupt / steer | `query.interrupt()`; steer = đẩy thêm user message vào async iterable đang mở (nếu version hỗ trợ) |
| Model / effort | `query.supportedModels()`, `setModel()`; effort/thinking theo option SDK có thực |
| Sandbox/permissions của Codex | `permissionMode` (`default`/`acceptEdits`/`plan`/`bypassPermissions`) + `settingSources` để nạp settings của project |
| Sessions CLI cũ | `~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`, resume bằng option `resume` |

## 1. Mục tiêu và phạm vi

- Single-user. Mỗi máy chạy một instance độc lập, port/IP/data dir cấu hình riêng. MVP chưa cần dashboard multi-server.
- Chọn project trên máy Ubuntu, tạo chat, gửi prompt, xem response streaming, mở lại lịch sử session và làm tiếp.
- Agent chạy trên Ubuntu, browser chỉ điều khiển và theo dõi. Đóng tab hoặc mất kết nối ZeroTier **không** được hủy task.
- UI responsive, tiếng Việt, dùng tốt trên điện thoại. Không giả lập response hay session.
- Không public ra Internet, không dùng cloud hosting.

## 2. Kiến trúc

- Backend và frontend đều viết bằng TypeScript: Node.js + Fastify + React/Vite, SQLite lưu metadata và event journal. Ít dependency, pin version, commit lockfile.
- Production phục vụ API và frontend trên **một port**. Lúc dev thì Vite chạy port riêng và proxy về API.
- **Adapter Claude:**
  - Mỗi session đang active giữ một `Query` sống lâu ở streaming input mode. Không spawn lại process cho mỗi prompt khi session còn mở.
  - Session idle thì đóng, khi cần thì mở lại bằng `resume: sessionId`.
  - Đặt giới hạn số Query đồng thời.
  - Không scrape TUI, không gọi `claude -p` rồi parse text.
- Trước khi viết adapter phải đối chiếu docs chính thức và type definitions của SDK đã cài. **Không đoán** tên option, message type hay field. Ghi rõ version SDK và `claude` đã kiểm thử.
- Browser ↔ backend dùng SSE hoặc WebSocket. Adapter phải có type, map message SDK sang event nội bộ, có timeout và xử lý callback (`canUseTool`, hooks).
- Bật `includePartialMessages` để stream delta. Message `assistant` hoàn chỉnh là bản authoritative để reconcile.
- Feature unstable hoặc chỉ có ở version mới phải ghi rõ, có fallback hoặc trạng thái disabled.
- Claude Code (session JSONL) là nguồn authoritative cho lịch sử hội thoại. SQLite của web chỉ lưu journal, trạng thái request, cấu hình project và cursor, **không** tạo lịch sử LLM thứ hai.

## 3. Cấu hình nhiều máy

Có `.env.example`, validate lúc startup và báo lỗi rõ nếu sai. Frontend không hardcode IP, port, home path, username hay URL backend.

```dotenv
APP_NAME=Claude Remote
SERVER_LABEL=minipc-home
HOST=127.0.0.1
PORT=3000
DEV_UI_PORT=5173
PUBLIC_URL=http://127.0.0.1:3000
DATA_DIR=./data
CLAUDE_BIN=claude
# Để trống = dùng ~/.claude của service user
CLAUDE_CONFIG_DIR=
# Để trống = dùng credentials của `claude` đã login; chỉ đặt nếu chọn API key
ANTHROPIC_API_KEY=
# Mặc định an toàn; không dùng bypassPermissions làm mặc định
DEFAULT_PERMISSION_MODE=default
MAX_ACTIVE_SESSIONS=3
PROJECT_ROOTS=["/home/USER/projects"]
SESSION_TTL_HOURS=24
LOG_LEVEL=info
```

- `PROJECT_ROOTS` chỉ giới hạn những project web cho chọn. Nó **không** sandbox các lệnh Bash mà Claude chạy, docs phải nói rõ điều này.
- Frontend dùng URL tương đối và tự chọn ws/wss theo trang hiện tại.
- `HOST` có thể đặt là IP ZeroTier để chỉ listen trên interface đó. Mặc định là loopback. Nếu đặt `0.0.0.0` thì cảnh báo là app mở trên mọi interface.
- `PUBLIC_URL` dùng để kiểm tra origin và cookie. Validate port trong khoảng 1–65535. Gặp `EADDRINUSE` thì báo lỗi rõ, không tự nhảy sang port khác.
- Không tự sửa firewall, ZeroTier hay Node hệ thống.
- Cùng một bản build phải deploy được cho máy A (port 3000) và máy B (port 4300), chỉ khác file env, không cần rebuild frontend.

## 4. Tính năng MVP

### Project và session
- Chọn project trong `PROJECT_ROOTS`. Dùng realpath, chặn path traversal và symlink trỏ ra ngoài root.
- Tạo session mới với `cwd` là project đã chọn.
- Danh sách session có pagination, tìm kiếm, thời gian cập nhật, cwd và trạng thái.
- Đọc lịch sử và resume session. Hỗ trợ đổi tên/archive (metadata phía web) nếu cần.
- Session CLI cũ (cùng service user và cùng `CLAUDE_CONFIG_DIR`):
  - Ưu tiên API session của SDK nếu version có.
  - Nếu không có thì đọc JSONL **read-only**, coi là fallback và ghi rõ.
  - Không sửa file session bằng tay.
- Không tuyên bố tiếp quản được terminal `claude` đang chạy bên ngoài. Session không do instance này quản lý phải hiển thị rõ. Chặn resume khi không xác minh được ownership.
- Mỗi session chỉ có một turn active. Nếu đang bận thì queue hoặc báo lỗi rõ. MVP chặn chạy song song trên cùng project.

### Chat và chi tiết thực thi
- Composer multiline, render Markdown/code block, có nút gửi, nút dừng, copy. Chỉ auto-scroll khi user đang ở cuối trang.
- Timeline gồm: message, todo/plan (TodoWrite), tool input (Bash, Edit, Write…), tool result/stdout/stderr, diff file, approval, kết quả cuối (`result`: success/error, `num_turns`, usage).
- Dùng ID ổn định (session/message/tool_use_id). Cập nhật theo delta, không tạo item trùng.
- Thinking chỉ hiển thị phần API trả về. Không bịa exit code khi tool result không có.
- Model/effort lấy từ runtime. Thay đổi áp dụng cho turn tiếp theo, trừ khi SDK hỗ trợ đổi giữa chừng.
- Interrupt và steer: dùng nếu SDK hỗ trợ. Nếu không thì disable kèm lý do.
- Approval và input:
  - Có UI phản hồi, gắn đúng `tool_use_id`. Trong lúc chờ user, `canUseTool` treo ở backend.
  - Reconnect **không** được tự động approve.
  - Tôn trọng permission settings của Claude Code. Không tự bật `bypassPermissions`.
- Token usage và cost chỉ lấy từ `result.usage` / `total_cost_usd` (nếu có). Không tự suy ra quota subscription còn lại.

## 5. Reconnect, persistence, tránh hao token

- Mỗi lần gửi chỉ đẩy prompt mới vào session. Không gửi lại transcript, không chèn system prompt dài, không gọi model để tóm tắt log hay render UI.
- Mỗi lần gửi có một `clientRequestId` duy nhất. Backend dedupe khi retry hoặc double click.
- Nếu đã dispatch rồi mới mất kết nối và không biết kết quả: đánh dấu `unknown` rồi reconcile. **Không bao giờ** tự resubmit.
- Persist event vào SQLite **trước** khi broadcast, gán sequence/cursor để browser catch up sau reconnect. Dùng unique constraint và transaction.
- Tách riêng ba lớp: raw SDK message, trạng thái canonical, replay cho UI. Replay không gọi model.
- Đóng tab không làm dừng Query. Approval đang chờ vẫn được giữ. Logout chỉ đóng client session.
- Nếu process `claude` hoặc backend crash/reboot: đánh dấu turn là `interrupted`/`unknown` và reconcile khi khởi động. Không báo hoàn tất, không tự chạy lại. Không hứa exactly-once.
- Log/render dùng pagination và virtualization. Có retention cấu hình được để journal không phình vô hạn.

## 6. Xác thực và an toàn

- Single-user login. Có CLI/bootstrap để đặt password, hash bằng argon2 hoặc bcrypt. Không hardcode và không commit credential.
- Cookie HttpOnly, SameSite, bật Secure khi chạy HTTPS. Có CSRF cho mutation, kiểm tra Origin cho stream và mutation, rate-limit login. Không dùng localStorage cho credential.
- Credentials của Claude chỉ nằm ở server: không trả `~/.claude/.credentials.json` hay API key cho browser, không ghi vào log. Nếu chưa login thì hiển thị trạng thái và hướng dẫn chạy `claude` → `/login` trên server.
- **Lưu ý auth:** docs Agent SDK yêu cầu sản phẩm bên thứ ba dùng API key thay vì claude.ai login. Đây là bản dùng cá nhân, nhưng vẫn cần tự đối chiếu điều khoản hiện hành trước khi dùng subscription login qua SDK. Hỗ trợ cả hai cách, ghi rõ trong docs.
- Tách bạch quyền chọn project của web với quyền thực thi của Claude. Chạy bằng service user thường, không chạy root, không sửa sudoers.
- Escape và sanitize Markdown/HTML. Không execute script lấy từ tool output. Không có endpoint shell tùy ý cho browser.
- Stream, diff, lịch sử, download đều yêu cầu login. Access log không chứa nội dung nhạy cảm. File journal phải có permission chặt.

## 7. Deployment Ubuntu

- Có scripts install/build/start và systemd unit mẫu: `User`, `WorkingDirectory`, `EnvironmentFile`, `Restart=on-failure`.
- Service phải có đúng `PATH` (thấy được `claude`) và `HOME`/`CLAUDE_CONFIG_DIR` của tài khoản đã login. Không copy credentials từ tài khoản khác.
- Graceful shutdown: báo cho client, `interrupt()` các Query một cách có kiểm soát. Docs ghi rõ restart service sẽ ngắt turn đang chạy.
- `/healthz` kiểm tra web. `/readyz` kiểm tra `claude` có chạy được và adapter đã sẵn sàng. Probe chưa login không được thấy thông tin nhạy cảm.
- Docs: truy cập qua ZeroTier, env cho 2 máy, reverse proxy HTTPS (tùy chọn), backup SQLite đang chạy (`.backup` / `VACUUM INTO`), nâng cấp và rollback, cách nâng cấp `claude` CLI.
- Docker để sau MVP.

## 8. Kiểm thử và nghiệm thu

Viết test cho:
- adapter (map SDK message → event)
- delta reconciliation
- dedupe
- login/CSRF/origin
- path traversal/symlink
- reconnect replay
- `canUseTool` pending/resolve

CI mock SDK bằng fixture message. Smoke test thật thì chỉ chạy một prompt nhỏ để tiết kiệm quota. Nếu thiếu `claude` hoặc auth thì **không** được nhận là đã test.

Tiêu chí nghiệm thu:
1. Build, typecheck, test pass. Web, API và stream chạy trên cùng một port.
2. Đổi `PORT`/`PUBLIC_URL` không cần rebuild. Port bận thì báo lỗi rõ.
3. Login → chọn project → tạo chat → gửi prompt thật: message và tool events stream đúng, khớp với lịch sử.
4. Refresh hoặc reconnect không tạo turn mới. Gửi trùng `clientRequestId` không dispatch lần hai.
5. Đóng tab thì agent vẫn chạy, mở lại thấy đủ trạng thái và events. Crash thì hiển thị đúng tình trạng, không resubmit.
6. Stop, approval và input hoạt động, hoặc hiện thông báo là không hỗ trợ.
7. Lịch sử session có pagination. Session CLI cũ hiển thị được, không takeover process bên ngoài.
8. Chưa login thì không đọc được transcript, project hay stream. Không chọn được path ngoài root.
9. README có: cài đặt, login Claude, config port/IP, systemd, troubleshoot, giới hạn đã biết.

## 9. Cách làm và bàn giao

- Khảo sát repo/runtime → viết plan ngắn và capability matrix theo SDK/CLI thật → triển khai cho đến khi MVP chạy được.
- Nếu môi trường build chưa có `claude`: viết adapter theo type của SDK, test bằng fixture, ghi rõ việc tích hợp live còn pending.
- Cấu trúc docs: `CLAUDE.md` ở root (hướng dẫn nhanh), `docs/architecture.md` (adapter và ownership), `docs/deployment.md` (config/systemd), README làm entrypoint. Cập nhật docs khi hành vi thay đổi.
- Bàn giao: code chạy được, lệnh start, kết quả test, các version tương thích, giới hạn còn lại.

## Nguồn cần đối chiếu trước khi code

- Agent SDK overview: https://platform.claude.com/docs/en/agent-sdk/overview
- Agent SDK TypeScript reference: https://platform.claude.com/docs/en/agent-sdk/typescript
- Sessions, permissions, streaming input: các trang con trong mục Agent SDK ở trên
- Claude Code CLI reference: https://code.claude.com/docs/en/cli-reference
- Type definitions của version SDK đã cài là căn cứ cuối cùng cho option và field.

## Quyền thực thi trên Mini PC

Tôi cho phép agent chạy với full machine access trên Mini PC chuyên dụng này (ví dụ chạy Claude Code với
`--dangerously-skip-permissions` hoặc allowlist rộng). Agent được tự cài dependency của dự án, tạo/sửa file,
build, chạy app và test mà không cần hỏi lại với các thao tác thông thường.

Được commit và push lên repo GitHub của dự án. Không force-push và không rewrite lịch sử Git nếu tôi chưa yêu cầu.

Full access **không** có nghĩa là backend được chạy bằng root. Backend và các process `claude` chạy dưới một
tài khoản Linux chuyên dụng. Thao tác nào cần sudo thì ghi rõ trong docs deployment.

Web chỉ được truy cập qua ZeroTier và luôn yêu cầu login. Không tự mở app ra Internet.
Không động vào SSH, ZeroTier, firewall, và không xóa dữ liệu ngoài dự án nếu việc đó không thuộc task.
