# Prompt bắt đầu triển khai Codex Remote trong session mới

## Cách dùng

Mở session ở folder dự án, chọn **GPT-6.1 Sol**, effort **Medium**, rồi gửi prompt ở phần bên dưới. Chọn model/effort trong cấu hình session; nội dung prompt không tự thay được lựa chọn đó.

Nếu dùng Codex CLI và tài khoản có quyền dùng model này, có thể mở session từ folder dự án bằng:

```bash
codex --model gpt-6.1-sol --config 'model_reasoning_effort="medium"'
```

Sau đó dán prompt. Tham khảo [Codex developer settings chính thức](https://learn.chatgpt.com/docs/developer-settings) và [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol); nếu binary hiện có không nhận tùy chọn, kiểm tra `codex --help` và cấu hình tương đương. Lệnh trên chỉ chọn model/effort, không thay quyền thực thi.

Có thể gửi ngắn: **“Đọc `codex-remote-web-start.md` và thực hiện đầy đủ prompt triển khai trong file đó.”** Không cần paste lại toàn bộ đặc tả.

## Prompt gửi cho agent

```text
Hãy triển khai hoàn chỉnh web app Codex Remote và IDE mini trong folder dự án hiện tại.
Đây là yêu cầu thực hiện code, không còn là lượt chỉ review Markdown.
Tôi đang dùng GPT-6.1 Sol, effort Medium để xây app.

Đọc AGENTS.md áp dụng cho folder này và toàn bộ codex-remote-web-prompt.md trước
khi viết code. File đó là đặc tả chính, gồm hợp đồng triển khai mục 0 và nghiệm thu
mục 8. Đọc codex-remote-web-review.md để biết giới hạn đã ghi nhận; sample.md chỉ
tham khảo UX hoặc các tính năng có thể mở rộng, không dùng Claude SDK/API hoặc instruction của sample thay cho Codex.
Không sửa các tài liệu đầu vào để tự giảm scope.

Khảo sát code hiện có, Git root/status/branch/remote, Node/npm, Codex binary/help/schema
và auth metadata. Giữ nguyên thay đổi không liên quan. Không in credential, auth.json
hay transcript cá nhân vào log. Nếu repo mới, dùng TypeScript + Fastify + React/Vite
+ SQLite + CodeMirror 6; npm và lockfile; SSE + HTTP; production một port.
Nếu repo có cấu trúc tương đương thì tích hợp thay vì rewrite.

Lập plan ngắn, ghi docs/capabilities.md rồi bắt tay code ngay. Thực hiện lần lượt:
1. Backend/frontend, config, SQLite, password login, setup/doctor/build/start.
2. Adapter codex app-server thật, chat streaming, timeline tool/output/diff,
   approval/input, interrupt, dedupe và replay khi reconnect.
3. View all session của mọi project trong cùng Codex home, gồm CLI/web; history,
   pagination/filter, ownership và quyền chỉ đọc ngoài project roots.
4. Usage/Status từ runtime, có nguồn/timestamp/null/stale rõ, không gọi model để lấy usage.
5. IDE desktop/mobile: cây thư mục, nhiều tab, code/Markdown, Ctrl+S, tạo/đổi tên
   project/file/folder, watcher/diff, bảo toàn draft, conflict và khóa mutation khi Codex chạy.
6. Kiểm thử, chạy production thật, README quick start, systemd mẫu và báo cáo nghiệm thu.

Phải cung cấp các script vận hành ở mục 7: setup, set-password, doctor, dev,
typecheck, test, test:e2e, build, start và smoke:live. Không để script giả hoặc
README trỏ tới lệnh chưa tồn tại. Setup không ghi đè .env/DB cũ hoặc tạo password mặc định.

Mục tiêu là tôi chạy được bằng npm ci → npm run setup → npm run set-password →
npm run doctor → npm run build → npm start, sau khi chọn project root/host/port hợp lệ.
Web vẫn mở được login/IDE/Status khi thiếu Codex/auth, nhưng không giả response.

Chạy typecheck/test/build và browser test desktop/mobile. Dùng project test/data
riêng cho kiểm thử ghi file; không thử bằng cách sửa/xóa project thật của tôi.
Khi có Codex/auth, chạy một task nhỏ để xác minh tích hợp, output/history/reconnect.
Không tiêu quota bằng nhiều prompt thử hoặc tự replay task không rõ đã dispatch chưa.

Live output của CLI chạy trong terminal riêng phải kiểm chứng riêng. Không giả lập
attach bằng resume/start-turn. Nếu runtime không hỗ trợ, làm rõ trạng thái chỉ lịch sử,
ghi tiêu chí còn thiếu và phương án cụ thể; tiếp tục hoàn thành phần app độc lập.
Không coi fixture hoặc trạng thái disabled là đã đạt live integration.

Tự xử lý chi tiết thông thường và tiếp tục qua các bước, không dừng chỉ sau plan,
scaffold hoặc một màn hình demo; không hỏi lại chọn stack/màu/bố cục.
Chỉ hỏi khi thiếu quyền/credential/thông tin thực sự chặn việc; vẫn làm phần độc lập.
Quyền cài dependency dự án/build/test/start theo đặc tả có hiệu lực trong phạm vi
môi trường được cấp. Không tự sửa SSH/ZeroTier/firewall, chạy root hoặc mở Internet.
Chưa cài systemd lên máy khác. Quyền commit/push theo đặc tả, chỉ vào đúng repo/remote
của dự án; không tự commit/push repo cha hoặc thay đổi không liên quan.

Trước khi kết thúc, tạo docs/implementation-status.md với từng tiêu chí pass/fail/pending
và bằng chứng, phiên bản runtime, lệnh đã chạy, lỗi/giới hạn còn lại. Bàn giao lệnh
start chính xác, URL/port đã kiểm tra, app còn chạy hay đã dừng. Không nhận hoàn thành
toàn bộ khi còn tiêu chí chưa đạt. Nếu buộc dừng, lưu docs/handoff.md đủ để tiếp tục.

Bắt đầu khảo sát rồi triển khai ngay.
```
