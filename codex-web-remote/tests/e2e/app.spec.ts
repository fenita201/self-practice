import { test, expect } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const project = path.resolve(".test-data/e2e/projects/alpha");
async function login(page: any) {
  await page.goto("/");
  await page.getByLabel("Mật khẩu").fill("e2e-only-fixture-password");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByText("View all", { exact: true })).toBeVisible();
}
async function nav(page: any, name: string) {
  if (await page.locator(".mobile-nav").isVisible())
    await page
      .locator(".mobile-nav")
      .getByRole("button", { name, exact: true })
      .click();
}
test("sessions, IDE draft/conflict, Markdown, create/rename, Status, streaming and replay", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await expect(page.locator(".session")).toHaveCount(20);
  await page.getByRole("button", { name: "Tải thêm session" }).click();
  await expect(page.locator(".session")).toHaveCount(40);
  await page.waitForTimeout(5500);
  await expect(page.locator(".session")).toHaveCount(40);
  await page.getByLabel("Project", { exact: true }).selectOption(project);
  await expect(
    page.getByRole("button", { name: "View all", exact: true }),
  ).toHaveClass(/active/);
  await nav(page, "Files");
  await page
    .locator(".files .tree-name")
    .filter({ hasText: "hello.ts" })
    .click();
  await nav(page, "Code");
  await expect(page.locator(".cm-editor")).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Sửa", exact: true }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\n// browser save " + info.project.name);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(page.getByText("Đã lưu hello.ts")).toBeVisible();
  expect(await readFile(path.join(project, "hello.ts"), "utf8")).toContain(
    "// browser save",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.type(" draft");
  await writeFile(path.join(project, "hello.ts"), "// external update\n");
  await expect(page.getByText(/File đã thay đổi trên đĩa/)).toBeVisible();
  await page.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(page.getByText("Conflict · Draft được giữ")).toBeVisible();
  await page.getByRole("button", { name: "Ghi đè có xác nhận" }).click();
  await page.getByRole("button", { name: "Xác nhận", exact: true }).click();
  await expect(page.getByText("Conflict · Draft được giữ")).toHaveCount(0);
  expect(await readFile(path.join(project, "hello.ts"), "utf8")).toContain(
    "draft",
  );
  await nav(page, "Files");
  await page
    .locator(".files .tree-name")
    .filter({ hasText: "README.md" })
    .click();
  await nav(page, "Code");
  await page.getByRole("button", { name: "Xem trước", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Fixture Markdown" }),
  ).toBeVisible();
  expect(await page.locator(".preview script").count()).toBe(0);
  await page.screenshot({
    path: "docs/evidence/" + info.project.name + "-ide.png",
    fullPage: true,
  });
  await nav(page, "Files");
  await page
    .locator(".file-tools")
    .getByRole("button", { name: "＋ File", exact: true })
    .click();
  const filename = "new-" + info.project.name + ".ts";
  await page
    .getByRole("dialog")
    .getByLabel("Tên", { exact: true })
    .fill(filename);
  await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Thao tác " + filename, { exact: true }).click();
  await page
    .locator(".context")
    .getByRole("button", { name: "Đổi tên", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Tên", { exact: true })
    .fill("renamed-" + info.project.name + ".ts");
  await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
  await expect(
    page
      .locator(".tree-name")
      .filter({ hasText: "renamed-" + info.project.name + ".ts" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Mức sử dụng / Trạng thái" }).click();
  await expect(
    page.getByRole("dialog", { name: "Mức sử dụng / Trạng thái" }),
  ).toBeVisible();
  await expect(
    page.getByText("Hạn mức tài khoản", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/" + info.project.name + "-status.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "＋ Chat mới" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toBeEnabled();
  await page
    .getByLabel("Prompt", { exact: true })
    .fill("fixture prompt " + info.project.name);
  await page.getByRole("button", { name: "Gửi ↑", exact: true }).click();
  await expect(
    page.getByText("Streaming fixture output", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Yêu cầu approval", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await nav(page, "Sessions");
  await page
    .locator(".session")
    .filter({ hasText: "Web fixture session" })
    .first()
    .click();
  await expect(
    page.getByText("Streaming fixture output", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Yêu cầu approval", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cho phép một lần", exact: true })
    .click();
  await expect(
    page.getByText("Codex cần thông tin", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("color", { exact: true }).fill("Xanh");
  await page.getByRole("button", { name: "Gửi trả lời", exact: true }).click();
  await expect(
    page.getByText("Đã nhận câu trả lời fixture", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Streaming fixture output", { exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "docs/evidence/" + info.project.name + "-timeline.png",
    fullPage: true,
  });
  await nav(page, "Files");
  await page.screenshot({
    path: "docs/evidence/" + info.project.name + "-files.png",
    fullPage: true,
  });
  await nav(page, "Sessions");
  await page.screenshot({
    path: "docs/evidence/" + info.project.name + "-sessions.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("external session cannot send; unauthorized API and origin protected", async ({
  page,
  request,
}) => {
  expect((await request.get("/api/projects")).status()).toBe(401);
  expect((await request.get("/api/threads/external-1/log")).status()).toBe(401);
  await login(page);
  await page
    .locator(".session")
    .filter({ hasText: "CLI fixture 1" })
    .first()
    .click();
  await nav(page, "Chat");
  await expect(page.getByLabel("Prompt", { exact: true })).toBeDisabled();
  await expect(
    page
      .locator(".chat")
      .getByText("Chỉ lịch sử đã lưu, chưa có live output của terminal", {
        exact: true,
      }),
  ).toBeVisible();
  await nav(page, "Sessions");
  await page
    .locator(".session")
    .filter({ hasText: "CLI fixture 0" })
    .first()
    .click();
  await nav(page, "Files");
  await expect(
    page.getByText("Session chỉ đọc; chưa được truy cập project."),
  ).toBeVisible();
});
test("empty chat history, automatic session refresh and Steer without randomUUID", async ({
  page,
}) => {
  // Simulate plain HTTP LAN, where randomUUID is not exposed by browsers.
  await page.addInitScript(() => {
    Object.defineProperty(window.crypto, "randomUUID", { value: undefined });
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  await login(page);
  await page.getByLabel("Project", { exact: true }).selectOption(project);
  const createdResponse = page.waitForResponse(
    (r) => r.url().endsWith("/api/threads") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "＋ Chat mới" }).click();
  const created = await (await createdResponse).json();
  await expect(page.getByLabel("Prompt", { exact: true })).toBeEnabled();
  await expect(page.getByText(/not materialized/)).toHaveCount(0);
  await nav(page, "Sessions");
  const count = await page.locator(".session").count();
  // A second client creates a chat; no UI action refreshes this page's list.
  const other = await page.evaluate(async (project) => {
    const me = await (await fetch("/api/me")).json();
    const r = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf },
      body: JSON.stringify({ project }),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }, project);
  await expect(page.locator(".session")).toHaveCount(count + 1, {
    timeout: 12000,
  });
  await page.locator(`.session[data-thread-id="${other.id}"]`).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toBeEnabled();
  await page.getByLabel("Prompt", { exact: true }).fill("fixture active turn");
  await page.getByRole("button", { name: "Gửi ↑", exact: true }).click();
  await expect(
    page.getByText("Yêu cầu approval", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Prompt", { exact: true })
    .fill("STEER_REGRESSION_MARKER");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect(
    page.getByText("Đã gửi hướng dẫn bổ sung cho turn đang chạy"),
  ).toBeVisible();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("");
  await expect(
    page.getByText("STEER_REGRESSION_MARKER", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy output" }).last().click();
  await expect(page.getByText("Đã copy nội dung")).toBeVisible();
  await page.getByRole("button", { name: "Dừng", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Steer", exact: true }),
  ).toHaveCount(0);
  // Materialize the first empty chat too, so the next project has no abandoned
  // draft affecting its pagination assertions.
  await nav(page, "Sessions");
  await page.locator(`.session[data-thread-id="${created.id}"]`).click();
  await page.getByLabel("Prompt", { exact: true }).fill("fixture cleanup");
  await page.getByRole("button", { name: "Gửi ↑", exact: true }).click();
  await expect(
    page.getByText("Yêu cầu approval", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dừng", exact: true }).click();
  if (await page.locator(".mobile-nav").isVisible())
    await page.locator(".session-details > summary").click();
  await expect(
    page.getByRole("button", { name: "Đổi tên", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Đổi tên", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Tên", { exact: true })
    .fill("QA renamed session " + Date.now());
  const title = await page
    .getByRole("dialog")
    .getByLabel("Tên", { exact: true })
    .inputValue();
  await page.getByRole("button", { name: "Thực hiện", exact: true }).click();
  await expect(page.locator(".chat-meta > strong")).toHaveText(title);
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await nav(page, "Sessions");
  await expect(
    page.locator(`.session[data-thread-id="${created.id}"]`),
  ).toHaveCount(0);
  await page.getByLabel("Archived", { exact: true }).check();
  await expect(
    page.locator(`.session[data-thread-id="${created.id}"]`),
  ).toHaveCount(1);
});
test("theme persistence, visual status, modal keyboard and responsive layout", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  for (const dark of [false, true]) {
    if (
      (await page.locator("html").getAttribute("data-theme")) !==
      (dark ? "dark" : "light")
    )
      await page
        .getByRole("button", { name: "Đổi theme", exact: true })
        .click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme",
      dark ? "dark" : "light",
    );
    await page
      .getByRole("button", { name: "Mức sử dụng / Trạng thái" })
      .click();
    const modal = page.getByRole("dialog", {
      name: "Mức sử dụng / Trạng thái",
    });
    await expect(modal.locator(".metric-value")).toHaveCount(4);
    await expect(modal.getByRole("progressbar")).toHaveCount(1);
    await expect(modal.locator(".status-details")).not.toHaveAttribute(
      "open",
      "",
    );
    await expect(modal.locator("pre").first()).not.toBeVisible();
    await modal.getByRole("button", { name: "Đăng xuất", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      modal.getByRole("button", { name: "Đóng", exact: true }),
    ).toBeFocused();
    await page.screenshot({
      path: `docs/evidence/redesign-${info.project.name}-status-${dark ? "dark" : "light"}.png`,
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Mức sử dụng / Trạng thái" }),
    ).toBeFocused();
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
      { width: 812, height: 375 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect(
        page.getByRole("button", { name: "Đổi theme", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Mức sử dụng / Trạng thái" })
        .click();
      await expect
        .poll(() =>
          modal.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth;
          }),
        )
        .toBe(true);
      await modal.getByRole("button", { name: "Đóng", exact: true }).click();
    }
    await page.screenshot({
      path: `docs/evidence/redesign-${info.project.name}-landscape-${dark ? "dark" : "light"}.png`,
      fullPage: true,
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".mobile-nav button")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
  ).toBe("0s");
  expect(errors).toEqual([]);
});
test("approval decline and cancel buttons submit the intended decision", async ({
  page,
}) => {
  await login(page);
  await page.getByLabel("Project", { exact: true }).selectOption(project);
  for (const [label, decision] of [
    ["Từ chối", "decline"],
    ["Hủy", "cancel"],
  ]) {
    const createdResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/threads") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "＋ Chat mới", exact: true })
      .click();
    await page
      .getByLabel("Prompt", { exact: true })
      .fill("Fixture approval button QA");
    const sentRequest = page.waitForRequest(
      (r) => r.url().endsWith("/turn") && r.method() === "POST",
    );
    await page.getByRole("button", { name: "Gửi ↑", exact: true }).click();
    const created = await (await createdResponse).json();
    expect((await sentRequest).url()).toContain(`/threads/${created.id}/turn`);
    await expect(page.locator(".approval")).toBeVisible();
    const response = page.waitForResponse(
      (r) => r.url().endsWith("/respond") && r.request().method() === "POST",
    );
    await page
      .locator(".approval")
      .getByRole("button", { name: label, exact: true })
      .click();
    const r = await response;
    expect(r.status()).toBe(200);
    expect(r.request().postDataJSON().decision).toBe(decision);
    await expect(page.locator(".approval")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Steer", exact: true }),
    ).toHaveCount(0);
  }
});

test("session model, effort and usage chips show effective values and isolate context", async ({
  page,
}) => {
  await page.route("**/api/status?thread=*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body.sessionUsage)
      body.sessionUsage.value = {
        total: { totalTokens: 1_000_000 },
        last: { totalTokens: 25_000 },
        modelContextWindow: 100_000,
      };
    body.quota = {
      rateLimits: {
        primary: { usedPercent: 10, windowDurationMins: 10080 },
        secondary: { usedPercent: 25, windowDurationMins: 300 },
      },
    };
    await route.fulfill({ response, json: body });
  });
  await login(page);
  await page.getByLabel("Project", { exact: true }).selectOption(project);
  await page.getByRole("button", { name: "＋ Chat mới", exact: true }).click();
  await expect(page.locator(".model-chip")).toHaveText("Fixture model");
  await expect(
    page.getByLabel("Model", { exact: true }).locator("option:checked"),
  ).toHaveText("Fixture model · theo session");
  await expect(
    page.getByLabel("Effort", { exact: true }).locator("option:checked"),
  ).toHaveText("Thấp · theo session");
  await expect(page.locator(".context-chip")).toContainText("Chưa có dữ liệu");
  await expect(page.locator(".quota-chip").first()).toHaveText(
    "5 giờ: 75% còn lại",
  );
  await expect(page.locator(".quota-chip").nth(1)).toHaveText(
    "1 tuần: 90% còn lại",
  );
  await page.getByLabel("Effort", { exact: true }).selectOption("high");
  await page.getByLabel("Prompt", { exact: true }).fill("metadata fixture QA");
  const dispatch = page.waitForResponse(
    (r) => r.url().endsWith("/turn") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Gửi ↑", exact: true }).click();
  expect((await dispatch).request().postDataJSON().effort).toBe("high");
  await expect(page.locator(".effort-chip")).toHaveText("Suy luận: Cao");
  await page
    .locator(".approval")
    .getByRole("button", { name: "Từ chối", exact: true })
    .click();
  await expect(page.locator(".context-chip")).toHaveText(
    "Context: 25% đã dùng",
  );
  const id = await page
    .locator(".session.selected")
    .getAttribute("data-thread-id");
  await page.getByRole("button", { name: "＋ Chat mới", exact: true }).click();
  await expect(page.locator(".context-chip")).toContainText("Chưa có dữ liệu");
  if (await page.locator(".mobile-nav").isVisible())
    await page.locator(".session-details > summary").click();
  await page.getByRole("button", { name: "Archive", exact: true }).click();
  await nav(page, "Sessions");
  await page.locator(`.session[data-thread-id="${id}"]`).click();
  await expect(page.locator(".effort-chip")).toHaveText("Suy luận: Cao");
  await expect(
    page.getByLabel("Effort", { exact: true }).locator("option:checked"),
  ).toHaveText("Cao · theo session");
  await expect(page.locator(".context-chip")).toHaveText(
    "Context: 25% đã dùng",
  );
});
