import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
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
    const setup = page.getByRole("button", { name: "認証アプリへ登録する" });
    await expect(setup).toBeVisible();
    await setup.click();
    const secret = await page.locator("code").innerText();
    await page.getByLabel("認証コード・復旧コード").fill(totp(secret));
    await page.getByRole("button", { name: "認証する", exact: true }).click();
    await page.getByRole("link", { name: "保存したので管理画面へ" }).click();
    await expect(page.getByTestId("A008")).toBeVisible();
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
  await context.close();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const screen of screens.filter((screen) => screen.area === "admin")) {
    await page.goto(screenPath(screen.id));
    await expect(page.getByTestId(screen.id)).toBeVisible();
    expect(errors, screen.id).toEqual([]);
  }
});
