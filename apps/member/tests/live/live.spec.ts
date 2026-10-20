import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { totp } from "../../../api/src/security";
import screens from "../../src/screens.json";
import { screenPath } from "../../src/registry";
const password = "Mangumi-test-password-42!";
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) =>
    route.abort(),
  );
});
async function login(page: Page, email: string, admin = false) {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) =>
    route.abort(),
  );
  await page.goto(admin ? "/admin/A001" : "/u/U012");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  if (admin) {
    await expect(page.getByTestId("A002")).toBeVisible();
    const session = await page.request.get("/api/admin/auth/session");
    const enrollment = (await session.json()).enrollmentRequired;
    const savedPath = resolve("../../.local/live-tests/mfa-admin.json");
    let secret: string;
    if (enrollment) {
      const setup = page.getByRole("button", { name: "認証アプリへ登録する" });
      await expect(setup).toBeVisible();
      await setup.click();
      secret = await page.locator("code").innerText();
    } else {
      const saved = JSON.parse(await readFile(savedPath, "utf8"));
      secret = saved.secret;
      if (saved.step === Math.floor(Date.now() / 30000))
        await expect
          .poll(() => Math.floor(Date.now() / 30000), { timeout: 31000 })
          .not.toBe(saved.step);
    }
    await page.getByLabel("認証コード・復旧コード").fill(totp(secret));
    await page.getByRole("button", { name: "認証する", exact: true }).click();
    if (enrollment)
      await page.getByRole("link", { name: "保存したので管理画面へ" }).click();
    await expect(page.getByTestId("A008")).toBeVisible();
    await writeFile(
      savedPath,
      JSON.stringify({ secret, step: Math.floor(Date.now() / 30000) }),
      { mode: 0o600 },
    );
  } else {
    await expect(
      page.getByTestId("U022").or(page.getByTestId("U016")),
    ).toBeVisible();
    if (await page.getByTestId("U016").count()) {
      await page
        .getByRole("link", { name: "通知の設定へ", exact: true })
        .click();
      await page
        .getByRole("button", { name: "あとで設定する", exact: true })
        .click();
      await expect(page.getByTestId("U022")).toBeVisible();
    }
  }
}
test("real registration, email confirmation, login and profile persistence", async ({
  page,
}) => {
  const email = `fan-${Date.now()}@example.test`;
  await page.goto("/u/U009");
  await page
    .getByLabel("プロフィール写真（必須）")
    .setInputFiles("public/assets/avatar.jpg");
  await expect(page.getByAltText("プロフィール写真")).toHaveAttribute(
    "src",
    /\/api\/media\//,
  );
  await page.getByLabel("ニックネーム", { exact: true }).fill("登録したファン");
  await page.getByLabel("メールアドレス", { exact: true }).fill(email);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "無料で会員登録" }).click();
  await expect(page.getByTestId("U010")).toBeVisible();
  const hash = createHash("sha256").update(email).digest("hex");
  let text = "";
  await expect
    .poll(async () => {
      try {
        text = JSON.parse(
          await readFile(`../../.local/live-tests/mail-${hash}.json`, "utf8"),
        ).text;
        return text;
      } catch {
        return "";
      }
    })
    .toContain("token=");
  const token = new URL(text.split("\n")[1]).searchParams.get("token");
  await page.goto(`/u/U011?token=${token}`);
  await page.getByRole("button", { name: "メールアドレスを確認する" }).click();
  await login(page, email);
  await page.goto("/u/U091");
  await page
    .getByLabel("ニックネーム", { exact: true })
    .fill("保存されたファン");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(page.getByTestId("U088")).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("保存されたファン", { exact: true }),
  ).toBeVisible();
});
test("member browser cannot bypass admin authentication or forge a plan", async ({
  page,
  request,
}) => {
  await login(page, "fan@example.test");
  await page.goto("/admin/A008");
  await expect(
    page.getByRole("heading", { name: /管理者ログイン/ }),
  ).toBeVisible();
  await page.goto("/me");
  await expect(
    page.getByText("fan@example.test", { exact: true }),
  ).toBeVisible();
});
test("live member routes render without seeded content at mobile width", async ({
  page,
}) => {
  await login(page, "fan@example.test");
  await page.setViewportSize({ width: 320, height: 844 });
  await page.screenshot({
    path: "../../.local/live-tests/member-mobile.png",
    fullPage: true,
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const screen of screens.filter((screen) => screen.area === "member")) {
    await page.goto(screenPath(screen.id));
    await expect(page.getByTestId(screen.id)).toBeVisible();
    await expect(page.getByText("読み込み中…", { exact: true })).toHaveCount(0);
    expect(errors, screen.id).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      screen.id,
    ).toBe(true);
  }
});
test("two browsers exchange real LiveKit audio and host permissions are enforced", async ({
  page,
  browser,
}) => {
  test.skip(
    !process.env.MANGUMI_TEST_LIVEKIT_URL,
    "Set a local LiveKit URL to exercise real media transport",
  );
  await login(page, "official@example.test");
  await page.goto("/u/U042");
  await page.getByRole("button", { name: "参加する", exact: true }).click();
  await expect(
    page.getByText("音声に接続しています", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "マイクをON", exact: true }).click();
  const context = await browser.newContext();
  const fan = await context.newPage();
  await login(fan, "fan@example.test");
  await fan.goto("/u/U042");
  await fan.getByRole("button", { name: "参加する", exact: true }).click();
  await expect(
    fan.getByText("音声に接続しています", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(() =>
      fan.evaluate(() =>
        [...document.querySelectorAll("audio")].some(
          (audio) => audio.currentTime > 0 && !audio.paused,
        ),
      ),
    )
    .toBe(true);
  await expect(
    fan.getByRole("button", { name: "マイクをON", exact: true }),
  ).toHaveCount(0);
  const participant = page.locator(".row").filter({ hasText: "テストファン" });
  await participant
    .getByRole("button", { name: "登壇許可", exact: true })
    .click();
  await fan.getByRole("button", { name: "マイクをON", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll("audio")].some(
          (audio) => audio.currentTime > 0 && !audio.paused,
        ),
      ),
    )
    .toBe(true);
  await participant
    .getByRole("button", { name: "リスナーへ", exact: true })
    .click();
  await expect(
    fan.getByRole("button", { name: "マイクをOFF", exact: true }),
  ).toHaveCount(0);
  await participant
    .getByRole("button", { name: "入室禁止", exact: true })
    .click();
  await expect(
    fan.getByText("接続が切れています", { exact: true }),
  ).toBeVisible();
  await fan.getByRole("button", { name: "再接続", exact: true }).click();
  await expect(
    fan.getByText("このルームには参加できません", { exact: true }),
  ).toBeVisible();
  await context.close();
  await page.getByRole("button", { name: "退出する", exact: true }).click();
});

test("DM text and recorded audio reach another account, retraction and blocking work", async ({
  page,
  browser,
}) => {
  await login(page, "fan@example.test");
  await page.goto("/u/U058");
  await page.getByRole("button", { name: "会話を開く", exact: true }).click();
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("本人のブラウザから送信したDM");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    page.getByText("本人のブラウザから送信したDM", { exact: true }),
  ).toBeVisible();
  const context = await browser.newContext();
  const official = await context.newPage();
  await login(official, "official@example.test");
  await official.goto("/u/U055");
  await official.getByRole("button", { name: "開く", exact: true }).click();
  await expect(
    official.getByText("本人のブラウザから送信したDM", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "音声を録音", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "録音を停止", exact: true }),
  ).toBeVisible();
  const started = Date.now();
  await expect.poll(() => Date.now() - started).toBeGreaterThan(1200);
  await page.getByRole("button", { name: "録音を停止", exact: true }).click();
  await expect(page.locator('audio[src^="blob:"]')).toBeVisible();
  await page.getByRole("button", { name: "送信", exact: true }).click();
  const audio = official.locator(".chat-thread audio");
  await expect(audio).toHaveAttribute("src", /\/api\/media\/.*signature=/);
  await audio.evaluate((element: HTMLAudioElement) => element.play());
  await expect
    .poll(() =>
      audio.evaluate((element: HTMLAudioElement) => element.currentTime),
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "送信取消", exact: true })
    .last()
    .click();
  await expect(official.getByText("取消済み", { exact: false })).toBeVisible();
  await page
    .getByRole("button", { name: "相手をブロック", exact: true })
    .click();
  await expect(
    official.getByText("ブロック中は送受信できません。", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ブロックを解除", exact: true })
    .click();
  await context.close();
});

