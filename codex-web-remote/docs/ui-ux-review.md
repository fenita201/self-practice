# Kiểm tra UI/UX và các nút — 2026-10-09

App được làm lại theo `ui-ux-pro-max` từ [repo người dùng yêu cầu](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill), cài tại `/home/ploi26/.codex/skills/ui-ux-pro-max`. Hướng thiết kế được chọn và điều chỉnh cho IDE trong `design-system/codex-remote/MASTER.md`. Skill search gợi ý landing page không phù hợp đã bị loại bỏ; không dùng nó như kết quả đã được xác minh cho workspace.

## Luồng đã kiểm tra

| Nhóm nút | Hành vi đã đối chiếu | Nguồn kiểm tra |
| --- | --- | --- |
| Login, logout | Đăng nhập, logout về màn mật khẩu; busy trong lúc gửi; Origin vẫn khớp cấu hình | Backend thật với password test riêng, fixture Origin/unauth |
| Sáng/tối | Đổi theme cả app/login; giữ lựa chọn sau reload; editor/modal cùng theme | Browser desktop/mobile; cả hai màu |
| Chọn/tạo project | Select workspace, tạo project mới trong root test | Backend thật, có kiểm tra select chuyển đúng đường dẫn |
| View all/Project hiện tại, Search, source/state, Archived | Giữ scope khi đổi workspace, phân trang, tự refresh5s/focus; Archived hiện session đã lưu trữ | Fixture46+ sessions, backend thật search/refresh |
| Chat mới | History rỗng trước user message, có trong Sessions trước khi persist | Runtime thật + backend/browser regression; bấm nhanh gửi đúng ID mới |
| Gửi, Steer, Dừng | Gửi đúng turn, nhận bổ sung, không duplicate, có feedback; Dừng kết thúc turn | Steer/completion thật; fixture browser waiting/interrupt; live interrupt trước đó |
| Approval/input | Đúng ID, accept/decline/cancel và input, reload vẫn giữ request | Fixture browser/protocol; chưa ép approval/input trên model thật |
| Đổi tên, Archive, tải log | Tiêu đề và list cập nhật ngay; archive rời list thường, hiện ở Archived; log HTTP200 | Rename/log thật, Archive/filter fixture |
| Files và context menu | Refresh, hidden toggle, tạo file/folder, rename, Copy path, chèn path vào Prompt | Backend thật trên thư mục test; clipboard fallback fixture HTTP LAN |
| Editor | Mở nhiều tab, preview Markdown, nút Lưu/Ctrl+S ghi đĩa, conflict giữ draft | Backend thật và fixture |
| Đóng tab, Hủy, Xác nhận | Draft chưa lưu có đối thoại; Hủy giữ draft, Xác nhận bỏ draft và đóng | Browser với backend thật |
| Ẩn/hiện panel | Toggle khôi phục đúng Files; desktop có các panel, phone/tablet dùng4tab | Browser thật + fixture responsive |
| Usage/Status, Refresh, Chi tiết, Đóng/Escape | Thẻ tài khoản/gói, token, turn; quota progress + remaining/reset; JSON đóng mặc định; keyboard trap/restore | Backend thật; 10 viewport/theme cases |

Bằng chứng cụ thể: `docs/evidence/redesign-manual.json` gồm10 trường hợp ở1440×1000,375×812,768×1024,1024×768 và812×375, mỗi kích thước2themes. `buttonAudit` ghi từng nhóm nút đã bấm với backend thật và diskSave=true. `docs/evidence/chat-session-steer-live.json` ghi task thật có Steer được persist và marker cuối đúng. `tests/e2e/app.spec.ts` chạy10 tests/1worker với server fixture biệt lập; fixture không chứng minh khả năng model/quota thực.

## Nút dư và vị trí bố trí

- Bỏ nút Sửa/Xem ở desktop vì desktop luôn editable: trước đây bấm không đổi chế độ. Phone/tablet giữ nút để chuyển từ xem sang sửa.
- Session policy và payload Status chuyển vào phần Chi tiết đóng mặc định; bớt JSON/metadata chiếm chỗ. Kết quả turn hiển thị trạng thái đọc được; log vẫn giữ dữ liệu công khai đã thu.
- Header chứa theme và Status; hàng workspace chứa chọn project/tạo chat. File actions nằm trong Files và context menu cho thư mục con; Save nằm sát editor; Gửi/Steer/Dừng nằm sát Prompt.
- Gửi là primary; Steer là hướng dẫn cho turn đang chạy; Dừng có màu cảnh báo. Steer chỉ dùng khi có nội dung và turn active, có busy và thông báo gửi thành công.
- Không bỏ Refresh dù có auto refresh: nó cho phép cập nhật chủ đích, còn polling có giới hạn và chỉ chạy khi trang đang hiển thị.
- Create File/Folder ở toolbar áp dụng root project; context menu áp dụng folder đang chọn, không phải hai nút trùng vị trí tác động.
- Logout trong Status giúp người dùng mobile, nơi header rút gọn. Theme trên login và trong app xuất hiện ở hai trạng thái khác nhau, không đồng thời.
- Status có nút Đóng cố định khi cuộn và Escape; phone có44px cho các nút thao tác chính. Reduced-motion tắt animation/smooth scroll.

