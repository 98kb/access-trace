import path from "node:path";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";

import axe from "axe-core";
import { chromium, expect, test } from "@playwright/test";

test("a known finding crosses the extension boundary and maps to its live element", async () => {
  await mkdir(".impeccable/review", { recursive: true });
  const providerRequests: string[] = [];
  const provider = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-headers", "content-type");
    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (request.method === "GET" && request.url === "/api/tags") {
      response.end(JSON.stringify({ models: [{ name: "fake-local" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/chat") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        providerRequests.push(body);
        response.end(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                schemaVersion: "1.0",
                summary: "The image needs a text alternative.",
                rationale:
                  "The deterministic image-alt finding has no accessible name.",
                remediationOptions: [
                  "Add concise alt text or mark the image decorative.",
                ],
                manualChecks: [
                  "Confirm whether the image communicates information.",
                ],
                confidence: 0.91,
                advisoryStatus: "advisory",
              }),
            },
          }),
        );
      });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(0, "127.0.0.1", resolve);
  });
  const address = provider.address();
  if (!address || typeof address === "string") throw new Error("No fake port");
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

    const imageFinding = panel.getByRole("button", {
      name: /^image-alt critical/i,
    });
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

    await panel.bringToFront();
    await panel.screenshot({
      path: ".impeccable/review/sidepanel-400.png",
      fullPage: true,
    });
    await fixture.bringToFront();
    await fixture.screenshot({ path: ".impeccable/review/overlay.png" });
    await panel.bringToFront();
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
    await panel.setViewportSize({ width: 400, height: 900 });
    await panel.locator(".assistant-settings summary").click();

    await panel.getByRole("checkbox", { name: "Enable local AI" }).check();
    await expect(
      panel.getByText("Local AI is enabled; connection not tested"),
    ).toBeVisible();
    await panel.getByRole("textbox", { name: "Model name" }).fill("fake-local");
    await panel
      .getByRole("spinbutton", { name: "Port" })
      .fill(String(address.port));
    expect(
      await panel.evaluate(async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/tags`);
        return response.status;
      }, address.port),
    ).toBe(200);
    await panel.getByRole("button", { name: "Test connection" }).click();
    await expect
      .poll(() =>
        panel.evaluate(async () => {
          const stored = await chrome.storage.local.get(
            "assistant-settings:v1",
          );
          return stored["assistant-settings:v1"]?.port;
        }),
      )
      .toBe(address.port);
    await expect(panel.locator(".assistant-settings")).toContainText(
      "Local provider available",
    );
    await panel.bringToFront();
    await panel.locator(".assistant-settings").screenshot({
      path: ".impeccable/review/local-ai-settings.png",
    });
    await fixture.bringToFront();
    await panel
      .getByRole("button", { name: "Explain image-alt with local AI" })
      .click();
    await expect(
      panel.getByRole("heading", { name: "Evidence preview" }),
    ).toBeVisible();
    expect(providerRequests).toHaveLength(0);
    await panel.bringToFront();
    await panel.locator(".evidence-preview").screenshot({
      path: ".impeccable/review/local-ai-evidence-preview.png",
    });
    await fixture.bringToFront();
    await panel
      .getByRole("button", { name: "Send displayed evidence" })
      .click();
    await expect(
      panel.getByRole("heading", { name: "AI advisory" }),
    ).toBeVisible();
    await expect(
      panel.getByText("The image needs a text alternative."),
    ).toBeVisible();
    expect(providerRequests).toHaveLength(1);
    const providerBody = JSON.parse(providerRequests[0]!);
    const sentEvidence = providerBody.messages[1].content as string;
    expect(sentEvidence).toContain("BEGIN_UNTRUSTED_EVIDENCE");
    expect(sentEvidence).toContain('"screenshotIncluded":false');
    expect(sentEvidence).not.toContain("data:image/svg+xml");
    await panel.bringToFront();
    await panel.locator(".assistant-advisory").screenshot({
      path: ".impeccable/review/local-ai-advisory.png",
    });
    await panel.getByRole("button", { name: "Dismiss advisory" }).click();

    await fixture
      .locator("#missing-alt")
      .evaluate((element) => element.remove());
    await fixture.bringToFront();
    await panel
      .getByRole("button", { name: "Explain image-alt with local AI" })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      "The page changed. Rescan before explaining this finding.",
    );

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
    provider.closeAllConnections();
    provider.close();
    await context.close();
  }
});
