import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import axe from "axe-core";

import { PERFORMANCE_BUDGETS } from "../../src/performance-budgets";
import {
  clickWithoutFocus,
  FIXTURE_ORIGIN,
  launchExtension,
  openPanel,
  scanFixture,
} from "./harness";

test.describe.configure({ mode: "serial" });

const axeSource = axe.source;

let context: BrowserContext;
let panel: Page;
let fixture: Page;

test.beforeAll(async () => {
  const launched = await launchExtension();
  context = launched.context;
  fixture = await context.newPage();
  await fixture.setViewportSize({ width: 1000, height: 700 });
  await fixture.goto(`${FIXTURE_ORIGIN}/clean.html`);
  panel = await openPanel(context, launched.extensionId);
  await expect(
    panel.getByRole("button", { name: "Scan this page" }),
  ).toBeVisible();
});

test.afterAll(async () => {
  await context.close();
});

const coverage = () => panel.getByRole("region", { name: "Scan coverage" });
const overlayBoxes = (page: Page) =>
  page.locator("[data-accessibility-inspector-overlay]").locator("[data-box]");

test("reports an accessible frame as scanned and a cross-origin frame as skipped", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/frames.html`);

  await expect(coverage()).toContainText("Scanned the top document and 1 of 2");
  await expect(coverage()).toContainText(
    "1 frame was skipped because it is cross-origin",
  );
  await expect(coverage()).toContainText(
    "Closed shadow roots cannot be detected",
  );

  const frameFinding = panel.getByRole("button", { name: /^label\b/i }).first();
  await expect(frameFinding).toContainText(
    "In frame: http://127.0.0.1:4173/frame-child.html",
  );

  await fixture.bringToFront();
  await frameFinding.evaluate((button: HTMLButtonElement) => button.click());

  const child = fixture.frameLocator("#same-origin");
  await expect(
    child.locator(
      '[data-accessibility-inspector-overlay] [data-selected="true"]',
    ),
  ).toHaveCount(1);
  // The highlight belongs to the owning frame, not the top document.
  await expect(
    fixture.locator(
      '[data-accessibility-inspector-overlay] [data-selected="true"]',
    ),
  ).toHaveCount(0);
});

test("finds and highlights a target inside an open shadow root", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/shadow.html`);

  const shadowFinding = panel
    .getByRole("button", { name: /^image-alt/i })
    .first();
  await expect(shadowFinding).toBeVisible();
  await fixture.bringToFront();
  await shadowFinding.evaluate((button: HTMLButtonElement) => button.click());

  const box = fixture.locator(
    '[data-accessibility-inspector-overlay] [data-selected="true"]',
  );
  await expect(box).toHaveCount(1);
  const target = await fixture.evaluate(() => {
    const root = document.getElementById("open-host")!.shadowRoot!;
    const rect = root
      .getElementById("shadow-missing-alt")!
      .getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  const drawn = await box.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  expect(Math.abs(drawn.left - target.left)).toBeLessThan(4);
  expect(Math.abs(drawn.top - target.top)).toBeLessThan(4);

  // Nothing inside the closed root may be claimed as a finding.
  expect(await panel.locator(".finding").allTextContents()).not.toContain(
    "closed-missing-alt",
  );
});

test("keeps overlay geometry correct on a long page and inside nested containers", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/long.html`);
  await fixture.bringToFront();
  await clickWithoutFocus(panel, /^image-alt/i);

  await expect
    .poll(() => fixture.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect(
    fixture.locator(
      '[data-accessibility-inspector-overlay] [data-selected="true"]',
    ),
  ).toHaveCount(1);

  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/containers.html`);
  await fixture.bringToFront();
  await clickWithoutFocus(panel, "Show overlay");
  await expect(overlayBoxes(fixture).first()).toBeVisible();

  const aligned = await fixture.evaluate(() => {
    const host = document.querySelector(
      "[data-accessibility-inspector-overlay]",
    )!;
    const box = [...host.shadowRoot!.querySelectorAll("[data-box]")].find(
      (candidate) => (candidate as HTMLElement).offsetWidth > 0,
    ) as HTMLElement | undefined;
    if (!box) return null;
    const drawn = box.getBoundingClientRect();
    const targets = [
      "#sticky-missing-alt",
      "#nested-missing-alt",
      "#fixed-missing-alt",
    ]
      .map((selector) =>
        document.querySelector(selector)!.getBoundingClientRect(),
      )
      .map(
        (rect) =>
          Math.abs(rect.left - drawn.left) + Math.abs(rect.top - drawn.top),
      );
    return Math.min(...targets);
  });
  expect(aligned).not.toBeNull();
  expect(aligned!).toBeLessThan(4);
});