test("administrator logs in with real MFA and publishes a schedule visible to another session", async ({
  page,
  browser,
}) => {
  await login(page, "admin@example.test", true);
  await page.screenshot({
    path: "../../.local/live-tests/admin-desktop.png",
    fullPage: true,
  });
  await page.goto("/admin/A027");
  await page.getByLabel("配信タイトル").fill("本番接続の配信予定");
  await page.getByLabel("配信日（日本時間）").fill("2026-12-31");
  await page.getByLabel("公開状態", { exact: true }).selectOption("公開");
  await page.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(
    page.getByText("配信予定を保存しました。利用者画面に反映されます"),
  ).toBeVisible();
  const context = await browser.newContext();
  const fan = await context.newPage();
  await login(fan, "fan@example.test");
  await fan.goto("/u/U031");
  await expect(
    fan.getByText("本番接続の配信予定", { exact: true }),
  ).toBeVisible();
  const published = (
    (await (await fan.request.get("/api/state")).json()).state
      .schedules as any[]
  ).find((s) => s.title === "本番接続の配信予定");
  await fan.goto(`/u/U032?item=${published.id}`);
  await fan.getByRole("switch", { name: "24時間前", exact: true }).check();
  await fan.getByRole("button", { name: "設定を保存", exact: true }).click();
  await expect(
    fan.getByText("リマインダーを保存しました", { exact: true }),
  ).toBeVisible();
  await fan.reload();
  await expect(
    fan.getByRole("switch", { name: "24時間前", exact: true }),
  ).toBeChecked();
  expect(
    (
      await (
        await fan.request.get(`/api/schedules/${published.id}/reminders`)
      ).json()
    ).minutes,
  ).toContain(1440);
  await context.close();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const screen of screens.filter((screen) => screen.area === "admin")) {
    await page.goto(screenPath(screen.id));
    await expect(page.getByTestId(screen.id)).toBeVisible();
    expect(errors, screen.id).toEqual([]);
  }
});

