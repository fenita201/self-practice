# Đặc tả triển khai v3: Codex Remote và IDE mini trên Ubuntu qua ZeroTier

> Bản v3, 2026-10-09: đặc tả dành cho agent GPT-6.1 Sol, effort Medium triển khai
> app chạy được. Dùng `codex-remote-web-start.md` để giao việc trong session mới.
> File này là yêu cầu chính; `sample.md` chỉ tham khảo UX, file review ghi nhận đánh giá.
> Việc chuẩn bị Markdown không tự khởi động triển khai; khi người dùng giao code,
> agent thực hiện trọn các bước và bàn giao bằng chứng theo mục 0, 8, 9.

Bạn là coding agent chịu trách nhiệm triển khai hoàn chỉnh một web app tự host trên Ubuntu để tôi điều khiển Codex trên máy đó từ điện thoại hoặc máy tính khác qua ZeroTier. Hãy thực hiện công việc, không chỉ viết kế hoạch. Đọc AGENTS.md và kiểm tra repository trước; nếu repo đã có code, tích hợp theo cấu trúc hiện hữu, không ghi đè phần không liên quan. Tự quyết định các chi tiết thông thường và chỉ hỏi khi thiếu thông tin thực sự ngăn cản triển khai.

## 0. Hợp đồng triển khai: phải có app chạy được

### Nguồn yêu cầu và cách ra quyết định

- Đọc toàn bộ đặc tả này trước khi code. Khi triển khai, yêu cầu mới nhất của người dùng và AGENTS.md áp dụng trong repo là căn cứ; file này là đặc tả sản phẩm, `sample.md` không được mở rộng hoặc thay đổi yêu cầu Codex.
- GPT-6.1 Sol / Medium là cấu hình của **agent xây app**, do người dùng chọn ở session Codex. Nó không mặc định ép mọi chat trong app dùng model đó; selector của app vẫn theo runtime. Không coi câu trong Markdown là có thể tự đổi model/effort của session.
- Nếu repo trống, dùng TypeScript, Fastify, React/Vite, SQLite, CodeMirror 6, SSE cho output và HTTP cho mutation/input. Dùng npm + một `package-lock.json`, production cùng origin/một port. Nếu repo đã có stack tương đương thì tích hợp, không rewrite chỉ để khớp tên thư viện.
- Chọn phiên bản dependency tương thích với Node hiện có, pin và ghi engine/runtime đã kiểm thử. Không đoán version hoặc native module chạy được mà chưa install/build. UI có loading/empty/error/disabled state và dùng dữ liệu thật.
- Tự xử lý chi tiết thông thường; chỉ hỏi khi thiếu quyền, credential hoặc thông tin thực sự chặn việc. Không dừng ở câu hỏi lựa chọn stack, thiết kế màu hay cấu trúc folder.

### Thứ tự thực hiện bắt buộc

| Bước | Công việc | Điều kiện chuyển bước |
|---|---|---|
| 1 | Đọc repo/AGENTS, Git state, Node/npm, Codex binary/help/schema và auth metadata; lập `docs/capabilities.md` | Biết phương thức thực tế và giới hạn; không đọc/in credential hoặc toàn bộ transcript cá nhân để khảo sát |
| 2 | Khởi tạo backend/frontend, env validation, SQLite/migrations, password login, setup/doctor/build/start | Build được, login và IDE đọc project hoạt động; startup lỗi cấu hình rõ |
| 3 | Adapter app-server thật, tạo thread/gửi turn, journal/SSE, interrupt/approval/input, reconnect | Một luồng chat chạy thật khi có Codex/auth; test fixture cho lỗi/correlation/dedupe |
| 4 | Session View all/history/ownership, Usage/Status và log đầy đủ trong phạm vi thu được | Không bỏ sót session web/CLI do filter nguồn; quyền truy xuất được kiểm tra server-side |
| 5 | Hoàn thiện IDE: edit/save/create/rename, watcher/diff, khóa mutation/conflict, mobile | Draft không bị mất, file đổi đúng và không vượt roots |
| 6 | Kiểm thử production/browser, README/systemd, báo cáo nghiệm thu | Lệnh cài/chạy tái lập được; kết quả từng tiêu chí là pass/fail/pending có bằng chứng |

Plan ban đầu ngắn, rồi triển khai liên tục qua các bước, sửa lỗi phát hiện được và chạy lại kiểm tra liên quan. Không chờ người dùng nhắc “tiếp tục” sau mỗi bước. Không dùng khả năng chưa rõ của live CLI bên ngoài làm lý do ngừng các phần độc lập.

### “Chạy được” và giới hạn môi trường

- **App chạy được:** checkout + cài dependency theo lockfile + setup/password + build + start mở được giao diện production, login và IDE thực hiện thao tác thật; backend kết nối Codex thật khi binary/auth khả dụng.
- **Tích hợp Codex đã xác minh:** có bằng chứng một task nhỏ trong project test dùng runtime thật, output/reconnect/history đúng. Mock adapter chỉ dùng test, không dùng production để giả tích hợp thành công.
- Nếu thiếu Codex/auth hoặc môi trường không phải Ubuntu đích: vẫn hoàn thành app, kiểm thử các phần độc lập, hiển thị trạng thái thiếu runtime và ghi chính xác lệnh còn cần chạy trên Mini PC. Không tự nhận live integration/Ubuntu end-to-end đã pass.
- Nếu runtime không hỗ trợ quota, input hoặc live CLI bên ngoài: kiểm tra schema và lỗi thực tế, làm disabled/readonly state rõ, ghi tiêu chí chưa đạt. Không xóa tính năng khỏi yêu cầu hoặc giả số liệu để nhận hoàn thành toàn bộ.