## Lỗi tìm thấy và sửa

`docs/bugs.md` B15–B23 ghi lỗi và retest: empty chat materialization, list không refresh, Steer/HTTP LAN ID, modal tràn viewport, nút edit dư, rename chưa đồng bộ, Clipboard unavailable, archive draft cache và race khi Gửi trước khi snapshot nạp xong. Đã xem ảnh thật light/dark desktop và phone để đối chiếu chữ, vị trí và vùng nhìn.

Màu chữ chính trong Status đo được contrast≈15:1; chữ phụ≈5.93:1 ở light và≈7.88:1 ở dark. Đây là phép đo cho các token Status được kiểm tra, không phải chứng nhận WCAG toàn ứng dụng.

## Giới hạn giữ nguyên

Đây là browser-driven manual QA của agent, không thay thế nghiệm thu của người dùng trên điện thoại vật lý/MiniPC/ZeroTier. Live CLI độc lập vẫn chỉ có history đã persist (#11 của v3 chưa đạt). Không dùng chart lịch sử/chi phí giả khi runtime không cung cấp dữ liệu. Quota còn lại =100−usedPercent, có nguồn và timestamp. Editor chunk vẫn có warning kích thước khi build nhưng được tải khi mở file; JS tải đầu giảm từ≈374.8KB xuống≈129.1KB gzip.

## Điều chỉnh model, hạn mức và phân vùng

Bộ chọn model/effort hiển thị tên và mức suy luận đang kế thừa từ session, thay chữ “mặc định”. Đổi model/effort vẫn chỉ có hiệu lực khi gửi lượt tiếp theo; header hiển thị policy đã được backend xác nhận, không đổi theo giá trị đang chọn nhưng chưa gửi. Khi mở lại session, bộ chọn quay về giá trị kế thừa của session đó.

Header gồm model, mức suy luận, context đã dùng, hạn mức 5 giờ và 1 tuần còn lại. Hai cửa sổ nhận diện bằng windowDurationMins=300/10080, không giả định primary luôn là 5 giờ. Thiếu dữ liệu hiển thị “Chưa có dữ liệu”, stale có nhãn riêng. Context tính last.totalTokens/modelContextWindow, không dùng total tích lũy; tooltip nói rõ tỷ lệ trên toàn bộ cửa sổ, gồm hướng dẫn hệ thống, khác cách TUI trừ baseline. Ý nghĩa last là context gần nhất theo [mã nguồn protocol của Codex](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs). Dữ liệu thay thế theo snapshot/notification, không cộng dồn lần nữa.

“Mức sử dụng / Trạng thái”, “Hạn mức tài khoản”, “Lần xử lý gần nhất”, “Đầu vào/Đầu ra”, “Đặt lại vào”, “Làm mới số liệu” dùng thuật ngữ nhất quán. last token usage là lần xử lý gần nhất, không khẳng định là tổng token của một lượt gồm nhiều lần gọi công cụ.

Sẵn sàng: xanh; đang chạy: vàng; chờ trả lời/duyệt: tím; lỗi: đỏ; đã dừng: xanh dương. Mỗi nhãn luôn có chữ, không chỉ dựa vào màu. Sessions nền xanh nhẹ, Files nền xanh lá nhẹ, Chat nền ấm và editor nền trung tính; tiêu đề và các thẻ có điểm nhấn riêng, cả hai theme.

Ở phone/tablet, “Thông tin & thao tác session” mở thêm đổi tên/lưu trữ/tải log và tìm output; trên desktop các nút vẫn hiện trực tiếp. Các chỉ số chính luôn hiện. Kiểm tra bổ sung contrast chip ≥4.5, không tràn ngang, nút Gửi trong viewport, vùng timeline tối thiểu 120px ở portrait và 40px ở landscape thấp. Ảnh và dữ liệu kiểm tra mới: metadata-real-*.png, metadata-manual.json. Đây là QA bằng browser trên WSL, chưa thay thế nghiệm thu trên thiết bị của người dùng.
