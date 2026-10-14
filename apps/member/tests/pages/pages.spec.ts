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
  await page.setViewportSize({ width: 460, height: 920 });
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
  expect(frame).toContain(base + "/assets/cabinet-bezel-v2.png");
  await page.screenshot({
    path: "../../.local/preview/jackpot-home.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("link", { name: "全画面", exact: true }).click();
  await page.getByRole("link", { name: "管理画面へ", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("A008")).toBeVisible();
  await page.screenshot({
    path: "../../.local/preview/jackpot-admin.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "../../.local/preview/jackpot-admin-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(page.getByTestId("A008")).toBeVisible();
  await page.goto(base + "/gacha/");
  await expect(page.getByTestId("U076")).toBeVisible();
  await page.screenshot({
    path: "../../.local/preview/jackpot-gacha.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.reload();
  await expect(page.getByTestId("U076")).toBeVisible();
});

test("cabinet ornaments keep their shape in square, wide and tall frames", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto(base + "/");
  await expect(page.getByTestId("U022")).toBeVisible();
  await page.evaluate(async () => {
    const source = getComputedStyle(document.body)
      .getPropertyValue("--chrome-frame")
      .match(/url\(["']?([^"')]+)/)?.[1];
    const image = new Image();
    image.src = source!;
    await image.decode();
    if (image.naturalWidth !== image.naturalHeight)
      throw new Error("The cabinet texture must remain square");
  });
  for (const className of [
    "member-app",
    "panel",
    "broadcast-billboard",
    "slot-machine",
    "bottom-nav",
    "admin-main",
    "catalog-card",
  ]) {
    const cornerSize = await page.evaluate((name) => {
      const probe = document.createElement("div");
      probe.id = "frame-proportion-probe";
      probe.className = name;
      // Enlarge uniformly for pixel sampling. Keep the real shared frame rules.
      Object.assign(probe.style, {
        position: "fixed",
        inset: "auto",
        top: "0px",
        left: "0px",
        margin: "0px",
        padding: "0px",
        width: "480px",
        height: "480px",
        minWidth: "0px",
        minHeight: "0px",
        maxWidth: "none",
        maxHeight: "none",
        borderWidth: "60px",
        background: "black",
        boxShadow: "none",
        transform: "none",
        zIndex: "99999",
      });
      document.body.append(probe);
      return 60 * Number(getComputedStyle(probe).borderImageWidth);
    }, className);
    expect(cornerSize, className).toBeGreaterThan(0);
    const reference: Buffer[] = [];
    for (const [width, height] of [
      [480, 480],
      [720, 360],
      [360, 720],
    ]) {
      await page.locator("#frame-proportion-probe").evaluate(
        (probe, size) => {
          Object.assign((probe as HTMLElement).style, {
            width: `${size.width}px`,
            height: `${size.height}px`,
          });
        },
        { width, height },
      );
      const patches = [
        { x: 0, y: 0, width: cornerSize, height: cornerSize },
        { x: width / 2 - 40, y: 0, width: 80, height: cornerSize },
        { x: 0, y: height / 2 - 40, width: cornerSize, height: 80 },
      ];
      for (const [index, clip] of patches.entries()) {
        const pixels = await page.screenshot({ clip, animations: "disabled" });
        if (reference[index]) {
          const difference = pixels.equals(reference[index])
            ? { maximum: 0, mean: 0 }
            : await page.evaluate(
                async (sources) => {
                  const pixels = await Promise.all(
                    sources.map(async (source) => {
                      const image = new Image();
                      image.src = `data:image/png;base64,${source}`;
                      await image.decode();
                      const canvas = document.createElement("canvas");
                      canvas.width = image.naturalWidth;
                      canvas.height = image.naturalHeight;
                      const context = canvas.getContext("2d")!;
                      context.drawImage(image, 0, 0);
                      return context.getImageData(
                        0,
                        0,
                        canvas.width,
                        canvas.height,
                      ).data;
                    }),
                  );
                  let maximum = 0;
                  let total = 0;
                  for (let channel = 0; channel < pixels[0].length; channel++) {
                    const difference = Math.abs(
                      pixels[0][channel] - pixels[1][channel],
                    );
                    maximum = Math.max(maximum, difference);
                    total += difference;
                  }
                  return { maximum, mean: total / pixels[0].length };
                },
                [
                  reference[index].toString("base64"),
                  pixels.toString("base64"),
                ],
              );
          // GPU sampling can round isolated color channels by one unit.
          if (difference.maximum > 2 || difference.mean > 0.02) {
            await testInfo.attach(`${className}-square-${index}`, {
              body: reference[index],
              contentType: "image/png",
            });
            await testInfo.attach(`${className}-${width}x${height}-${index}`, {
              body: pixels,
              contentType: "image/png",
            });
          }
          const label = `${className} ${width}×${height}, ornament ${index}`;
          expect(difference.maximum, label).toBeLessThanOrEqual(2);
          expect(difference.mean, label).toBeLessThanOrEqual(0.02);
        } else reference[index] = pixels;
      }
    }
    await page
      .locator("#frame-proportion-probe")
      .evaluate((probe) => probe.remove());
  }
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