## 1. Mục tiêu và phạm vi

- Một người dùng; mỗi máy có một instance độc lập, port/IP/data directory cấu hình riêng. Không cần dashboard quản lý nhiều server tập trung ở MVP.
- Chọn project nằm trên máy Ubuntu, tạo chat, gửi prompt, xem response streaming, mở lịch sử session và tiếp tục công việc.
- Có danh sách **Tất cả project / View all** tương tự cách xem session toàn bộ project của Codex CLI, cùng trang **Usage / Status** để tham khảo.
- Chọn session đang chạy để xem lịch sử và output mới; phân biệt session do web quản lý với session chạy trong terminal riêng, theo mục 4.
- Có IDE mini: cây thư mục, nhiều tab code/Markdown, sửa/lưu, tạo và đổi tên file/folder. Không cần terminal shell tùy ý hoặc đầy đủ tính năng VSCode.
- Agent chạy trên Ubuntu; trình duyệt chỉ điều khiển và theo dõi. Đóng tab hoặc mất ZeroTier không được tự hủy task.
- UI responsive, tiếng Việt, dùng tốt trên điện thoại. Không giả lập response hay session để thay thế tích hợp thật.
- Không triển khai public Internet hay tích hợp cloud hosting. Không yêu cầu API key nếu Codex đã có đăng nhập ChatGPT hợp lệ.

## 2. Kiến trúc

- TypeScript cho backend và frontend; đề xuất Node.js + Fastify + React/Vite, SQLite cho metadata và event journal. Chọn thư viện phổ biến, ít dependency và tương thích môi trường thực tế.
- Backend phục vụ cả API và frontend production trên một port. Development có thể dùng port riêng cho Vite và proxy API.
- Backend quản lý một process `codex app-server` lâu dài qua stdio JSON-RPC; không spawn Codex lại mỗi prompt. Không scrape terminal TUI.
- Kiểm tra `codex --version`, `codex app-server --help`, tài liệu chính thức và schema sinh từ binary đang cài trước khi viết adapter. Không đoán method/field từ ví dụ cũ. Ghi rõ phiên bản đã kiểm thử; pin dependency và commit lockfile.
- Giao thức browser/backend dùng SSE hoặc WebSocket; giao thức Codex được tách thành adapter có type, request ID correlation, timeout và xử lý server-initiated requests/notifications.
- Chỉ dùng API ổn định khi có; feature experimental phải ghi rõ và có fallback hoặc disabled state. App-server WebSocket trực tiếp không phải lựa chọn mặc định.
- Codex là nguồn authoritative cho thread/turn/history. SQLite của web lưu journal, trạng thái request, cấu hình project và cursor, không tự tạo một lịch sử LLM thứ hai.
- Backend theo dõi thay đổi file cho project đang mở, gửi thông báo để làm mới cây thư mục/editor. Giới hạn watcher, bỏ qua thư mục sinh tự động và không quét toàn máy.

## 3. Cấu hình cho nhiều máy

Cung cấp `.env.example`, validate cấu hình lúc startup, lỗi rõ ràng nếu thiếu hoặc sai. Không hardcode IP, port, đường dẫn home, username hoặc URL backend trong frontend.

```dotenv
APP_NAME=Codex Remote
SERVER_LABEL=minipc-home
HOST=127.0.0.1
PORT=3000
DEV_UI_PORT=5173
PUBLIC_URL=http://127.0.0.1:3000
DATA_DIR=./data
CODEX_BIN=codex
# Không đặt mặc định tùy tiện: để trống nghĩa là dùng home Codex của service user.
CODEX_HOME=
# Template minh họa; setup phải thay bằng đường dẫn thật được người dùng chọn.
PROJECT_ROOTS=["/home/USER/projects"]
# View all mặc định bao gồm session của cùng Codex home trên máy này.
# allowed_projects: chỉ liệt kê trong PROJECT_ROOTS.
SESSION_LIST_SCOPE=all_codex_home
# TTL đăng nhập web, không phải timeout của agent hoặc retention transcript.
SESSION_TTL_HOURS=24
USAGE_REFRESH_SECONDS=60
EVENT_RETENTION_DAYS=30
EVENT_JOURNAL_MAX_BYTES=1073741824
FILE_MAX_VIEW_BYTES=2097152
FILE_MAX_SAVE_BYTES=2097152
TREE_HIDDEN=["node_modules",".git","dist","build","vendor",".venv","__pycache__"]
LOG_LEVEL=info
```

