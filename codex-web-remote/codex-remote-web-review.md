# Nhận xét prompt Codex Remote

Ngày review: 2026-10-09. Đã đọc `codex-remote-web-prompt.md` và toàn bộ `sample.md`; chỉ cập nhật Markdown, chưa triển khai hoặc kiểm chứng runtime trên Mini PC.

Sau review, đặc tả đã lên v3 để giao triển khai bằng GPT-6.1 Sol / Medium: thêm thứ tự làm, script setup/doctor/build/start, điều kiện app chạy được và báo cáo nghiệm thu. Dùng `codex-remote-web-start.md` trong session mới; phần nhận xét v2 bên dưới được giữ làm bối cảnh, không thay cho đặc tả v3.

## Đánh giá chung

Prompt ban đầu đã có nền tảng tốt: dùng app-server lâu dài, tách adapter, giữ agent chạy khi browser mất kết nối, có dedupe/replay, quyền project, login và triển khai systemd. Có thể giữ kiến trúc này khi bổ sung IDE.

`sample.md` là yêu cầu cho Claude Code, nên phù hợp để tham khảo UX và mức độ cụ thể của nghiệm thu. Không chuyển nguyên API SDK, cách đọc session, vòng đời mỗi Query hay idle timeout sang Codex.

## Các điểm đã cải tiến trong prompt v2

| Điểm | Yêu cầu đã bổ sung/làm rõ |
|---|---|
| Session toàn project | Project hiện tại / View all; lấy từ runtime, gồm CLI và web, nhiều trang/nguồn; có cwd, trạng thái, ownership và quyền chỉ đọc ngoài roots |
| Session đang chạy | Mở giữa turn lấy history + output đã thu + delta mới; reconnect không trùng; chỉ rõ live web và khả năng quan sát CLI bên ngoài |
| Usage / Status | Tách trạng thái runtime/auth, quota tài khoản và token session/báo cáo tài khoản; dữ liệu thiếu/stale có nhãn, refresh không gọi model |
| IDE/editor | Cây thư mục lazy, nhiều tab, syntax highlight, Markdown preview, Ctrl+S, tạo/đổi tên project/file/folder, watcher và xử lý draft/conflict |
| Xung đột file | Etag + ghi atomic; khóa mutation trong project khi Codex chạy/chờ input và phối hợp save/start-turn; ghi rõ giới hạn với writer bên ngoài |
| Approval và trạng thái | Card câu hỏi/approval, badge chờ phản hồi, Dừng chỉ ngắt turn được quản lý; TTL login không dừng agent |
| Dữ liệu và vận hành | Retention/cursor gap, giới hạn journal, README từng bước và nghiệm thu desktop/mobile |
| Quyền triển khai | Giải quyết mâu thuẫn cấm commit/push với phần cho phép cuối file; quyền đó chỉ áp dụng khi giao triển khai, lượt này vẫn chỉ Markdown |

## Những điểm cần chú ý trước khi code

1. **View all và quyền project là hai phạm vi khác nhau.** Bản v2 mặc định xem session cùng Codex home, kể cả ngoài roots, nhưng chỉ điều khiển và dùng IDE trong project được phép. Đây là lựa chọn thiết kế để đáp ứng xem toàn project. Có cấu hình thu hẹp cả danh sách/lịch sử khi cần; không tự thêm project vào roots khi bấm session.
2. **Chưa thể cam kết live output của CLI độc lập.** API đọc lịch sử không tự đồng nghĩa subscribe stream của process khác. Phần này cần bằng chứng trên phiên bản thật; nếu chưa đạt, phải báo còn thiếu tính năng và đề xuất phương án vận hành cụ thể, không gọi lịch sử đã lưu là live. Kiến trúc dễ đảm bảo nhất cho công việc mới là khởi chạy qua runtime do web quản lý.
3. **“Hết output” cần có định nghĩa kiểm chứng được.** Mục tiêu là toàn bộ nội dung công khai đã nhận từ runtime; không chỉ final answer. Thu gọn UI khác với mất dữ liệu. Khi upstream truncate hoặc retention xóa event, phải đánh dấu thiếu và phạm vi log tải xuống.
4. **Usage token không phải quota còn lại.** UI phải có nguồn, phạm vi và thời điểm lấy; không tự tính chi phí subscription hay cộng trùng counter cumulative. Số liệu tài khoản không được gắn nhầm thành số liệu riêng project đang chọn.
5. **IDE tăng phạm vi MVP nhưng có thể giữ gọn.** Bản v2 có các thao tác bạn yêu cầu; chưa cần terminal tùy ý, xóa file/folder, clone repo hoặc tính năng IDE đầy đủ. Quan trọng nhất là không làm mất draft và không ghi đè thay đổi của Codex.
6. **Etag + rename chưa đủ chống race với mọi process.** Bản v2 chọn khóa lưu/tạo/đổi tên khi turn được quản lý đang hoạt động, cho phép sửa draft và lưu sau khi kiểm tra version. External editor/CLI không theo khóa này vẫn là giới hạn phải ghi rõ, không tuyên bố chống xung đột tuyệt đối.

## Căn cứ và phần chưa xác minh

[Tài liệu Codex App Server chính thức](https://developers.openai.com/codex/app-server) là căn cứ khảo sát thread/history, streaming và dữ liệu account/usage; [CLI reference chính thức](https://developers.openai.com/codex/cli/reference) dùng đối chiếu hành vi CLI. Method, field, capability experimental và auth thực tế phải kiểm tra lại theo binary/schema trên máy triển khai.

Chưa chạy Codex/app-server, đọc transcript cá nhân, gửi prompt thử, cài dependency hoặc viết code trong lượt này. `sample.md` giữ nguyên. Việc cập nhật yêu cầu không đồng nghĩa đã chứng minh các tính năng chạy được.
