# Codex Remote

Đọc README.md, docs/architecture.md và docs/implementation-status.md trước khi đổi hành vi. Đặc tả đầu vào v3 giữ nguyên. Không stage/commit repo cha (có các dự án khác).

Node 24, TypeScript/Fastify/React/Vite, SQLite node:sqlite, CodeMirror 6. npm ci; npm run typecheck; npm test; npm run build; npm run test:e2e. Test chỉ dùng data/project biệt lập. Fixture chỉ nằm tests, không có production fixture mode. Không gọi model trong test/doctor/status; smoke:live là thao tác chủ đích dùng quota.

App-server stdio lâu dài, bindings 0.161.0 sinh từ binary trong src/shared/protocol. Đổi version phải sinh lại schema, kiểm thử correlation và notification. Journal persist trước SSE; replay tuyệt đối không dispatch. Không dùng resume/start-turn để attach session bên ngoài. Ownership bên ngoài chưa xác minh = read-only. Không tự tăng sandbox/full-access.

Mọi project/file access đều kiểm tra realpath. Mutation khóa project và version. Không commit .env, data, passwords, credentials hay transcript cá nhân. Bằng chứng trong docs/evidence chỉ dùng project test. Update docs/bugs.md khi QA phát hiện lỗi.