- Tài liệu giải thích project phải sửa `PROJECT_ROOTS` và chọn đúng service user; đây là giới hạn project của web, không phải tự động sandbox toàn bộ lệnh shell.
- `SESSION_LIST_SCOPE` tách quyền xem session khỏi quyền sửa project. Với `all_codex_home`, người đã login được xem metadata/lịch sử session cùng home, kể cả ngoài `PROJECT_ROOTS`; các session đó chỉ đọc. Không được tạo turn, resume để điều khiển, rename/archive hoặc dùng IDE cho đến khi project được cấu hình cho phép. Nếu cần giới hạn cả transcript, dùng `allowed_projects` và hiển thị rõ phạm vi bị lọc.
- Validate các giới hạn/chu kỳ là số dương. Retention chỉ áp dụng journal của web; không xóa lịch sử Codex. Không dọn event của turn đang chạy hay request input đang chờ.
- Production phục vụ cùng origin; frontend dùng URL tương đối và tự chọn ws/wss theo trang hiện tại nếu dùng WebSocket.
- `HOST` có thể là IP ZeroTier để chỉ listen trên interface đó; default loopback. Nếu bind `0.0.0.0`, nói rõ nó mở trên mọi interface.
- `PUBLIC_URL` dùng cho kiểm tra origin/cookie/reverse proxy, không được ép URL localhost vào browser remote. Validate port 1–65535, báo lỗi EADDRINUSE, không âm thầm nhảy port.
- Không tự thay đổi OS firewall, ZeroTier network hoặc Python/Node hệ thống.
- Ví dụ deploy máy A port 3000 và máy B port 4300 bằng cùng bản build, chỉ khác env. Không cần rebuild frontend khi đổi port.
- `.env.example` là template, không phải cấu hình chạy nguyên trạng. `npm run setup` tạo `.env` thật từ root/host/port người dùng chọn; không giữ `/home/USER`, không tự lấy toàn home làm project root, không ghi đè `.env` cũ. Không có project thật thì setup có thể tạo `workspace/` trong repo làm nơi test; không tự đưa cả repo đang triển khai vào workspace của agent.

## 4. Tính năng MVP bắt buộc

### Project và session

- Chọn project trong danh sách root được cấu hình. Resolve realpath, chặn path traversal và symlink vượt root.
- Xem project có sẵn và tạo project con mới trong root được phép: tên một thành phần hợp lệ, không `.`/`..`, không chứa separator, không ghi đè thư mục có sẵn. `git init` là tùy chọn người dùng chọn; clone repository để sau MVP.
- Tạo thread mới trong project; danh sách session có pagination, tìm kiếm và thời gian cập nhật, working directory, trạng thái.
- Đọc lịch sử, resume session, đổi tên/archive nếu binary hỗ trợ. Sessions CLI cũ chỉ hiển thị theo khả năng adapter và cùng service user/CODEX_HOME; không đọc raw JSONL làm API chính và không sửa file session bằng tay.
- Không khẳng định có thể tiếp quản terminal CLI đang chạy bên ngoài. Session không do instance quản lý phải hiển thị rõ; ngăn hai client/process cùng chạy turn gây xung đột khi không thể kiểm chứng ownership.
- Một active turn mỗi thread. Queue hoặc trả lỗi rõ nếu thread đang bận; MVP nên chặn chạy song song trên cùng project để tránh sửa file xung đột.

### Session list: Project hiện tại và Tất cả project

- Có hai chế độ **Project hiện tại** và **Tất cả project / View all**; View all là mặc định khi chưa chọn project. Chọn project để tạo chat không được âm thầm làm mất bộ lọc View all.
- View all liệt kê mọi session mà runtime có thể truy xuất trong cùng service user/CODEX_HOME và phạm vi cấu hình, gồm session tạo từ web và terminal CLI. Không chỉ lấy session từng được lưu trong SQLite của web; không giới hạn theo `cwd` của backend hoặc project đang mở. Không bao gồm máy khác, user khác hay Codex home khác.
- Mỗi dòng có tên/preview, project và đường dẫn `cwd`, cập nhật cuối, nguồn, badge trạng thái và **Web quản lý / Bên ngoài / Chưa xác minh**. Session ngoài roots hoặc thư mục đã mất vẫn xuất hiện trong View all, kèm lý do chỉ đọc; không tự tạo lại thư mục.
- Có bộ lọc project, trạng thái, nguồn, tìm kiếm và lựa chọn xem archived. Session con/sub-agent nếu runtime cung cấp phải có nhãn hoặc nhóm riêng. Giữ thứ tự cập nhật gần nhất và không trùng `threadId` khi đổi filter/tải thêm.
- Phân trang phải đúng sau khi áp dụng phạm vi truy cập/bộ lọc; nếu lọc thêm tại backend, tiếp tục lấy upstream page đến khi đủ trang hoặc hết dữ liệu. Không dừng sau page đầu hay báo tổng số từ số dòng của một page. Ghi rõ phạm vi tìm kiếm là tên/preview hay toàn transcript; không hứa full-text search nếu chưa làm.
- Adapter phải kiểm tra filter nguồn của runtime để không bỏ sót session do app-server tạo. Dữ liệu hoạt động của process bên ngoài không được suy ra chỉ từ timestamp, `notLoaded`, hay việc session có mặt trong danh sách.
- Bấm session mở đúng project/cwd và lịch sử. Thao tác xem không tạo turn, không gọi model và không tự giành quyền điều khiển.

### Trạng thái và xem session đang chạy

| Trạng thái UI | Ý nghĩa |
|---|---|
| `running` | Có bằng chứng turn đang chạy trong runtime được theo dõi |
| `waiting_approval` / `waiting_input` | Đang có yêu cầu người dùng phản hồi |
| `idle` | Runtime xác nhận không có active turn, có thể nhận prompt nếu có quyền |
| `interrupted` / `failed` | Kết quả turn gần nhất bị ngắt hoặc lỗi |
| `unknown` | Chưa xác minh được trạng thái, mất adapter hoặc session chạy bên ngoài |

