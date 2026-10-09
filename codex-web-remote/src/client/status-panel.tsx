import { Icon } from "./icon";
import { number, quotaWindows } from "./usage";
export function StatusPanel({
  status,
  close,
  refresh,
  logout,
}: {
  status: any;
  close: () => void;
  refresh: () => void;
  logout: () => void;
}) {
  const usage = status?.sessionUsage?.value;
  const counts = (status?.counts || []) as { state: string; count: number }[];
  return (
    <section
      className="status-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="status-heading"
      tabIndex={-1}
    >
      <div className="panel-title">
        <h2 id="status-heading">
          <Icon name="activity" />
          Mức sử dụng / Trạng thái
        </h2>
        <button onClick={close}>Đóng</button>
      </div>
      <div className="status-intro">
        <div>
          <span className="eyebrow">TRẠNG THÁI KHÔNG GIAN LÀM VIỆC</span>
          <h3>{status?.ready ? "Sẵn sàng làm việc" : "Codex chưa kết nối"}</h3>
          <p>
            {status?.ready
              ? "Kết nối với Codex đang hoạt động."
              : "Kiểm tra Codex trên máy chủ để tiếp tục chat."}
          </p>
        </div>
        <span className={"badge " + (status?.ready ? "idle" : "unknown")}>
          {status?.ready ? "Đã kết nối" : "Mất kết nối"}
        </span>
      </div>
      <p className="status-timestamp">
        Cập nhật{" "}
        {status?.at
          ? new Date(status.at).toLocaleString("vi-VN")
          : "chưa có dữ liệu"}
        {status?.stale ? " · Dữ liệu có thể đã cũ" : ""}
      </p>
      {status?.error && <p className="banner error">{status.error}</p>}
      <div className="status-grid metrics">
        <article>
          <span className="metric-label">Tài khoản</span>
          <strong className="metric-value">
            {status?.account?.type === "chatgpt"
              ? "ChatGPT"
              : status?.account?.type || "Chưa đăng nhập"}
          </strong>
          <small>Gói: {status?.account?.planType || "Chưa có dữ liệu"}</small>
        </article>
        <article>
          <span className="metric-label">Token của phiên chat</span>
          <strong className="metric-value">
            {number(usage?.total?.totalTokens)}
          </strong>
          <small>
            {usage ? "Tổng tích lũy" : "Chọn phiên chat có dữ liệu token"}
            {status?.sessionUsage?.stale ? " · Đã cũ" : ""}
          </small>
        </article>
        <article>
          <span className="metric-label">Lần xử lý gần nhất</span>
          <strong className="metric-value">
            {number(usage?.last?.totalTokens)}
          </strong>
          <small>
            {usage
              ? `Đầu vào ${number(usage.last?.inputTokens)} · Đầu ra ${number(usage.last?.outputTokens)}`
              : "Chưa có dữ liệu xử lý"}
          </small>
        </article>
        <article>
          <span className="metric-label">Phiên đang hoạt động</span>
          <strong className="metric-value">
            {number(
              status?.counts
                ? counts
                    .filter((r) =>
                      ["running", "waiting_input", "waiting_approval"].includes(
                        r.state,
                      ),
                    )
                    .reduce((sum, r) => sum + r.count, 0)
                : null,
            )}
          </strong>
          <small>Phiên chat do web quản lý</small>
        </article>
      </div>
      <h3>Hạn mức tài khoản</h3>
      <div className="quota-windows">
        {quotaWindows(status?.quota).map((b) => {
          const percent = b.used;
          const k = b.key;
          return (
            <article key={k}>
              <div className="quota-heading">
                <strong>{b.label}</strong>
                <span>
                  {percent === null
                    ? "Không khả dụng"
                    : `${number(b.remaining)}% còn lại`}
                </span>
              </div>
              {percent !== null && (
                <div
                  className="quota-track"
                  role="progressbar"
                  aria-label={`Hạn mức ${b.label} đã dùng`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.min(100, Math.max(0, percent))}
                >
                  <span
                    style={{
                      width: `${Math.min(100, Math.max(0, percent))}%`,
                    }}
                  />
                </div>
              )}
              <small>
                {percent === null
                  ? "Chưa có dữ liệu sử dụng"
                  : `${number(percent)}% đã dùng`}{" "}
                · Trong {b.label}
              </small>
              <small>
                Đặt lại vào:{" "}
                {b.resetsAt
                  ? new Date(b.resetsAt * 1000).toLocaleString("vi-VN")
                  : "Chưa có dữ liệu"}
              </small>
            </article>
          );
        })}
      </div>
      {!status?.quota?.rateLimits && (
        <p className="muted">Hạn mức chưa khả dụng cho tài khoản này.</p>
      )}
      <details className="status-details">
        <summary>Chi tiết dữ liệu và khả năng của Codex</summary>
        <p>
          Nguồn: {status?.source || "Dữ liệu từ Codex"} ·{" "}
          {status?.version || "Chưa có dữ liệu"}
        </p>
        <div className="status-grid">
          {[
            ["Đăng nhập / gói tài khoản", status?.account],
            ["Dữ liệu hạn mức", status?.quota],
            ["Mức sử dụng tài khoản (Codex cung cấp)", status?.accountUsage],
            [
              "Token phiên chat: tổng / lần xử lý gần nhất",
              status?.sessionUsage,
            ],
            ["Lượt chat web đang theo dõi", status?.counts],
            ["Chức năng được hỗ trợ", status?.capabilities],
          ].map(([label, value]) => (
            <article key={String(label)}>
              <h3>{String(label)}</h3>
              <pre>
                {value
                  ? JSON.stringify(value, null, 2)
                  : "Không khả dụng / Chưa có dữ liệu"}
              </pre>
            </article>
          ))}
        </div>
        <p>{status?.externalLive}</p>
      </details>
      {status?.errors?.map((error: string) => (
        <p className="error" key={error}>
          {error}
        </p>
      ))}
      {status?.storageError && <p className="error">{status.storageError}</p>}
      <div className="status-footer">
        <small>Số liệu từ Codex; làm mới không gửi yêu cầu cho model.</small>
        <button onClick={refresh}>
          <Icon name="refresh" />
          Làm mới số liệu
        </button>
        <button onClick={logout}>
          <Icon name="logout" />
          Đăng xuất
        </button>
      </div>
    </section>
  );
}