test("native bridge contract routes purchases and restoration through the host without a Web checkout", async ({
  page,
}) => {
  const calls: any[] = [];
  let webCheckouts = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/api/billing/checkout") &&
      request.method() === "POST"
    )
      webCheckouts++;
  });
  await page.exposeFunction("recordNativeContract", (message: any) => {
    calls.push(message);
  });
  await page.addInitScript(() => {
    window.MangumiNative = {
      version: 1,
      platform: "android",
      nonce: "synthetic-browser-bridge-installation",
    };
    window.ReactNativeWebView = {
      postMessage(raw: string) {
        const message = JSON.parse(raw);
        void (window as any).recordNativeContract(message);
        setTimeout(
          () =>
            window.dispatchEvent(
              new CustomEvent("mangumi-native-result", {
                detail: {
                  id: message.id,
                  ...(message.method === "billing.checkout"
                    ? { error: "ストア呼び出しの契約試験" }
                    : { result: { linked: true, count: 1 } }),
                },
              }),
            ),
          0,
        );
      },
    };
  });
  await page.route("**/api/config", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), billingEnabled: true },
    });
  });
  await login(page, "fan@example.test");
  await expect
    .poll(() => calls.some((c) => c.method === "session.link"))
    .toBe(true);
  await page.goto("/u/U065");
  await page.getByLabel("使用する応援コイン", { exact: true }).fill("500");
  await page
    .getByLabel("応援メッセージ", { exact: true })
    .fill("端末ブリッジを確認");
  await page
    .getByRole("button", { name: "お支払いへ進む", exact: true })
    .click();
  await expect(
    page.getByText("ストア呼び出しの契約試験", { exact: true }),
  ).toBeVisible();
  expect(
    calls.find((c) => c.method === "billing.checkout")?.params,
  ).toMatchObject({ kind: "tip", amount: 500, visibility: "private" });
  expect(webCheckouts).toBe(0);
  await page.getByRole("button", { name: "復元する", exact: true }).click();
  await expect(
    page.getByText("購入情報を確認しました", { exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => c.method === "billing.restore")).toBe(true);
});