- Hiển thị riêng trạng thái runtime, kết quả turn cuối và ownership; archive là thuộc tính lịch sử, không đồng nghĩa task đã hoàn tất. Không coi `notLoaded` là bằng chứng session bên ngoài đã dừng.
- Session do web quản lý: mở giữa turn phải thấy lịch sử từ đầu session (tải theo trang), toàn bộ output đã thu được của turn hiện tại và tiếp tục nhận delta live. Không chỉ hiện final answer hoặc event phát sinh sau khi mở tab.
- Timeline gồm prompt, commentary, plan, command/tool input và output, diff, approval/input, warning, error và kết quả cuối. Output dài được thu gọn nhưng có **Xem đầy đủ**, tìm trong phần đã tải và tải xuống log mà backend đã thu được. Giữ thứ tự và cập nhật item, không lặp output khi replay.
- Header có trạng thái, model/effort nếu biết, thời gian chạy, cập nhật cuối và badge **Live / Đang kết nối lại / Chỉ lịch sử / Dữ liệu chưa đầy đủ**. Khi đọc phía trên, giữ vị trí cuộn và có nút **Đến output mới nhất**.
- **Session đang chạy trong terminal CLI riêng:** mục tiêu là theo dõi chỉ đọc, không takeover. Trước khi triển khai phần này, phải xác minh trên phiên bản thật có cơ chế đọc/subscribe hoặc quan sát output được hỗ trợ mà không ảnh hưởng process chủ sở hữu. App-server riêng và chung CODEX_HOME không tự chứng minh có thể xem stream của process CLI khác.
- Nếu chỉ lấy được lịch sử đã persist, ghi rõ **Chỉ lịch sử đã lưu, chưa có live output của terminal** và thời điểm dữ liệu. Không gọi `thread/resume` hoặc bắt đầu turn để giả lập attach; không gửi approval/interrupt tới session bên ngoài khi chưa có quyền kiểm soát hợp lệ. CLI đã dừng chỉ được resume khi ownership đã xác minh; nếu chưa biết, giữ chỉ đọc.
- Không đưa raw JSONL watcher hay scrape TUI vào tích hợp mặc định. Nếu API chưa đáp ứng, ghi phần xem live CLI bên ngoài là **chưa đạt yêu cầu**, đề xuất phương án cụ thể (ví dụ khởi chạy công việc qua runtime do web quản lý) để người dùng duyệt. Disabled state không được coi là nghiệm thu đầy đủ tính năng này.
- “Toàn bộ output” nghĩa là nội dung runtime công khai và backend thực sự thu được. Khi upstream truncate hoặc journal hết retention, đánh dấu phạm vi thiếu; không hứa khôi phục byte chưa từng lưu hoặc nội dung reasoning nội bộ.

### Chat và chi tiết thực thi

- Composer multiline, Markdown/code blocks, nút gửi, nút dừng, copy response và auto-scroll chỉ khi người dùng đang ở cuối.
- Timeline gồm message, progress, plan, command/tool input, stdout/stderr, exit status nếu API cung cấp, file change/diff, approval, completion/error.
- Dùng threadId/turnId/itemId ổn định; cập nhật item theo delta, không tạo trùng item. Final completed item là bản authoritative để reconcile stream.
- Reasoning chỉ hiển thị summary được API công khai; không hứa hiển thị chain-of-thought nội bộ. Không giả tạo exit code khi API không trả.
- Chọn model/effort từ danh sách runtime hỗ trợ. Settings có effective value rõ; thay đổi áp dụng cho turn tiếp theo, không hứa đổi giữa turn nếu API không hỗ trợ.
- Interrupt và steer khi protocol hỗ trợ; disabled với lý do nếu không hỗ trợ.
- Approval và yêu cầu input phải có UI phản hồi; quyết định gắn đúng request ID, không auto-approve do reconnect. Giữ chính sách permissions/sandbox của Codex, không tự bật full-access.
- Câu hỏi/input và approval hiển thị thành card, đủ option/mô tả nếu runtime cung cấp, có text tự do khi schema cho phép. Mở từ thiết bị khác vẫn trả lời được; khóa card khi đã xử lý/hết hiệu lực. Nút cho phép luôn chỉ hiện khi protocol hỗ trợ phạm vi đó. Session list có badge chờ phản hồi.
- Nút **Dừng** interrupt turn do web quản lý và giữ lịch sử để tiếp tục; không kill app-server dùng chung, không archive/xóa session. Đóng tab hoặc hết TTL login không được dừng agent. Không sao chép cơ chế đóng mỗi Query/idle timeout của Claude sang Codex app-server.
- Token usage/rate limit chỉ hiện từ API khi có; không suy ra quota còn lại từ token count. Phân biệt model usage với thống kê HTTP/event. Chi tiết ở phần Usage / Status.

### Usage / Status

- Có trang **Usage / Status** và badge nhỏ ở header; gồm ba nhóm: trạng thái kết nối/auth/runtime, giới hạn tài khoản, usage của session đang chọn. Tất cả yêu cầu login; chỉ hiển thị loại auth/gói nếu được cung cấp, không lộ token hay credential.
- Status hiển thị phiên bản Codex đã phát hiện, adapter ready/disconnected/error, các capability, số turn do web quản lý đang chạy/chờ trả lời và cập nhật cuối. Không tính đây là health của toàn bộ dịch vụ OpenAI hoặc mọi process CLI trên máy.
- Quota hiển thị phần trăm đã dùng, thời lượng cửa sổ và thời điểm reset đúng dữ liệu trả về; hỗ trợ nhiều bucket nếu có. Không cố định nhãn “5 giờ/tuần” khi runtime trả cửa sổ khác. Phần trăm còn lại chỉ được tính từ phần trăm quota đã dùng của cùng cửa sổ và phải ghi là giá trị dẫn xuất.
- Session usage hiển thị input/output/cached/total và context limit nếu runtime cung cấp; phân biệt cumulative với turn gần nhất. Nếu cung cấp báo cáo tài khoản theo ngày/tổng thì dùng trực tiếp, ghi phạm vi; không cộng các snapshot cumulative nhiều lần hoặc suy số liệu CLI bên ngoài từ journal của web.
- Với dữ liệu không hỗ trợ, thiếu auth hoặc field null: hiện **Không khả dụng / Chưa có dữ liệu** cùng lý do, không thay bằng `0`. Có nguồn, thời điểm lấy và dấu stale khi refresh thất bại.
- Refresh bằng thông báo runtime và polling metadata có giới hạn theo `USAGE_REFRESH_SECONDS`, dùng cache chung cho các browser. Không gửi prompt/model call để lấy `/status` hoặc usage. Không hứa báo cáo chi phí subscription theo USD; chỉ hiện cost khi nguồn cung cấp và rõ phạm vi.

