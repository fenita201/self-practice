// Browser-driven manual QA with real production backend; no model prompts.
import { chromium, devices, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
const base = process.env.QA_URL || "http://127.0.0.1:3000";
const password = (await readFile("data/initial-password.txt", "utf8")).trim();
for (let i = 0; i < 30; i++) {
  try {
    if ((await fetch(base + "/healthz")).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch();
const evidence: any[] = [];
try {
  for (const mode of ["desktop", "mobile"]) {
    const context = await browser.newContext(
      mode === "mobile"
        ? { ...devices["Pixel 7"] }
        : { viewport: { width: 1500, height: 1000 } },
    );
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.screenshot({
      path: `docs/evidence/production-${mode}-login.png`,
    });
    await page.getByLabel("Mật khẩu").fill(password);
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(
      page.getByRole("button", { name: "View all", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "＋ Project", exact: true }).click();
    const name = "manual-qa-" + mode + "-" + Date.now();
    await page
      .getByRole("dialog")
      .getByLabel("Tên", { exact: true })
      .fill(name);
    await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const project = await page
      .getByLabel("Project", { exact: true })
      .inputValue();
    const nav = async (p: string) => {
      if (mode === "mobile")
        await page
          .locator(".mobile-nav")
          .getByRole("button", { name: p, exact: true })
          .click();
    };
    await nav("Sessions");
    await page
      .getByRole("button", { name: "Project hiện tại", exact: true })
      .click();
    await expect(page.locator(".session")).toHaveCount(0);
    await nav("Files");
    await page
      .locator(".file-tools")
      .getByRole("button", { name: "＋ Folder", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Tên", { exact: true })
      .fill("notes");
    await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .locator(".file-tools")
      .getByRole("button", { name: "＋ File", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Tên", { exact: true })
      .fill("README.md");
    await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.locator(".tree-name").filter({ hasText: "README.md" }).click();
    await nav("Code");
    if (mode === "mobile")
      await page.getByRole("button", { name: "Sửa", exact: true }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type(
      "# Production QA\n\nManual browser check: " + mode + "\n",
    );
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Đã lưu README.md")).toBeVisible();
    const file = path.join(project, "README.md");
    if (!(await readFile(file, "utf8")).includes("Production QA"))
      throw new Error("Actual disk save failed");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nDraft survives disk conflict.");
    await writeFile(file, "# External disk update\n");
    await expect(page.locator(".file-info")).toContainText("File đã thay đổi");
    await page.getByRole("button", { name: "Lưu", exact: true }).click();
    await expect(page.getByText("Conflict · Draft được giữ")).toBeVisible();
    await page.screenshot({
      path: `docs/evidence/production-${mode}-conflict.png`,
    });
    await page.getByRole("button", { name: "Ghi đè có xác nhận" }).click();
    await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
    await expect(page.getByText("Conflict · Draft được giữ")).toHaveCount(0);
    if (!(await readFile(file, "utf8")).includes("Draft survives"))
      throw new Error("Draft lost");
    await page.getByRole("button", { name: "Xem trước", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Production QA" }),
    ).toBeVisible();
    await page.screenshot({ path: `docs/evidence/production-${mode}-ide.png` });
    await nav("Sessions");
    await page
      .getByRole("button", { name: "Project hiện tại", exact: true })
      .click();
    await expect(page.locator(".session")).toHaveCount(0);
    await page.getByRole("button", { name: "Usage / Status" }).click();
    await expect(
      page.getByRole("dialog", { name: "Usage / Status" }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/evidence/production-${mode}-status.png`,
    });
    await page.getByRole("button", { name: "Đóng", exact: true }).click();
    // Inspect only this task's live smoke thread; no personal transcript is read.
    const live = JSON.parse(
      await readFile("docs/evidence/live-smoke.json", "utf8"),
    );
    const csrf = await page.evaluate(
      async () => (await (await fetch("/api/me")).json()).csrf,
    );
    const meta = await page.evaluate(
      async (id) => await (await fetch("/api/threads/" + id)).json(),
      live.threadId,
    );
    if (meta.error) throw new Error(meta.error);
    await page.getByLabel("Project", { exact: true }).selectOption(meta.cwd);
    await expect(
      page.locator(".session").filter({ hasText: "REMOTE_SMOKE_OK" }).first(),
    ).toBeVisible();
    await page
      .locator(".session")
      .filter({ hasText: "REMOTE_SMOKE_OK" })
      .first()
      .click();
    await nav("Chat");
    await expect(
      page.getByText("REMOTE_SMOKE_OK", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: `docs/evidence/production-${mode}-history.png`,
    });
    await nav("Sessions");
    await page.screenshot({
      path: `docs/evidence/production-${mode}-sessions.png`,
    });
    const status = await page.evaluate(
      async () => await (await fetch("/api/status")).json(),
    );
    const checks = {
      mode,
      url: base,
      project,
      login: true,
      createProject: true,
      createFolder: true,
      createFile: true,
      saveActualDisk: true,
      watcher: true,
      conflictDraftPreserved: true,
      markdownPreview: true,
      runtimeHistory: true,
      runtimeReady: status.ready,
      auth: status.account?.type || null,
      quotaAvailable: !!status.quota,
      accountUsageAvailable: !!status.accountUsage,
      errors,
      overflow: await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    };
    if (errors.length || checks.overflow)
      throw new Error("Browser UI errors/overflow");
    evidence.push(checks);
    await context.close();
  }
} finally {
  await browser.close();
  await mkdir("docs/evidence", { recursive: true });
  await writeFile(
    "docs/evidence/manual-production.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        source: "real production UI/backend/runtime history; no model request",
        checks: evidence,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(JSON.stringify(evidence, null, 2));
