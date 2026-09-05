import { describe, expect, it, vi } from "vitest";

import type { FindingV1 } from "../src/contracts";
import { OverlayController } from "../src/overlay";

function finding(nodeRef: string, ruleId: string): FindingV1 {
  return {
    findingId: `scan:${ruleId}`,
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

describe("OverlayController", () => {
  it("draws, selects, updates, hides, reports stale targets, and tears down without mutating targets", () => {
    const first = document.body.appendChild(document.createElement("button"));
    const second = document.body.appendChild(document.createElement("div"));
    first.id = "first";
    second.id = "second";
    const originalFirst = first.outerHTML;
    let left = 10;
    vi.spyOn(first, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          left,
          top: 20,
          width: 100,
          height: 40,
          right: left + 100,
          bottom: 60,
          x: left,
          y: 20,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    vi.spyOn(second, "getBoundingClientRect").mockReturnValue({
      left: 30,
      top: 80,
      width: 120,
      height: 50,
      right: 150,
      bottom: 130,
      x: 30,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);
    first.scrollIntoView = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const elements = new Map<string, Element>([
      ["first", first],
      ["second", second],
    ]);
    const overlay = new OverlayController(document, (nodeRef) =>
      elements.get(nodeRef),
    );

    expect(
      overlay.show([finding("first", "image-alt"), finding("second", "label")]),
    ).toBe(true);
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
    ).toBe(false);
    expect(overlay.select("second")).toBe(false);
    overlay.hide();
    expect(host.hidden).toBe(true);

    overlay.destroy();
    expect(
      document.querySelector("[data-accessibility-inspector-overlay]"),
    ).not.toBeInTheDocument();
    expect(first.outerHTML).toBe(originalFirst);
  });
});