### IDE: cây thư mục và editor

- Desktop: ba vùng có thể kéo giãn/thu gọn **Files | Code | Chat**, session list mở ở sidebar/drawer. Điện thoại: tab **Sessions / Files / Code / Chat**, Usage/Status mở từ header/menu; không ép ba cột hẹp vào màn hình nhỏ.
- IDE chỉ hoạt động với project thuộc roots được phép; mở session ngoài roots vẫn xem được transcript theo cấu hình nhưng Files/Code có thông báo chỉ đọc session, chưa được truy cập project. Nếu không có `cwd` hợp lệ thì disable IDE với lý do.
- Cây thư mục tải lazy; mặc định ẩn `TREE_HIDDEN`, có toggle hiện mục ẩn trong project. Đánh dấu file Codex vừa sửa và tab chưa lưu. Không đọc `.git`/credential ngoài project để hiển thị tùy tiện.
- Context menu/long-press có **Tạo file**, **Tạo folder**, **Đổi tên**, **Copy path**, **Chèn đường dẫn vào prompt**. Cách chèn path chỉ là nội dung prompt, không giả định `@path` có resolver giống CLI. Không cần xóa file/folder trong MVP.
- Dùng CodeMirror 6 hoặc editor tương đương gọn: nhiều tab, line number, tìm kiếm, theme sáng/tối và tô màu JS/TS/JSX/TSX, Python, Go, JSON, YAML, Markdown, Shell, SQL, HTML/CSS, Dockerfile. Markdown chuyển **Mã nguồn / Xem trước**, preview phải sanitize.
- Mobile mặc định xem, bấm **Sửa** mới cho nhập. File binary hoặc vượt `FILE_MAX_VIEW_BYTES` không load vào editor; có lý do rõ. UTF-8 là encoding được hỗ trợ sửa, file không giải mã hợp lệ không được ghi lại bằng ký tự thay thế.
- Bấm file change/diff của Codex mở file hiện tại trong editor và cho xem diff riêng; phải ghi rõ bản trên đĩa có thể đã khác snapshot của turn. Path từ tool output vẫn phải kiểm tra quyền truy cập.

### Lưu, tạo và đổi tên file

- **Ctrl+S / Cmd+S / nút Lưu**, không auto-save. Tab dirty có dấu; đóng tab/rời trang phải xử lý thay đổi chưa lưu. Sửa file không gọi model và không tính là gửi prompt.
- Đọc file trả version/etag của nội dung và metadata cần giữ. Khi lưu phải gửi version gốc; bản đĩa đã đổi thì trả lỗi conflict, UI có **Xem diff / Tải bản mới / Ghi đè có xác nhận**. Ghi đè vẫn kiểm tra version mới nhất; nếu file đổi lần nữa phải xử lý conflict tiếp.
- Kiểm tra `FILE_MAX_SAVE_BYTES`, UTF-8, giữ mode và LF/CRLF của file. Không cho sửa binary. Tạo file/folder mới phải dùng cơ chế không ghi đè đích tồn tại.
- Ghi file qua file tạm cùng thư mục và rename có kiểm soát. Atomic rename giúp tránh file ghi dở, nhưng không tự làm cho check-etag và write atomic với process Codex bên ngoài.
- Để MVP không mất dữ liệu khi Codex cùng sửa file: **chặn lưu/tạo/đổi tên lúc project có turn đang chạy hoặc chờ input/approval**, vẫn cho sửa draft trong browser. Khóa mutation theo project, phối hợp với start-turn; nếu đang lưu thì chưa dispatch turn mới. Trước khi lưu sau turn, đọc lại version và kiểm tra conflict.
- Không tuyên bố chống mọi external writer: kiểm tra ownership trước khi cho ghi; khi biết CLI bên ngoài đang làm việc thì chặn, khi chưa xác minh hiển thị lý do/rủi ro rõ. Etag không bảo đảm loại bỏ race với editor/process không theo khóa web. Ghi giới hạn này trong README.
- Watcher/Codex event làm mới cây thư mục: tab sạch tự reload, tab dirty giữ draft và hiện banner; file bị xóa/đổi tên phải báo rõ, không tự tạo lại khi lưu. Khi đổi project giữ hoặc yêu cầu xử lý draft, không gán draft sang project mới.
- Đổi tên trong cùng project, không ghi đè đích hoặc đổi tên root; cập nhật các tab liên quan. Đường dẫn mới chưa tồn tại phải kiểm tra realpath của ancestor hiện hữu và kiểm tra lại lúc ghi để chặn symlink/traversal; không chỉ realpath một path chưa tồn tại. Từ chối symlink khi ghi nếu không bảo đảm confinement.
- Các endpoint đọc/ghi/cây thư mục/tạo/đổi tên đều yêu cầu login và kiểm tra project/path; mutation có CSRF/origin. Không nhận arbitrary absolute path từ browser, không mở arbitrary shell endpoint.

