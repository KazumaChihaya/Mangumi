import { test, expect } from "@playwright/test";
import screens from "../../src/screens.json";
import { screenPath } from "../../src/registry";

const base = "/Mangumi";
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) =>
    route.abort(),
  );
});

for (const area of ["member", "admin"]) {
  test(`all ${area} pages and images work under the repository path`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (
        new URL(response.url()).origin === "http://127.0.0.1:4183" &&
        response.status() >= 400
      )
        errors.push(`${response.status()} ${response.url()}`);
    });
    for (const screen of screens.filter((s) => s.area === area)) {
      const response = await page.goto(base + screenPath(screen.id));
      expect(response?.status(), screen.id).toBe(200);
      await expect(page.getByTestId(screen.id), screen.id).toBeVisible();
      await expect
        .poll(
          () =>
            page
              .locator("img")
              .evaluateAll((images) =>
                images.every(
                  (image) =>
                    (image as HTMLImageElement).complete &&
                    (image as HTMLImageElement).naturalWidth > 0,
                ),
              ),
          { message: `${screen.id} images` },
        )
        .toBe(true);
      expect(errors, screen.id).toEqual([]);
    }
  });
}

test("catalog links, client navigation, reloads and decorative assets retain the prefix", async ({
  page,
}) => {
  await page.goto(base + "/screens/");
  const links = await page
    .locator("a[href]")
    .evaluateAll((anchors) =>
      anchors.map((anchor) => anchor.getAttribute("href")),
    );
  expect(links).toHaveLength(206);
  expect(links.every((href) => href?.startsWith(base + "/"))).toBe(true);
  await page.getByRole("link", { name: "アプリへ", exact: true }).click();
  await expect(page.getByTestId("U022")).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(base + "/");
  await page.reload();
  await expect(page.getByTestId("U022")).toBeVisible();
  const frame = await page
    .locator("body")
    .evaluate((body) =>
      getComputedStyle(body).getPropertyValue("--chrome-frame"),
    );
  expect(frame).toContain(base + "/assets/chrome-frame.svg");
  await page.getByRole("link", { name: "全画面", exact: true }).click();
  await page.getByRole("link", { name: "管理画面へ", exact: true }).click();
  await expect(page.getByTestId("A008")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("A008")).toBeVisible();
});

test("PWA uses the repository scope and returns the offline page", async ({
  page,
  context,
  request,
}) => {
  const manifestResponse = await request.get(base + "/manifest.json");
  const manifest = await manifestResponse.json();
  const manifestURL = manifestResponse.url();
  expect(new URL(manifest.start_url, manifestURL).pathname).toBe(base + "/");
  expect(new URL(manifest.scope, manifestURL).pathname).toBe(base + "/");
  await page.goto(base + "/");
  await expect
    .poll(() =>
      page.evaluate(() => navigator.serviceWorker.controller?.scriptURL),
    )
    .toContain(base + "/sw.js");
  const scope = await page.evaluate(
    async () => (await navigator.serviceWorker.ready).scope,
  );
  expect(new URL(scope).pathname).toBe(base + "/");
  await context.setOffline(true);
  await page.goto(base + "/calendar");
  await expect(
    page.getByRole("heading", { name: "ただいまオフラインです" }),
  ).toBeVisible();
});