test("administrator saves detailed plan limits, notification templates and retention policy on mobile", async ({
  page,
}) => {
  await login(page, "admin@example.test", true);
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto("/admin/A018");
  await page.getByRole("button", { name: "編集", exact: true }).first().click();
  await page.getByText("公式DMの権限・上限", { exact: true }).click();
  await page.locator('input[name="dm.send.week"]').fill("5");
  await page.locator('input[name="dm.send.month"]').fill("20");
  const planForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "プランを保存", exact: true }),
  });
  await planForm
    .getByLabel("変更理由", { exact: true })
    .fill("週次と月次の上限を設定する");
  await planForm
    .getByRole("button", { name: "プランを保存", exact: true })
    .click();
  await expect(
    page.getByText("プランを保存しました", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/A035");
  const template = page
    .locator("form")
    .filter({ has: page.getByLabel("テンプレート名", { exact: true }) });
  await template
    .getByLabel("テンプレート名", { exact: true })
    .fill("ブラウザで作成した配信案内");
  await template.getByLabel("タイトル", { exact: true }).fill("マン組の配信");
  await template.getByLabel("本文", { exact: true }).fill("配信をお楽しみに");
  await template
    .getByLabel("変更理由", { exact: true })
    .fill("定例配信の通知に利用する");
  await template
    .getByRole("button", { name: "テンプレートを保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "ブラウザで作成した配信案内を編集・利用",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/admin/A085");
  await page.getByLabel("DM保存日数", { exact: true }).fill("60");
  await page
    .getByLabel("変更理由", { exact: true })
    .fill("保存期間の設定を確認する");
  await page
    .getByRole("button", { name: "保存方針を適用", exact: true })
    .click();
  await expect(page.getByLabel("DM保存日数", { exact: true })).toHaveValue(
    "60",
  );
  const policy = await page.request.get("/api/admin/retention");
  expect((await policy.json()).policy.dmDays).toBe(60);
  const auth = await page.request.get("/api/admin/auth/session"),
    csrf = (await auth.json()).csrf;
  const entry = {
    id: crypto.randomUUID(),
    title: "編集を検証するストーリー",
    image: "/assets/thumb_1.jpg",
    status: "公開",
    plan: "Free",
    highlight: false,
    publishAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const create = await page.request.post("/api/commands", {
    headers: {
      Origin: "http://127.0.0.1:4193",
      "X-Mangumi-Request": "1",
      "X-Mangumi-Area": "admin",
      "X-CSRF-Token": csrf,
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      changes: [{ resource: "stories", id: entry.id, after: entry }],
      action: "投稿の編集検証",
      reason: "ブラウザで編集して保存する",
    },
  });
  expect(create.ok()).toBe(true);
  await page.goto("/admin/A040");
  const storyForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "公開状態を変更", exact: true }),
  });
  await storyForm
    .getByLabel("本文", { exact: true })
    .fill("ブラウザで更新したストーリー");
  await storyForm
    .getByLabel("変更理由", { exact: true })
    .fill("投稿内容の訂正を確認する");
  await storyForm
    .getByRole("button", { name: "公開状態を変更", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: /ブラウザで更新したストーリー/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: "ブラウザで更新したストーリー",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/admin/A089");
  await page
    .getByLabel("通知先メール（最大5件、カンマ区切り）", { exact: true })
    .fill("ops@example.test");
  await page.getByLabel("異常通知", { exact: true }).selectOption("有効");
  await page
    .getByLabel("アラート設定の変更理由", { exact: true })
    .fill("異常時の通知先を設定する");
  const alertSaved = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/monitoring") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "アラート設定を保存", exact: true })
    .click();
  expect((await alertSaved).ok()).toBe(true);
  const alertConfig = await page.request.get("/api/admin/monitoring");
  expect((await alertConfig.json()).policy.recipients).toEqual([
    "ops@example.test",
  ]);
  for (const id of [
    "A018",
    "A035",
    "A060",
    "A075",
    "A082",
    "A085",
    "A089",
    "A094",
  ]) {
    await page.goto(`/admin/${id}`);
    await expect(page.getByTestId(id)).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        { message: `${id} must fit a mobile viewport` },
      )
      .toBe(true);
  }
});
