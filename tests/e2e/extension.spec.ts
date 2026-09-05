import path from "node:path";
import { mkdir } from "node:fs/promises";

import axe from "axe-core";
import { chromium, expect, test } from "@playwright/test";

test("a known finding crosses the extension boundary and maps to its live element", async () => {
  await mkdir(".impeccable/review", { recursive: true });
  const extensionPath = path.resolve(".output/chrome-mv3-test");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const fixture = await context.newPage();
    await fixture.setViewportSize({ width: 1000, height: 700 });
    await fixture.goto("http://127.0.0.1:4173/violations.html");
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const targetBefore = await fixture
      .locator("#missing-alt")
      .evaluate((element) => element.outerHTML);

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 400, height: 900 });
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await expect(
      panel.getByRole("button", { name: "Scan this page" }),
    ).toBeVisible();
    await fixture.bringToFront();
    await panel
      .getByRole("button", { name: "Scan this page" })
      .evaluate((button: HTMLButtonElement) => button.click());

    const imageFinding = panel.getByRole("button", { name: /image-alt/i });
    await expect(panel.locator("body")).toContainText("image-alt", {
      timeout: 10_000,
    });
    await expect(imageFinding).toBeVisible();
    await expect(
      panel.getByRole("button", { name: /^label\b/i }),
    ).toBeVisible();
    await imageFinding.evaluate((button: HTMLButtonElement) => button.click());

    await expect(
      fixture.locator("[data-accessibility-inspector-overlay]"),
    ).toBeAttached();
    await expect(
      fixture.locator(
        '[data-accessibility-inspector-overlay] [data-selected="true"]',
      ),
    ).toHaveCount(1);
    await expect
      .poll(() => fixture.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    expect(
      await fixture
        .locator("#missing-alt")
        .evaluate((element) => element.outerHTML),
    ).toBe(targetBefore);

    await panel.screenshot({
      path: ".impeccable/review/sidepanel-400.png",
      fullPage: true,
    });
    await fixture.screenshot({ path: ".impeccable/review/overlay.png" });
    await panel.setViewportSize({ width: 280, height: 900 });
    expect(
      await panel.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await panel.screenshot({
      path: ".impeccable/review/sidepanel-280.png",
      fullPage: true,
    });

    await panel.evaluate(axe.source);
    const accessibility = await panel.evaluate(async () =>
      (window as typeof window & { axe: typeof axe }).axe.run(document),
    );
    expect(accessibility.violations).toEqual([]);

    await fixture.goto("http://127.0.0.1:4173/clean.html");
    await fixture.bringToFront();
    await panel
      .getByRole("button", { name: "Rescan" })
      .evaluate((button: HTMLButtonElement) => button.click());
    await expect(
      panel.getByRole("heading", { name: "No automated findings" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