## 5. Reconnect, persistence và tránh hao token ngoài ý muốn

- Gửi chỉ prompt mới với thread ID; không tự gửi lại toàn bộ transcript, không thêm system prompt dài, không gọi model để tóm tắt log/render UI.
- Mỗi send có clientRequestId duy nhất. Backend lưu trạng thái submission, deduplicate retry/double click. Nếu mất kết nối sau khi dispatch và chưa biết kết quả, đánh dấu unknown và reconcile; tuyệt đối không tự resubmit tạo turn thứ hai.
- Backend persist event trước khi broadcast, cấp sequence/cursor để browser catch up sau reconnect. Dùng unique constraints và SQLite transactions phù hợp.
- Phân biệt raw app-server delta, trạng thái canonical và replay UI; replay không gọi model.
- Đóng tab không đóng app-server. Backend tiếp tục xử lý approval pending và lưu sự kiện. Logout/disconnect chỉ đóng client session.
- Nếu app-server crash/reboot, báo trạng thái interrupted/unknown và reconcile thread khi khởi động; không báo task đã hoàn tất hoặc tự chạy lại. Không hứa exactly-once cross-process khi upstream không hỗ trợ.
- Giới hạn log/render theo pagination và virtualization; không cắt mất dữ liệu để rồi báo log đầy đủ. Có retention cấu hình, tránh journal phình vô hạn.
- Khi dọn journal, giữ checkpoint/cursor và mốc sớm nhất còn replay được. Cursor đã hết hạn phải báo gap và dựng lại phần lịch sử runtime còn cung cấp; không nối hai đoạn thiếu rồi gắn nhãn đầy đủ. Nếu journal chạm hard limit trong active turn, báo storage error/degraded rõ, không âm thầm bỏ event hoặc tự chạy lại task.

## 6. Xác thực và an toàn cho web điều khiển máy

- Single-user login. Có CLI/bootstrap để đặt password, hash password bằng thư viện chuẩn; không hardcode credential và không commit password/token.
- Cookie session HttpOnly, SameSite phù hợp, Secure khi HTTPS; chống CSRF cho mutation, kiểm tra Origin cho stream và mutation, giới hạn login attempts. Không lưu credential trong localStorage.
- Codex credentials chỉ nằm server-side; không trả auth.json/token cho browser hoặc log. Nếu chưa đăng nhập, hiển thị trạng thái và hướng dẫn login trên máy server; device flow chỉ triển khai khi schema hỗ trợ.
- Cần phân biệt quyền chọn project của web với quyền thực thi của Codex. Dùng service user thường, không chạy root; không tự sửa sudoers.
- UI escape output, sanitize Markdown/HTML, không execute script từ tool output. Không mở endpoint arbitrary shell cho browser.
- Stream, diff, lịch sử và download đều yêu cầu login. Không log nội dung nhạy cảm vào access log; app journal chứa prompt/output phải có permission phù hợp.
- Transcript View all là dữ liệu riêng tư của cùng service user. API truy xuất bằng thread ID vẫn phải áp dụng `SESSION_LIST_SCOPE`; việc ẩn dòng trên UI không thay cho kiểm tra backend.
- Full machine access ở phần quyền triển khai không tự thay cấu hình permissions của runtime. Hiển thị sandbox/approval policy hiệu lực và chỉ đổi qua thao tác settings rõ ràng của người dùng nếu runtime hỗ trợ.

## 7. Deployment Ubuntu

### Lệnh vận hành thống nhất

Nếu tạo repo mới dùng npm. Tất cả script dưới đây phải có implementation thật; README và tên trong `package.json` phải khớp. Repo có package manager khác được giữ lại nhưng phải cung cấp mapping tương đương và lệnh thực tế, không để lệnh không tồn tại.

| Lệnh | Hành vi bắt buộc |
|---|---|
| `npm ci` | Cài lại từ lockfile trên checkout sạch |
| `npm run setup` | Hỏi hoặc nhận option cho project root/host/port/public URL, tạo `.env`/data directory khi chưa có; không sửa credentials Codex |
| `npm run set-password` | Nhập password kín, xác nhận và lưu hash; không có password mặc định, không in/log password |
| `npm run doctor` | Kiểm tra config/root/binary/version/khả năng initialize và auth metadata; báo từng check rõ, không gửi model request hoặc lộ secret |
| `npm run dev` | Chạy backend + Vite/proxy, đóng child dev có kiểm soát khi dừng |
| `npm run typecheck` | Kiểm tra TypeScript cả server/client/shared |
| `npm test` | Chạy test tự động, không cần Codex auth và không gọi model thật |
| `npm run test:e2e` | Browser test desktop/mobile với fixture test biệt lập; không mở fixture mode trong production |
| `npm run build` | Sinh backend runnable và frontend static assets; build không cần Codex auth |
| `npm start` | Chạy production từ build, nạp config server-side, migrate DB khi cần; không phụ thuộc dev server |
| `npm run smoke:live` | Kiểm tra có chủ đích bằng task nhỏ trong project test; thiếu binary/auth thì báo chưa chạy, không tính là pass |

README phải chỉ rõ dependency browser test và cách cài nếu cần. Không tự nâng Node hệ thống hoặc cài browser/system dependency bằng sudo ngoài quyền đã cấp. Doctor thiếu Codex/auth không làm build hỏng; web vẫn mở Settings/Status/IDE, send bị disabled với hướng dẫn khắc phục. Port bận hoặc config/password bootstrap chưa đúng báo cách xử lý rõ; không có demo credential.