test("survives a hostile global reset without blocking the page", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/hostile.html`);
  await fixture.bringToFront();
  await clickWithoutFocus(panel, "Show overlay");
  await expect(overlayBoxes(fixture).first()).toBeAttached();

  const geometry = await fixture.evaluate(() => {
    const host = document.querySelector(
      "[data-accessibility-inspector-overlay]",
    )!;
    const boxes = [
      ...host.shadowRoot!.querySelectorAll("[data-box]"),
    ] as HTMLElement[];
    const target = document
      .getElementById("hostile-missing-alt")!
      .getBoundingClientRect();
    const closest = boxes
      .map((box) => ({ box, rect: box.getBoundingClientRect() }))
      .sort(
        (a, b) =>
          Math.abs(a.rect.left - target.left) +
          Math.abs(a.rect.top - target.top) -
          (Math.abs(b.rect.left - target.left) +
            Math.abs(b.rect.top - target.top)),
      )[0]!;
    return {
      delta:
        Math.abs(closest.rect.left - target.left) +
        Math.abs(closest.rect.top - target.top),
      width: closest.rect.width,
      pointerEvents: getComputedStyle(closest.box).pointerEvents,
      hostPointerEvents: getComputedStyle(host).pointerEvents,
      elementAtTarget: document.elementFromPoint(
        target.left + target.width / 2,
        target.top + target.height / 2,
      )?.id,
      overflows:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });

  expect(geometry.delta).toBeLessThan(4);
  expect(geometry.width).toBeGreaterThan(0);
  expect(geometry.pointerEvents).toBe("none");
  expect(geometry.hostPointerEvents).toBe("none");
  expect(geometry.elementAtTarget).toBe("hostile-missing-alt");
  expect(geometry.overflows).toBe(false);
});

test("bounds labels and boxes on a page with many findings", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/dense.html`);
  await fixture.bringToFront();
  await clickWithoutFocus(panel, "Show overlay");
  await expect(overlayBoxes(fixture).first()).toBeVisible();

  const counts = await fixture.evaluate(() => {
    const shadow = document.querySelector(
      "[data-accessibility-inspector-overlay]",
    )!.shadowRoot!;
    return {
      boxes: shadow.querySelectorAll("[data-box]").length,
      labels: shadow.querySelectorAll("[data-label]").length,
    };
  });
  expect(counts.boxes).toBeGreaterThan(1);
  expect(counts.labels).toBe(0);

  await clickWithoutFocus(panel, /^image-alt/i);
  await expect
    .poll(() =>
      fixture.evaluate(
        () =>
          document
            .querySelector("[data-accessibility-inspector-overlay]")!
            .shadowRoot!.querySelectorAll("[data-label]").length,
      ),
    )
    .toBe(1);
});

test("marks findings stale after a same-document route change", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/spa.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();

  await fixture.bringToFront();
  await fixture.locator("#navigate").click();

  await expect(
    panel.getByRole("heading", { name: "These findings are out of date" }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    panel.getByRole("button", { name: /^image-alt/i }).first(),
  ).toBeDisabled();
  await expect(
    fixture.locator("[data-accessibility-inspector-overlay] [data-box]"),
  ).toHaveCount(0);
});

test("refuses to highlight a look-alike element that replaced the scanned one", async () => {
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/mutation.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();

  await fixture.bringToFront();
  await fixture.locator("#replace").click();
  await clickWithoutFocus(panel, /^image-alt/i);

  await expect(
    fixture.locator(
      '[data-accessibility-inspector-overlay] [data-selected="true"]',
    ),
  ).toHaveCount(0);
  await expect(panel.getByRole("alert").first()).toContainText(/changed|date/i);
});

test("clears session state when the inspected tab closes", async () => {
  const throwaway = await context.newPage();
  await throwaway.goto(`${FIXTURE_ORIGIN}/violations.html`);
  await throwaway.bringToFront();
  await clickWithoutFocus(panel, /^(Rescan|Scan this page)$/);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();

  const tabStateKeys = () =>
    panel.evaluate(async () => {
      const stored = await chrome.storage.session.get(null);
      return Object.keys(stored).filter((key) => key.startsWith("tab-state:"));
    });
  const before = await tabStateKeys();
  expect(before.length).toBeGreaterThan(0);

  await throwaway.close();

  await expect
    .poll(async () => (await tabStateKeys()).length, { timeout: 10_000 })
    .toBe(before.length - 1);
});

