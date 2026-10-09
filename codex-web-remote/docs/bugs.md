# Bug register / QA 2026-10-09

| ID  | Phát hiện                                                          | Xử lý                                                                                    | Retest                             |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------- |
| B01 | Initialize requestAttestation sai kiểu                             | boolean false đúng schema                                                                | Doctor thật pass                   |
| B02 | Child exit phát status sau khi SQLite đóng                         | onClose guard closing                                                                    | PASS smoke/production shutdown     |
| B03 | Dedupe retry phụ thuộc upstream thread đã persist                  | Kiểm tra submission trước RPC, vẫn check own thread/root                                 | PASS fixture + smoke thật          |
| B04 | Watcher bị hủy ngay khi request GET kết thúc                       | Lifecycle gắn response close, không request close                                        | PASS browser dirty external update |
| B05 | SSE empty thread bị tháo khi reconnect                             | SnapshotReady tách khỏi badge reconnect                                                  | PASS browser stream/reload         |
| B06 | Request input mới bị state running ghi đè                          | Chuyển running trước gửi response upstream                                               | PASS approval/input browser        |
| B07 | Live command notification dùng outputDelta, không phải /delta      | Reconcile đúng outputDelta/summaryTextDelta; bỏ reasoning text/content trước API/journal | Unit regression pass               |
| B08 | Sidebar có thể nhận kết quả fetch cũ sau turn completed            | Request epoch + patch state qua SSE                                                      | Browser pass, ảnh timeline mới     |
| B09 | Watcher/save trả muộn có thể đè draft mới                          | Áp dụng kết quả dựa trên state hiện tại; dirty giữ text                                  | Regression test pass               |
| B10 | IDE bị khóa theo ownership của session dù cwd trong roots          | Tách projectAllowed khỏi readonly session                                                | PASS outside-root browser          |
| B11 | Status của selected thread trả 503 sau adapter crash, giữ badge cũ | Trả cached token stale, runtime false; SSE đổi state unknown                             | PASS regression selected status    |
| B12 | Doctor/password mở DB làm active turn thành unknown                | Crash recovery chỉ trong backend startup                                                 | Unit regression pass               |
| B13 | Hotkey save đôi lúc không gửi request khi nhập nhanh               | Save đọc draft ref mới nhất, updater cập nhật ref đồng bộ                                | PASS production desktop/mobile     |
| B14 | Login localhost trong WSL báo Origin khi instance giữ config cũ | Đặt PUBLIC_URL localhost theo yêu cầu và restart; bổ sung hướng dẫn WSL/restart | Browser localhost vượt kiểm tra Origin; sai password trả 401, origin khác vẫn 403 |
| B15 | Chat mới gọi history khi runtime chưa materialize thread | Chỉ xử lý RpcError -32600 đúng thông báo chưa có user message thành history rỗng; giữ lỗi khác | Backend regression + real app-server PASS |
| B16 | Sessions không tự cập nhật; thread mới chưa được runtime liệt kê | Giữ thread mới trong danh sách đến khi runtime có bản persisted; UI poll 5s/focus, giữ trang đã tải và filter | Live fresh thread PASS; desktop/mobile regression |
| B17 | Steer không có feedback; randomUUID không tồn tại trên HTTP LAN | ID ngẫu nhiên qua getRandomValues, nút gửi có busy/notice và giữ draft khi lỗi | Real turn/steer + persisted message PASS; browser mô phỏng HTTP LAN |
| B18 | Status modal trên mobile vượt viewport, nút Đóng ngoài màn hình | Grid minmax(0,1fr), min-width 0 và metric columns co giãn | Retest cả themes ở 375/768/1024/1440/landscape; nút Đóng click được |
| B19 | Nút Sửa/Xem desktop không thay đổi chế độ vì desktop luôn editable | Chỉ hiển thị nút chế độ trên phone/tablet | Desktop không có nút dư; mobile vẫn có Sửa/Xem |
| B20 | Đổi tên session chưa cập nhật tiêu đề chat ngay | Đồng bộ cache metadata backend và selected state frontend; chặn rename khi active | Browser rename + archive + Archived regression |
| B21 | Copy trên HTTP LAN thiếu clipboard API hoặc bị từ chối quyền | Fallback local selection, feedback và controlled error; giữ focus | Browser fixture tắt clipboard API; nút Copy output PASS |
| B22 | Archive chat chưa có message có thể vẫn hiện từ cache draft | Xóa draft khỏi danh sách unlisted sau archive thành công | Backend regression PASS; name/archive của blank thread RPC thật200 |
| B23 | Gửi quá nhanh sau Chat mới có thể đua với snapshot, bỏ lỡ approval và trạng thái chạy | Khóa composer ngay khi bấm Chat mới (không chỉ khi bắt đầu selectThread); chặn Prompt/Gửi đến snapshotReady; đọc lại meta/pending cuối snapshot; send response không cập nhật session khác hoặc ghi đè completion đã nhận | Regression bấm nhanh qua nút Từ chối/Hủy, desktop/mobile |
| B24 | Model/effort hiện “mặc định”, policy không cập nhật sau khi đổi effort cho lượt mới | Đọc policy được runtime xác nhận; lưu model/effort sau turn/start ACK, kế thừa đúng khi bỏ trống; khôi phục dữ liệu resume | Unit/backend + browser đổi effort, gửi, chuyển/mở lại session |
| B25 | Số liệu status có thể thuộc session trước hoặc ghi đè token SSE vừa nhận | Gắn threadId cho status; refresh ngay khi chọn session, loại response cũ theo epoch/ID; revision giữ notification nhận trong lúc request đang chạy | Browser context đổi session; token SSE cập nhật trực tiếp |
| B26 | Header nhiều chỉ số làm vùng đọc chat quá nhỏ, nút Gửi lệch viewport trên mobile/landscape | Gom thao tác phụ vào mục mở rộng; chips gọn hơn trên phone; compact landscape, giữ model/effort và số liệu | QA bổ sung đo timeline, tọa độ nút Gửi, contrast và ảnh 5 viewport × 2 theme |

Lỗi môi trường đầu lượt: DNS sandbox; IPC listen EPERM. Quyền sau pause đã được user cấp. Chromium test đầu chạy khi browser còn cài: ETXTBSY; cài xong rồi chạy lại. Đây không phải pass UI.

B04 bổ sung: WSL mounted drive không phát change qua native watcher trong probe; dùng polling 1s có giới hạn depth/project. Test watcher trên browser đã pass. Những lần smoke dừng đầu tiên đã xác minh turn interrupted/0 items, không tự replay; chỉ task smoke sau sửa lỗi hoàn thành. Bằng chứng `live-smoke.json` là task hoàn thành đó.

Trong vòng cuối, một lần Playwright gặp ENOMEM khi đọc module giữa nhiều browser/process kiểm tra đồng thời. Đã thu hẹp chạy tuần tự/1 worker và chạy lại; xem kết quả cuối trong implementation-status. Typecheck chạy trùng npm ci có lỗi module do node_modules đang thay; lần đó không tính kết quả, đã kiểm tra lại sau khi cài xong.