Setup, set-password và doctor phải chạy được sau `npm ci` trước khi build, đúng thứ tự quick start; nếu dùng TypeScript cho scripts thì cung cấp runner/dependency tương ứng. Không phụ thuộc vào artifact `dist/` chưa tồn tại để bootstrap.

Quick start sau khi bàn giao tối thiểu là `npm ci` → `npm run setup` → `npm run set-password` → `npm run doctor` → `npm run build` → `npm start`. Bước doctor phải được sửa cho đạt trước khi tuyên bố Codex đã sẵn sàng; IDE có thể dùng trong khi chưa có runtime. README có ví dụ foreground thật, sau đó mới systemd.

- Cung cấp scripts install/build/start và systemd unit mẫu với User, WorkingDirectory, EnvironmentFile, Restart=on-failure; stdout dành riêng cho protocol của child process, stderr cho diagnostic.
- Service phải dùng đúng PATH/CODEX_HOME của tài khoản đã login Codex. Không copy credentials từ tài khoản khác hay tự nhét API key.
- Graceful shutdown: báo trạng thái cho clients, đóng tài nguyên có kiểm soát. Giải thích restart service có thể ngắt active turn.
- Có `/healthz` kiểm tra web và `/readyz` phản ánh adapter đã initialize; không trả thông tin credential hoặc project nhạy cảm cho probe chưa login.
- Tài liệu truy cập qua ZeroTier, env của 2 máy, reverse proxy HTTPS tùy chọn, backup SQLite khi đang chạy bằng cơ chế phù hợp, nâng cấp và rollback.
- Docker là tùy chọn sau MVP; không bắt buộc vì cần tận dụng Codex và project trên host.

## 8. Kiểm thử và tiêu chí nghiệm thu

Viết các test có giá trị cho adapter, correlation, delta reconciliation, deduplication, login/CSRF/origin, path traversal/symlink và reconnect replay. Mock protocol cho CI; tích hợp thật smoke test khi môi trường cho phép. Không tiêu tốn nhiều quota chạy thử model; chỉ một task nhỏ khi cần xác minh, không giả vờ đã kiểm thử nếu thiếu Codex/auth.

Bổ sung test cho View all xuyên nhiều cwd/nguồn và nhiều page, session ngoài roots/chỉ đọc, ownership unknown, snapshot cộng delta khi mở giữa turn, cursor hết hạn, usage null/stale và tránh cộng cumulative hai lần. IDE cần test conflict/version, save/start-turn lock, tab dirty khi watcher báo đổi/xóa, tạo/rename đích tồn tại và symlink của ancestor. Kiểm tra UI bằng browser desktop/mobile; fixture không thay cho kiểm chứng live output của CLI bên ngoài.

Nghiệm thu:

1. Build/typecheck/test pass; production phục vụ web/API/stream cùng một port cấu hình.
2. Đổi PORT/PUBLIC_URL không cần rebuild frontend. Port bận báo rõ.
3. Login, chọn project, tạo chat và gửi một prompt thật; stream message/tool events và lịch sử khớp.
4. Refresh hoặc disconnect/reconnect không tạo turn mới; gửi trùng clientRequestId không dispatch lần hai.
5. Đóng tab, agent tiếp tục; mở lại lấy được trạng thái/events. Server crash hiển thị tình trạng đúng và không tự resubmit.
6. Dừng task, approval và input hoạt động hoặc có thông báo capability không hỗ trợ.
7. View all lấy session của ít nhất hai project và nguồn CLI/web qua nhiều trang; đổi project không làm sai filter, session ngoài roots hiển thị đúng quyền chỉ đọc. Lịch sử vẫn có pagination, không takeover process bên ngoài.
8. Người chưa login không đọc được transcript, project hay stream; không chọn path vượt root.
9. README hướng dẫn cài, login Codex, config port/IP, systemd, troubleshoot và giới hạn đã biết.
10. Mở session do web quản lý khi đang chạy thấy history, output trước khi mở và output mới; refresh/reconnect không trùng hoặc mất event trong phạm vi đã thu, không tạo turn. Log dài xem/tải được, thiếu dữ liệu có badge rõ.
11. Có bằng chứng kiểm thử riêng cho session CLI đang chạy bên ngoài: loại dữ liệu đọc được, độ trễ và giới hạn. Nếu chỉ xem lịch sử mà chưa live, báo tiêu chí này chưa đạt và phương án tiếp theo; không nhận đã đạt toàn bộ yêu cầu.
12. Usage/Status đúng nguồn, cửa sổ/reset, token và timestamp; null/không hỗ trợ/stale không thành 0. Refresh không gọi model; mất adapter làm status đổi đúng.
13. Desktop/mobile mở cây thư mục, nhiều tab code và preview Markdown; lưu Ctrl+S/Cmd+S/nút Lưu đổi đúng file, conflict giữ draft. Codex chạy thì mutation bị khóa, turn xong cập nhật file và kiểm tra version trước khi lưu.
14. Tạo project con, file/folder và đổi tên trong roots hoạt động; chặn đích tồn tại, traversal/symlink và truy cập IDE của project ngoài roots; chưa login không đọc/ghi được file.

## 9. Cách thực hiện và bàn giao