test("scans a fixture inside the documented budget and without network egress", async () => {
  const requests: string[] = [];
  const record = (url: string) => {
    if (
      !url.startsWith(FIXTURE_ORIGIN) &&
      !url.startsWith("chrome-extension://")
    )
      requests.push(url);
  };
  fixture.on("request", (request) => record(request.url()));
  panel.on("request", (request) => record(request.url()));

  const started = Date.now();
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/dense.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();
  const elapsed = Date.now() - started;

  expect(elapsed).toBeLessThan(PERFORMANCE_BUDGETS.fixtureScanMs);
  expect(requests).toEqual([]);
});

test("meets contrast and keeps motion optional across panel states", async () => {
  await panel.addInitScript(axeSource);
  const runAxe = () =>
    panel.evaluate(async () => {
      const results = await (
        window as unknown as { axe: typeof import("axe-core") }
      ).axe.run(document);
      return {
        violations: results.violations.map((violation) => violation.id),
        // Proves the contrast rule actually ran rather than being skipped.
        contrastEvaluated: [...results.passes, ...results.incomplete].some(
          (result) => result.id === "color-contrast",
        ),
      };
    });

  // Idle state, before any scan.
  const idle = await context.newPage();
  await idle.setViewportSize({ width: 400, height: 900 });
  await idle.goto(panel.url());
  await idle.evaluate(axeSource);
  expect(
    await idle.evaluate(async () =>
      (
        await (window as unknown as { axe: typeof import("axe-core") }).axe.run(
          document,
        )
      ).violations.map((violation) => violation.id),
    ),
  ).toEqual([]);
  await idle.close();

  // Populated results, including every severity chip and the coverage notice.
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/frames.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();
  await panel.evaluate(axeSource);
  expect(await runAxe()).toEqual({ violations: [], contrastEvaluated: true });

  // Stale state: every finding control is disabled and must stay readable.
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/spa.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();
  await fixture.bringToFront();
  await fixture.locator("#navigate").click();
  await expect(
    panel.getByRole("heading", { name: "These findings are out of date" }),
  ).toBeVisible({ timeout: 10_000 });
  await panel.evaluate(axeSource);
  expect(await runAxe()).toEqual({ violations: [], contrastEvaluated: true });

  // Clean state.
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/clean.html`);
  await expect(
    panel.getByRole("heading", {
      name: "No findings detected in scanned content",
    }),
  ).toBeVisible();
  await panel.evaluate(axeSource);
  expect(await runAxe()).toEqual({ violations: [], contrastEvaluated: true });
});

test("honours reduced motion in the panel and the overlay", async () => {
  await panel.emulateMedia({ reducedMotion: "reduce" });
  await fixture.emulateMedia({ reducedMotion: "reduce" });
  await scanFixture(fixture, panel, `${FIXTURE_ORIGIN}/violations.html`);
  await expect(
    panel.getByRole("heading", { name: "Findings", exact: true }),
  ).toBeVisible();

  await fixture.bringToFront();
  await clickWithoutFocus(panel, /^image-alt/i);
  await expect(
    fixture.locator(
      '[data-accessibility-inspector-overlay] [data-selected="true"]',
    ),
  ).toHaveCount(1);

  expect(
    await fixture.evaluate(() => {
      const box = document
        .querySelector("[data-accessibility-inspector-overlay]")!
        .shadowRoot!.querySelector('[data-selected="true"]')!;
      return getComputedStyle(box).animationName;
    }),
  ).toBe("none");
  expect(
    await panel.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);

  await panel.emulateMedia({ reducedMotion: null });
  await fixture.emulateMedia({ reducedMotion: null });
});

test("keeps coherent state when the tab closes mid-scan", async () => {
  const throwaway = await context.newPage();
  await throwaway.goto(`${FIXTURE_ORIGIN}/dense.html`);
  await throwaway.bringToFront();

  // Issue the scan and close the tab without waiting for it to finish.
  const scan = panel.evaluate(() =>
    chrome.runtime.sendMessage({
      schemaVersion: "1.0",
      type: "scan-request",
    }),
  );
  await throwaway.close();
  const outcome = (await scan) as { ok: boolean; error?: { code: string } };

  expect(outcome.ok).toBe(false);
  await expect
    .poll(async () =>
      panel.evaluate(async () => {
        const stored = await chrome.storage.session.get(null);
        return Object.keys(stored).filter((key) => key.startsWith("tab-state:"))
          .length;
      }),
    )
    .toBeLessThanOrEqual(1);
});
