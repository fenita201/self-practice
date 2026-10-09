import { chromium, expect, type Response } from "@playwright/test";
import { config } from "../src/server/config.js";
import { createApp } from "../src/server/app.js";
import { passwordHash } from "../src/server/store.js";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(".test-data/regression/projects");
await mkdir(root, { recursive: true });
await writeFile(
  path.join(root, "README.md"),
  "# Workspace kiểm thử\n\nEditor, session và status đã sẵn sàng.\n",
);
const previous = JSON.parse(
  await readFile("docs/evidence/chat-session-steer-live.json", "utf8"),
);
const cfg = {
  ...config(),
  roots: [root],
  scope: "allowed_projects",
  data: path.resolve(".test-data/regression/data"),
};
const { app, store, runtime, startRuntime } = await createApp(cfg);
const password = randomBytes(24).toString("hex");
store.set("password", passwordHash(password));
const evidence: any = {
  at: new Date().toISOString(),
  runtime: "real Codex app-server; isolated test DB/projects; no model calls",
  checks: [],
};
let browser: any;
const contrast = (a: string, b: string) => {
  const l = (c: string) => {
    const rgb = c
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((v) => {
        v /= 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const x = l(a),
    y = l(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
try {
  await startRuntime();
  if (!runtime.ready) throw new Error(runtime.error || "Runtime unavailable");
  await app.listen({ host: "127.0.0.1", port: 0 });
  const base = app.listeningOrigin;
  cfg.origin = base;
  cfg.secure = false;
  browser = await chromium.launch();
  for (const size of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 812, height: 375 },
  ]) {
    const context = await browser.newContext({
      viewport: size,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.message));
    await page.goto(base);
    await page.getByLabel("Mật khẩu").fill(password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByRole("button", { name: "View all", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Project", { exact: true }).selectOption(root);
    await page
      .getByRole("button", { name: "Project hiện tại", exact: true })
      .click();
    await page.locator(`.session[data-thread-id="${previous.thread}"]`).click();
    await expect(
      page.getByText("STEER_REGRESSION_OK", { exact: true }),
    ).toBeVisible();
    for (const dark of [false, true]) {
      const theme = dark ? "dark" : "light";
      if ((await page.locator("html").getAttribute("data-theme")) !== theme)
        await page
          .getByRole("button", { name: "Đổi theme", exact: true })
          .click();
      if (await page.locator(".mobile-nav").isVisible())
        await page
          .locator(".mobile-nav")
          .getByRole("button", { name: "Chat", exact: true })
          .click();
      await expect(page.locator(".model-chip")).not.toHaveText(
        "Chưa có dữ liệu",
      );
      await expect(page.locator(".effort-chip")).toHaveText("Suy luận: Vừa");
      await expect(page.locator(".context-chip")).toHaveText(
        "Context: 8,3% đã dùng",
      );
      await expect(page.locator(".quota-chip").first()).toContainText("5 giờ:");
      await expect(page.locator(".quota-chip").nth(1)).toContainText("1 tuần:");
      const chips = await page
        .locator(".meta-chip")
        .evaluateAll((elements: Element[]) =>
          elements.map((el) => {
            const style = getComputedStyle(el),
              rect = el.getBoundingClientRect();
            return {
              text: el.textContent,
              color: style.color,
              background: style.backgroundColor,
              left: rect.left,
              right: rect.right,
            };
          }),
        );
      for (const chip of chips) {
        if (
          contrast(chip.color, chip.background) < 4.5 ||
          chip.left < 0 ||
          chip.right > size.width
        )
          throw new Error(
            "Header chip contrast/layout failed " + JSON.stringify(chip),
          );
      }
      const timelineHeight = await page
        .locator(".timeline")
        .evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
      const sendBounds = await page
        .getByRole("button", { name: "Gửi ↑", exact: true })
        .evaluate((el: HTMLElement) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        });
      if (
        sendBounds.bottom > size.height ||
        sendBounds.top < 0 ||
        timelineHeight < (size.height > 600 ? 120 : 40)
      )
        throw new Error(
          "Chat space/send button failed " +
            JSON.stringify({ timelineHeight, sendBounds }),
        );
      await page.screenshot({
        path: `docs/evidence/metadata-real-${size.width}-${theme}-chat.png`,
      });
      await page
        .getByRole("button", { name: "Mức sử dụng / Trạng thái" })
        .click();
      const modal = page.getByRole("dialog", {
        name: "Mức sử dụng / Trạng thái",
      });
      await expect(modal.locator(".metric-value").nth(1)).not.toHaveText("—");
      const values = await modal.evaluate((el: any) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        const muted = getComputedStyle(el.querySelector(".status-timestamp"));
        return {
          rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
          width: innerWidth,
          height: innerHeight,
          fg: s.color,
          bg: s.backgroundColor,
          muted: muted.color,
          overflow: document.documentElement.scrollWidth > innerWidth,
          rawJsonVisible: Array.from(el.querySelectorAll("pre")).some(
            (p: any) => p.getClientRects().length > 0,
          ),
        };
      });
      const c = {
        ...values,
        rawJsonVisible: await modal.locator("pre").first().isVisible(),
        foregroundContrast: contrast(values.fg, values.bg),
        mutedContrast: contrast(values.muted, values.bg),
      };
      if (
        c.rect.left < 0 ||
        c.rect.right > size.width ||
        c.overflow ||
        c.rawJsonVisible ||
        c.foregroundContrast < 4.5 ||
        c.mutedContrast < 4.5
      )
        throw new Error("UI audit failed " + JSON.stringify(c));
      const filename = `docs/evidence/metadata-real-${size.width}-${theme}-status.png`;
      await page.screenshot({ path: filename });
      await modal.getByRole("button", { name: "Đóng", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Mức sử dụng / Trạng thái" }),
      ).toBeFocused();
      evidence.checks.push({
        viewport: size,
        theme,
        pass: true,
        ...c,
        chips,
        timelineHeight,
        sendBounds,
        screenshot: filename,
      });
    }
    const nav = async (name: string) => {
      if (await page.locator(".mobile-nav").isVisible())
        await page
          .locator(".mobile-nav")
          .getByRole("button", { name, exact: true })
          .click();
    };
    await nav("Files");
    await page.locator(".tree-name").filter({ hasText: "README.md" }).click();
    await nav("Code");
    await expect(page.locator(".cm-editor")).toBeVisible();
    await page.screenshot({
      path: `docs/evidence/metadata-real-${size.width}-editor.png`,
    });
    if (size.width === 1440) {
      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type("\nManual redesigned UI save check.\n");
      await page.keyboard.press("ControlOrMeta+s");
      await expect(page.getByText("Đã lưu README.md")).toBeVisible();
      if (
        !(await readFile(path.join(root, "README.md"), "utf8")).includes(
          "Manual redesigned UI save check.",
        )
      )
        throw new Error("Disk save failed");
      evidence.diskSave = true;
    }
    if (size.width === 1440) {
      await page
        .getByRole("button", { name: "Xem trước", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Workspace kiểm thử", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Mã nguồn", exact: true }).click();
      await page.getByRole("button", { name: "Ẩn/hiện files" }).click();
      await expect(page.locator(".files")).not.toBeVisible();
      await page.getByRole("button", { name: "Ẩn/hiện files" }).click();
      await page.getByRole("button", { name: "Refresh files" }).click();
      await page.getByLabel("Hiện thư mục ẩn").check();
      await page.getByLabel("Hiện thư mục ẩn").uncheck();
      await page
        .locator(".file-tools")
        .getByRole("button", { name: "＋ Folder", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Tên", { exact: true })
        .fill("qa-" + Date.now());
      await page
        .getByRole("button", { name: "Thực hiện", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const name = "qa-file-" + Date.now() + ".md";
      await page
        .locator(".file-tools")
        .getByRole("button", { name: "＋ File", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Tên", { exact: true })
        .fill(name);
      await page
        .getByRole("button", { name: "Thực hiện", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await page
        .getByRole("button", { name: "Thao tác " + name, exact: true })
        .click();
      await page
        .locator(".context")
        .getByRole("button", { name: "Copy path", exact: true })
        .click();
      await expect(page.getByText("Đã copy đường dẫn")).toBeVisible();
      await page
        .locator(".context")
        .getByRole("button", { name: "Chèn vào prompt", exact: true })
        .click();
      await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue(
        new RegExp(name),
      );
      await page
        .locator(".context")
        .getByRole("button", { name: "Đổi tên", exact: true })
        .click();
      const renamed = "renamed-" + name;
      await page
        .getByRole("dialog")
        .getByLabel("Tên", { exact: true })
        .fill(renamed);
      await page
        .getByRole("button", { name: "Thực hiện", exact: true })
        .click();
      await expect(
        page.locator(".tree-name").filter({ hasText: renamed }),
      ).toBeVisible();
      await page.getByLabel("Prompt", { exact: true }).fill("");
      if (
        (await page.locator(".mobile-nav").isVisible()) &&
        !(await page.locator(".session-actions").isVisible())
      )
        await page.locator(".session-details > summary").click();
      await page
        .locator(".chat-meta")
        .getByRole("button", { name: "Đổi tên", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByLabel("Tên", { exact: true })
        .fill("Manual UI regression");
      await page
        .getByRole("button", { name: "Thực hiện", exact: true })
        .click();
      await expect(page.locator(".chat-meta > strong")).toHaveText(
        "Manual UI regression",
      );
      await page
        .locator(".chat-meta")
        .getByRole("button", { name: "Đổi tên", exact: true })
        .click();
      await page.getByRole("button", { name: "Hủy", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const downloadResponse = page.waitForResponse((r: Response) =>
        r.url().endsWith("/log"),
      );
      await page
        .locator(".chat-meta")
        .getByRole("link", { name: "Tải log", exact: true })
        .click();
      const download = await downloadResponse;
      if (download.status() !== 200) throw new Error("Log download failed");
      await page
        .getByRole("button", { name: "＋ Project", exact: true })
        .click();
      const projectName = "qa-workspace-" + Date.now();
      await page
        .getByRole("dialog")
        .getByLabel("Tên", { exact: true })
        .fill(projectName);
      await page
        .getByRole("button", { name: "Thực hiện", exact: true })
        .click();
      await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
        path.join(root, projectName),
      );
      await page.getByLabel("Project", { exact: true }).selectOption(root);
      await page.getByRole("button", { name: "Refresh sessions" }).click();
      await page.getByLabel("Tìm session").fill("Manual UI regression");
      await expect(page.locator(".session")).toHaveCount(1);
      await page.getByLabel("Tìm session").fill("");
      await page.locator(".cm-content").click();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(" unsaved");
      await page
        .getByRole("button", { name: "Đóng README.md", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Hủy", exact: true }).click();
      await expect(page.locator(".cm-content")).toContainText("unsaved");
      await page
        .getByRole("button", { name: "Đóng README.md", exact: true })
        .click();
      await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
      await expect(page.locator(".cm-editor")).toHaveCount(0);
      evidence.buttonAudit = {
        selectProject: true,
        createProject: true,
        theme: true,
        panels: true,
        refreshFiles: true,
        hiddenFolders: true,
        createFolder: true,
        createFile: true,
        renameFile: true,
        copyPath: true,
        insertPath: true,
        markdownPreview: true,
        saveOnDisk: true,
        renameSession: true,
        cancelDialog: true,
        downloadLog: true,
        refreshSessions: true,
        searchSessions: true,
        dirtyCloseCancel: true,
        dirtyCloseConfirm: true,
      };
    }
    await page
      .getByRole("button", { name: "Mức sử dụng / Trạng thái" })
      .click();
    const statusDialog = page.getByRole("dialog", {
      name: "Mức sử dụng / Trạng thái",
    });
    await statusDialog.getByRole("button", { name: "Làm mới số liệu" }).click();
    await statusDialog.locator(".status-details > summary").click();
    await expect(statusDialog.locator("pre").first()).toBeVisible();
    await statusDialog.locator(".status-details > summary").click();
    await statusDialog
      .getByRole("button", { name: "Đăng xuất", exact: true })
      .click();
    await expect(page.getByLabel("Mật khẩu")).toBeVisible();
    if (errors.length) throw new Error("Browser JS errors " + errors.join(";"));
    await context.close();
  }
  evidence.pass = true;
} catch (e) {
  evidence.pass = false;
  evidence.error = (e as Error).message;
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await app.close();
  await writeFile(
    "docs/evidence/metadata-manual.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  console.log(JSON.stringify(evidence, null, 2));
}