- Khi được giao triển khai, trước tiên khảo sát repo/runtime, lập plan ngắn và `docs/capabilities.md` theo binary thật. Matrix phải tách View all, history, live output web, live output CLI bên ngoài, quota, session/account usage, approval/input và IDE. Ghi supported/experimental/unsupported/unverified, nguồn và bằng chứng; không nhận tất cả đều hỗ trợ chỉ vì docs có method.
- Nếu chưa có Codex trên môi trường xây dựng, implement typed adapter dựa trên official schema, test với fixture, ghi rõ pending live integration; không tự nhận đã kiểm thử end-to-end.
- Giữ dự án gọn: root AGENTS.md hướng dẫn nhanh, docs/architecture.md mô tả protocol và ownership, docs/deployment.md cấu hình/systemd, README làm entrypoint. Cập nhật docs khi hành vi thay đổi.
- Quyền commit/push khi triển khai theo phần Quyền thực thi trên Mini PC phía dưới; không deploy lên máy khác nếu chưa được yêu cầu. Bàn giao code chạy được, các lệnh start, kết quả kiểm thử, version tương thích và giới hạn còn lại.
- Tạo `docs/implementation-status.md`: từng tiêu chí mục 8, pass/fail/pending, lệnh kiểm tra, kết quả và giới hạn. Ghi phiên bản Node/npm/Codex, cách setup, URL/port đã thử, fixture hay live. Không ghi secret hoặc transcript riêng vào báo cáo.
- Chạy production build thật ở foreground trên môi trường triển khai được giao, kiểm tra web/API/stream cùng origin, login và thao tác file trong project test. Khi bàn giao ghi URL dùng được, app còn chạy hay đã dừng và lệnh start chính xác; không chỉ bàn giao source chưa chạy.
- Browser test và ảnh chụp nếu có phải thể hiện desktop/mobile, session list, timeline, IDE và Usage/Status. Không thay bằng kiểm tra API rồi nhận UI đã pass. Với fixture nói rõ chỉ chứng minh UI/protocol, không chứng minh quota/live CLI.
- Không tự giảm scope để hoàn thành sớm. Nếu vướng giới hạn môi trường, hoàn thành phần có thể kiểm chứng, ghi thiếu sót và cách tiếp tục. Nếu phải dừng do giới hạn session, lưu `docs/handoff.md` có trạng thái, file đã đổi, lệnh/kết quả, lỗi và bước tiếp; không đánh dấu hoàn tất khi còn tiêu chí chưa đạt.

### README bắt buộc

Tham khảo độ cụ thể của `sample.md`: mỗi bước có lệnh copy-paste và cách kiểm tra thành công. Bao gồm yêu cầu Ubuntu/Node/Codex đã kiểm thử; cài Codex/login bằng đúng service user; cài dependency, cấu hình env, đặt password, build, foreground/dev/systemd; truy cập ZeroTier và cấu hình máy thứ hai; backup/restore, nâng cấp/rollback, đổi password.

Hướng dẫn sử dụng View all, quyền session ngoài roots, theo dõi running session, đọc Usage/Status, dùng IDE/lưu/conflict và các giới hạn còn lại. Troubleshoot tối thiểu: port bận, PATH/CODEX_HOME của systemd sai, auth thiếu, session cũ không hiện, CLI bên ngoài không có live output, stream ngắt, stale usage, save conflict và journal đầy/hết retention.

## Nguồn cần đối chiếu trước khi code

- [Codex App Server — tài liệu chính thức](https://developers.openai.com/codex/app-server)
- [Codex CLI reference — tài liệu chính thức](https://developers.openai.com/codex/cli/reference)
- Schema/help sinh từ phiên bản `codex` đang cài là căn cứ cho method và field thực tế.

Đối chiếu ngày 2026-10-09: docs App Server mô tả `thread/list` với filter `cwd`/`sourceKinds`, `thread/read`, notification item/output, `thread/tokenUsage/updated`, `account/read`, `account/rateLimits/read` và `account/usage/read`. Đây là hướng khảo sát, không xác nhận binary trên Mini PC hỗ trợ tất cả. Đặc biệt, docs của một app-server không chứng minh có thể attach live vào CLI độc lập. Không lấy cơ chế `Query`, callback hay timeout của Claude SDK trong `sample.md` làm API Codex.

## Quyền thực thi trên Mini PC

Phần này áp dụng khi tôi giao triển khai app trên Mini PC bằng prompt session mới. Việc chỉ yêu cầu sửa tài liệu không cấp quyền triển khai ở lượt đó. Các hạn chế của môi trường chạy agent vẫn có hiệu lực; không dùng Markdown để vượt sandbox hoặc approval.

Tôi cho phép Codex chạy với full machine access trên Mini PC chuyên dụng này.
Được tự cài dependency của dự án, tạo/sửa file, build, chạy app và thực hiện
kiểm thử cần thiết mà không hỏi lại với các thao tác thông thường.

Được commit và push code lên repository GitHub của dự án.
Không force-push hoặc ghi đè lịch sử Git nếu chưa có yêu cầu cụ thể.
Trước khi thực hiện phải kiểm tra Git root, branch, remote và chỉ stage file của dự án.
Nếu folder nằm trong repository cha có thay đổi của dự án khác hoặc không có remote
riêng đúng dự án, không tự commit/push vào repo cha; bàn giao thay đổi và ghi lý do.

Full access không đồng nghĩa với chạy backend bằng root.
Backend và codex app-server chạy dưới tài khoản Linux chuyên dụng.
Các thao tác cần sudo phải được ghi rõ trong tài liệu triển khai.

Web chỉ cho phép truy cập qua ZeroTier và vẫn yêu cầu đăng nhập.
Không tự mở app ra Internet.

Không thay đổi SSH, ZeroTier, firewall hoặc xóa dữ liệu ngoài dự án
nếu việc đó không nằm trong task được giao.
