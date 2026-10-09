export async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* HTTP LAN or permission restriction: try local selection. */
    }
  }
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  field.setAttribute("aria-hidden", "true");
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand("copy"))
      throw new Error("Không thể copy tự động; chọn nội dung và dùng Ctrl+C.");
  } finally {
    field.remove();
    previous?.focus();
  }
}
