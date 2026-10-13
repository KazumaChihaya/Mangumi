import { test, expect } from "@playwright/test";
import screens from "../../src/screens.json";
import { screenPath } from "../../src/registry";
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) =>
    route.abort(),
  );
});
for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 320, height: 844 },
]) {
  for (const area of ["member", "admin"])
    test(`every ${area} screen renders at ${viewport.name} width`, async ({
      page,
    }) => {
      test.setTimeout(240000);
      await page.setViewportSize(viewport);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      for (const screen of screens.filter((s) => s.area === area)) {
        const response = await page.goto(screenPath(screen.id), {
          waitUntil: "domcontentloaded",
        });
        expect(response?.status(), screen.id).toBe(200);
        await expect(page.getByTestId(screen.id), screen.id).toBeVisible();
        const width = await page.evaluate(() => ({
          doc: document.documentElement.scrollWidth,
          window: innerWidth,
        }));
        expect(
          width.doc,
          `${screen.id} horizontal overflow`,
        ).toBeLessThanOrEqual(width.window + 1);
        expect(errors, `${screen.id} browser errors`).toEqual([]);
      }
    });
}
test("calendar created by administrator appears in the member application", async ({
  page,
}) => {
  await page.goto("/admin/A027");
  await page.getByLabel("配信タイトル").fill("テスト配信・みんなでマン組");
  await page.getByLabel("配信日（日本時間）").fill("2026-10-20");
  await page.getByLabel("公開状態", { exact: true }).selectOption("公開");
  await page.getByRole("button", { name: "保存する" }).click();
  await page.goto("/u/U031");
  await expect(
    page.getByText("テスト配信・みんなでマン組", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin/A094");
  await expect(page.getByText("配信予定作成", { exact: true })).toBeVisible();
});
test("DM sending, blocking, reporting and support share state with management", async ({
  page,
}) => {
  await page.goto("/u/U056");
  await page
    .getByLabel("メッセージ", { exact: true })
    .fill("マン組の配信、楽しみ！");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    page.getByText("マン組の配信、楽しみ！", { exact: true }),
  ).toBeVisible();
  await page.goto("/u/U057");
  await page.getByLabel("詳しい内容").fill("プレビューの通報を確認");
  await page.getByRole("button", { name: "通報を送信" }).click();
  await expect(
    page.getByText("通報を受け付けました", { exact: true }).first(),
  ).toBeVisible();
  await page.goto("/admin/A052");
  await expect(
    page.getByText("不適切な発言：プレビューの通報を確認", { exact: true }),
  ).toBeVisible();
  await page.goto("/u/U057");
  await page.getByRole("button", { name: "この相手をブロック" }).click();
  await page.goto("/u/U056");
  await expect(
    page.getByText("ブロック中のため送信できません。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("メッセージ", { exact: true })).toHaveCount(0);
});
test("gacha consumes tickets once, rejects invalid probabilities and preserves probability history", async ({
  page,
}) => {
  await page.goto("/gacha");
  await page.getByRole("button", { name: "5回引く · 5枚" }).click();
  const confirm = page.getByRole("button", { name: "確認して引く" });
  await confirm.dblclick();
  await expect(page.getByTestId("U083")).toBeVisible();
  await page.goto("/gacha");
  await expect(
    page.getByRole("button", { name: "1回引く · 1枚" }),
  ).toBeDisabled();
  await page.goto("/admin/A071");
  await expect(page.locator("tbody tr")).toHaveCount(5);
  await page.goto("/admin/A070");
  await page.getByLabel("SSR / まんぞうスペシャルボイス（%）").fill("4");
  await page.getByRole("button", { name: "新バージョンとして保存" }).click();
  await expect(
    page.getByText("提供割合の合計を厳密に100%にしてください"),
  ).toBeVisible();
  await page.getByLabel("SSR / まんぞうスペシャルボイス（%）").fill("5");
  await page.getByRole("button", { name: "新バージョンとして保存" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.goto("/admin/A071");
  await expect(page.getByText("preview-v1", { exact: true })).toHaveCount(5);
});
test("sound is opt in and reduced animation preference persists", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "効果音をON" })).toBeVisible();
  await page.getByRole("button", { name: "効果音をON" }).click();
  await expect(page.getByRole("button", { name: "効果音をOFF" })).toBeVisible();
  await page.getByRole("button", { name: "演出ON" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});
test("capture member and administrator preview screenshots", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 460, height: 1000 });
  await page.goto("/");
  await expect(page.getByTestId("U022")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("member-home.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto("/gacha");
  await page.screenshot({
    path: testInfo.outputPath("member-gacha.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/admin");
  await expect(page.getByTestId("A008")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("admin-dashboard.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/A011");
  await page.screenshot({
    path: testInfo.outputPath("admin-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});
