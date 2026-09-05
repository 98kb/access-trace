import { afterEach, describe, expect, it, vi } from "vitest";

import type { FindingV1 } from "../src/contracts";
import { OverlayController } from "../src/overlay";
import { PERFORMANCE_BUDGETS } from "../src/performance-budgets";

function finding(nodeRef: string, ruleId: string): FindingV1 {
  return {
    findingId: `scan:${ruleId}:${nodeRef}`,
    ruleId,
    status: "violation",
    impact: "serious",
    tags: ["wcag2a"],
    help: "Help",
    helpUrl: "https://example.test/help",
    failureSummary: "Fix this element",
    locator: { segments: [{ type: "css", selector: `#${nodeRef}` }] },
    evidence: `<div id="${nodeRef}">`,
    nodeRef,
  };
}

function rect(left: number, top: number): DOMRect {
  return {
    left,
    top,
    width: 100,
    height: 40,
    right: left + 100,
    bottom: top + 40,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function immediateFrames() {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OverlayController", () => {
  it("draws, selects, updates, hides, reports stale targets, and tears down without mutating targets", () => {
    const first = document.body.appendChild(document.createElement("button"));
    const second = document.body.appendChild(document.createElement("div"));
    first.id = "first";
    second.id = "second";
    const originalFirst = first.outerHTML;
    let left = 10;
    vi.spyOn(first, "getBoundingClientRect").mockImplementation(() =>
      rect(left, 20),
    );
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue(rect(30, 80));
    first.scrollIntoView = vi.fn();
    immediateFrames();
    const elements = new Map<string, Element>([
      ["first", first],
      ["second", second],
    ]);
    const overlay = new OverlayController(document, (nodeRef) =>
      elements.get(nodeRef),
    );

    expect(
      overlay.show([finding("first", "image-alt"), finding("second", "label")]),
    ).toEqual({ rendered: 2, missing: 0, truncated: 0, complete: true });
    const host = document.querySelector<HTMLElement>(
      "[data-accessibility-inspector-overlay]",
    )!;
    expect(host).toHaveAttribute("aria-hidden", "true");
    expect(host.style.pointerEvents).toBe("none");
    expect(host.shadowRoot?.querySelectorAll("[data-box]")).toHaveLength(2);

    expect(overlay.select("first")).toBe(true);
    expect(first.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    });
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }));
    expect(overlay.select("first")).toBe(true);
    expect(first.scrollIntoView).toHaveBeenLastCalledWith({
      behavior: "auto",
      block: "center",
      inline: "nearest",
    });
    expect(
      host.shadowRoot?.querySelector('[data-node-ref="first"]'),
    ).toHaveAttribute("data-selected", "true");

    left = 70;
    window.dispatchEvent(new Event("scroll"));
    expect(
      host.shadowRoot?.querySelector<HTMLElement>('[data-node-ref="first"]')
        ?.style.left,
    ).toBe("70px");

    elements.delete("second");
    expect(
      overlay.show([finding("first", "image-alt"), finding("second", "label")]),
    ).toMatchObject({ rendered: 1, missing: 1, complete: false });
    expect(overlay.select("second")).toBe(false);
    overlay.hide();
    expect(host.hidden).toBe(true);

    overlay.destroy();
    expect(
      document.querySelector("[data-accessibility-inspector-overlay]"),
    ).not.toBeInTheDocument();
    expect(first.outerHTML).toBe(originalFirst);
  });

  it("labels only the selected finding so a dense page stays readable", () => {
    immediateFrames();
    const elements = new Map<string, Element>();
    const findings = Array.from({ length: 12 }, (_, index) => {
      const node = document.body.appendChild(document.createElement("p"));
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        rect(10, index * 12),
      );
      elements.set(`n${index}`, node);
      return finding(`n${index}`, "color-contrast");
    });
    const overlay = new OverlayController(document, (ref) => elements.get(ref));

    overlay.show(findings);
    const shadow = document.querySelector<HTMLElement>(
      "[data-accessibility-inspector-overlay]",
    )!.shadowRoot!;
    expect(shadow.querySelectorAll("[data-box]")).toHaveLength(12);
    expect(shadow.querySelectorAll("[data-label]")).toHaveLength(0);

    overlay.select("n4");
    expect(shadow.querySelectorAll("[data-label]")).toHaveLength(1);
    expect(shadow.querySelector("[data-label]")?.textContent).toBe(
      "Violation · color-contrast",
    );

    overlay.deselect();
    expect(shadow.querySelectorAll("[data-label]")).toHaveLength(0);
    overlay.destroy();
  });

  it("stops adding boxes past the documented bound and reports the truncation", () => {
    immediateFrames();
    const elements = new Map<string, Element>();
    const findings = Array.from({ length: 6 }, (_, index) => {
      const node = document.body.appendChild(document.createElement("p"));
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(rect(0, index));
      elements.set(`b${index}`, node);
      return finding(`b${index}`, "label");
    });
    const overlay = new OverlayController(
      document,
      (ref) => elements.get(ref),
      4,
    );

    expect(overlay.show(findings)).toMatchObject({
      rendered: 4,
      truncated: 2,
      complete: false,
    });
    overlay.destroy();
  });

  it("culls findings far outside the viewport but keeps the selected one", () => {
    immediateFrames();
    const near = document.body.appendChild(document.createElement("p"));
    const far = document.body.appendChild(document.createElement("p"));
    vi.spyOn(near, "getBoundingClientRect").mockReturnValue(rect(10, 10));
    vi.spyOn(far, "getBoundingClientRect").mockReturnValue(rect(10, 90_000));
    const elements = new Map<string, Element>([
      ["near", near],
      ["far", far],
    ]);
    const overlay = new OverlayController(document, (ref) => elements.get(ref));

    expect(
      overlay.show([finding("near", "a"), finding("far", "b")]),
    ).toMatchObject({ rendered: 1, missing: 0 });

    overlay.select("far");
    const shadow = document.querySelector<HTMLElement>(
      "[data-accessibility-inspector-overlay]",
    )!.shadowRoot!;
    expect(shadow.querySelector('[data-node-ref="far"]')).not.toBeNull();
    overlay.destroy();
  });

  it("coalesces bursts of scroll and resize events into one animation frame", () => {
    const node = document.body.appendChild(document.createElement("p"));
    vi.spyOn(node, "getBoundingClientRect").mockReturnValue(rect(0, 0));
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const overlay = new OverlayController(document, () => node);

    overlay.show([finding("only", "label")]);
    callbacks.length = 0;
    for (let index = 0; index < 25; index += 1) {
      window.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
    }
    expect(callbacks).toHaveLength(1);

    callbacks[0]!(0);
    window.dispatchEvent(new Event("scroll"));
    expect(callbacks).toHaveLength(2);
    overlay.destroy();
  });

  it("removes every listener and observer it installed", () => {
    immediateFrames();
    const added: string[] = [];
    const removed: string[] = [];
    const disconnect = vi.fn();
    vi.spyOn(window, "addEventListener").mockImplementation((type) => {
      added.push(String(type));
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((type) => {
      removed.push(String(type));
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    const node = document.body.appendChild(document.createElement("p"));
    const overlay = new OverlayController(document, () => node);

    overlay.show([finding("only", "label")]);
    expect(added).toContain("scroll");
    expect(added).toContain("resize");

    overlay.destroy();
    expect(removed.sort()).toEqual(added.sort());
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("renders a hostile-page-sized finding set inside the documented budget", () => {
    immediateFrames();
    const elements = new Map<string, Element>();
    const findings = Array.from({ length: 300 }, (_, index) => {
      const node = document.body.appendChild(document.createElement("p"));
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        rect(index % 300, index % 500),
      );
      elements.set(`p${index}`, node);
      return finding(`p${index}`, "color-contrast");
    });
    const overlay = new OverlayController(document, (ref) => elements.get(ref));

    const startedFirst = performance.now();
    overlay.show(findings);
    const initial = performance.now() - startedFirst;

    const startedUpdate = performance.now();
    window.dispatchEvent(new Event("scroll"));
    const update = performance.now() - startedUpdate;

    expect(initial).toBeLessThan(PERFORMANCE_BUDGETS.overlayInitialRenderMs);
    expect(update).toBeLessThan(PERFORMANCE_BUDGETS.overlayUpdateMs);
    overlay.destroy();
  });

  it("repositions by reusing pooled boxes rather than rebuilding them", () => {
    immediateFrames();
    const elements = new Map<string, Element>();
    let offset = 0;
    const findings = Array.from({ length: 20 }, (_, index) => {
      const node = document.body.appendChild(document.createElement("p"));
      vi.spyOn(node, "getBoundingClientRect").mockImplementation(() =>
        rect(offset, index),
      );
      elements.set(`r${index}`, node);
      return finding(`r${index}`, "label");
    });
    const overlay = new OverlayController(document, (ref) => elements.get(ref));
    overlay.show(findings);
    const shadow = document.querySelector<HTMLElement>(
      "[data-accessibility-inspector-overlay]",
    )!.shadowRoot!;
    const before = [...shadow.querySelectorAll("[data-box]")];

    offset = 42;
    window.dispatchEvent(new Event("scroll"));

    const after = [...shadow.querySelectorAll("[data-box]")];
    expect(after).toEqual(before);
    expect((after[0] as HTMLElement).style.left).toBe("42px");
    overlay.destroy();
  });
});
