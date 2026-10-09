// Display helpers never infer context from the accumulated session total.
export const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value)
    : "—";
export const effortLabel = (effort: string | null | undefined) =>
  (
    ({
      none: "Không suy luận",
      minimal: "Tối thiểu",
      low: "Thấp",
      medium: "Vừa",
      high: "Cao",
      xhigh: "Rất cao",
    }) as Record<string, string>
  )[effort || ""] ||
  effort ||
  "Chưa có dữ liệu";
export function sessionModel(session: any, models: any[] = []) {
  const model = session?.policy?.model || session?.model;
  const catalog = models.find((m) => m.model === model);
  const effort = session?.policy?.reasoningEffort || session?.reasoningEffort;
  return {
    model,
    name: catalog?.displayName || model || "Chưa có dữ liệu",
    effort,
    catalog,
  };
}
export function contextUsage(value: any) {
  const used = value?.last?.totalTokens,
    window = value?.modelContextWindow;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    typeof window !== "number" ||
    !Number.isFinite(window) ||
    window <= 0
  )
    return null;
  return { used, window, percent: Math.min(100, (used / window) * 100) };
}
export function quotaWindows(quota: any) {
  return Object.entries(quota?.rateLimits || {})
    .filter(([key, value]) => ["primary", "secondary"].includes(key) && value)
    .map(([key, value]) => {
      const window = value as any;
      const minutes = window.windowDurationMins;
      const label =
        minutes === 300
          ? "5 giờ"
          : minutes === 10080
            ? "1 tuần"
            : typeof minutes === "number" && minutes > 0
              ? `${number(minutes)} phút`
              : key === "primary"
                ? "Hạn mức chính"
                : "Hạn mức phụ";
      const used =
        typeof window.usedPercent === "number" &&
        Number.isFinite(window.usedPercent)
          ? Math.min(100, Math.max(0, window.usedPercent))
          : null;
      return {
        ...window,
        key,
        label,
        used,
        remaining: used === null ? null : 100 - used,
      };
    });
}
