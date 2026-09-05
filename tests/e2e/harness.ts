import path from "node:path";

import { chromium, type BrowserContext, type Page } from "@playwright/test";

export const FIXTURE_ORIGIN = "http://127.0.0.1:4173";

export async function launchExtension(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const extensionPath = path.resolve(".output/chrome-mv3-test");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  return { context, extensionId: new URL(worker.url()).host };
}

export async function openPanel(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return panel;
}

/**
 * Clicks a panel control without stealing focus from the inspected tab, which
 * is what the background uses to resolve the active tab.
 */
export async function clickWithoutFocus(page: Page, name: string | RegExp) {
  await page
    .getByRole("button", { name })
    .first()
    .evaluate((button: HTMLButtonElement) => button.click());
}

export async function scanFixture(
  fixture: Page,
  panel: Page,
  url: string,
): Promise<void> {
  await fixture.goto(url);
  await fixture.bringToFront();
  const rescan = panel.getByRole("button", { name: "Rescan", exact: true });
  await clickWithoutFocus(
    panel,
    (await rescan.count()) > 0 ? "Rescan" : "Scan this page",
  );
}
