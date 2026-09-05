import type { FindingV1 } from "./contracts";
import { PERFORMANCE_BUDGETS } from "./performance-budgets";

type ResolveElement = (nodeRef: string) => Element | undefined;

/**
 * Boxes are cheap; permanent text labels are not. Only the selected finding
 * gets a label, and off-screen boxes are culled, so a long page with many
 * findings still costs a bounded amount of work per frame.
 */
export const OVERLAY_MAX_BOXES = PERFORMANCE_BUDGETS.overlayMaxBoxes;
const CULL_MARGIN_PX = 200;

export type OverlayRender = {
  rendered: number;
  missing: number;
  truncated: number;
  complete: boolean;
};

const hostStyle = [
  "all: initial",
  "position: fixed",
  "top: 0",
  "left: 0",
  "width: 100%",
  "height: 100%",
  "margin: 0",
  "padding: 0",
  "border: 0",
  "display: block",
  "overflow: visible",
  "contain: layout style",
  "z-index: 2147483647",
  "pointer-events: none",
  "visibility: visible",
  "opacity: 1",
  "transform: none",
  "filter: none",
  "clip-path: none",
]
  .map((declaration) => `${declaration} !important`)
  .join("; ");

const shadowStyle = `
  :host { all: initial; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  [data-box] {
    position: fixed;
    box-sizing: border-box;
    border: 3px solid #d946ef;
    background: rgb(217 70 239 / 12%);
    pointer-events: none;
    user-select: none;
    contain: layout style;
  }
  [data-box][data-status="needs-review"] { border-style: dashed; }
  [data-box][data-selected="true"] {
    border-color: #7c3aed;
    border-width: 5px;
    background: rgb(124 58 237 / 14%);
    outline: 2px solid #fff;
    animation: emphasize 650ms cubic-bezier(.22, 1, .36, 1) 2 alternate;
  }
  [data-label] {
    position: absolute;
    top: -24px;
    left: -3px;
    max-width: 240px;
    overflow: hidden;
    padding: 3px 6px;
    border-radius: 3px;
    background: #111827;
    color: #fff;
    font: 600 12px/18px ui-monospace, monospace;
    white-space: nowrap;
    text-overflow: ellipsis;
    pointer-events: none;
  }
  @keyframes emphasize { to { border-color: #facc15; transform: scale(1.015); } }
  @media (prefers-reduced-motion: reduce) {
    [data-box][data-selected="true"] { animation: none; }
  }
`;

type Measurement = {
  nodeRef: string;
  status: FindingV1["status"];
  ruleId: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export class OverlayController {
  private host?: HTMLElement;
  private shadow?: ShadowRoot;
  private findings: FindingV1[] = [];
  private selected?: string;
  private boxes = new Map<string, HTMLElement>();
  private frame?: number;
  private pending = false;
  private teardown: Array<() => void> = [];

  constructor(
    private readonly page: Document,
    private readonly resolve: ResolveElement,
    private readonly maxBoxes: number = OVERLAY_MAX_BOXES,
  ) {}

  show(findings: FindingV1[]): OverlayRender {
    this.findings = findings;
    this.ensureRoot();
    this.host!.hidden = false;
    return this.render();
  }

  hide(): void {
    if (this.host) this.host.hidden = true;
  }

  select(nodeRef: string): boolean {
    const element = this.resolve(nodeRef);
    if (!element?.isConnected) return false;
    this.selected = nodeRef;
    if (typeof element.scrollIntoView === "function")
      element.scrollIntoView({
        behavior: this.reducedMotion() ? "auto" : "smooth",
        block: "center",
        inline: "nearest",
      });
    this.render();
    return true;
  }

  deselect(): void {
    if (this.selected === undefined) return;
    this.selected = undefined;
    if (this.host) this.render();
  }

  destroy(): void {
    for (const off of this.teardown.splice(0)) off();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.pending = false;
    this.boxes.clear();
    this.host?.remove();
    this.host = undefined;
    this.shadow = undefined;
    this.findings = [];
    this.selected = undefined;
  }

  private reducedMotion(): boolean {
    return (
      this.page.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)")
        .matches === true
    );
  }

  private listen(
    target: EventTarget | undefined,
    type: string,
    options?: AddEventListenerOptions,
  ): void {
    if (!target) return;
    target.addEventListener(type, this.schedule, options);
    this.teardown.push(() =>
      target.removeEventListener(type, this.schedule, options),
    );
  }

  private ensureRoot(): void {
    if (this.host) return;
    const host = this.page.createElement("div");
    host.dataset.accessibilityInspectorOverlay = "";
    host.setAttribute("aria-hidden", "true");
    host.setAttribute("role", "presentation");
    host.style.cssText = hostStyle;
    const shadow = host.attachShadow({ mode: "open" });
    const style = this.page.createElement("style");
    style.textContent = shadowStyle;
    shadow.append(style);
    this.page.documentElement.append(host);
    this.host = host;
    this.shadow = shadow;

    const view = this.page.defaultView ?? undefined;
    this.listen(view, "scroll", { capture: true, passive: true });
    this.listen(view, "resize", { passive: true });
    this.listen(view?.visualViewport ?? undefined, "resize", { passive: true });
    this.listen(view?.visualViewport ?? undefined, "scroll", { passive: true });
    if (view && typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(this.schedule);
      observer.observe(this.page.documentElement);
      this.teardown.push(() => observer.disconnect());
    }
  }

  private readonly schedule = (): void => {
    if (this.pending) return;
    this.pending = true;
    this.frame = requestAnimationFrame(() => {
      this.pending = false;
      this.frame = undefined;
      if (this.host) this.render();
    });
  };

  /** Measures every target before touching the DOM, then writes once. */
  private render(): OverlayRender {
    const shadow = this.shadow;
    if (!shadow)
      return { rendered: 0, missing: 0, truncated: 0, complete: false };

    const view = this.page.defaultView;
    const viewportWidth = view?.innerWidth ?? 0;
    const viewportHeight = view?.innerHeight ?? 0;
    const measurements: Measurement[] = [];
    let missing = 0;
    let truncated = 0;

    for (const finding of this.findings) {
      const target = this.resolve(finding.nodeRef);
      if (!target?.isConnected) {
        missing += 1;
        continue;
      }
      if (measurements.length >= this.maxBoxes) {
        truncated += 1;
        continue;
      }
      const rect = target.getBoundingClientRect();
      const offscreen =
        rect.bottom < -CULL_MARGIN_PX ||
        rect.right < -CULL_MARGIN_PX ||
        rect.top > viewportHeight + CULL_MARGIN_PX ||
        rect.left > viewportWidth + CULL_MARGIN_PX;
      if (offscreen && finding.nodeRef !== this.selected) continue;
      measurements.push({
        nodeRef: finding.nodeRef,
        status: finding.status,
        ruleId: finding.ruleId,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }

    const live = new Set(measurements.map((item) => item.nodeRef));
    for (const [nodeRef, box] of this.boxes)
      if (!live.has(nodeRef)) {
        box.remove();
        this.boxes.delete(nodeRef);
      }

    for (const measurement of measurements) {
      let box = this.boxes.get(measurement.nodeRef);
      if (!box) {
        box = this.page.createElement("div");
        box.dataset.box = "";
        box.dataset.nodeRef = measurement.nodeRef;
        this.boxes.set(measurement.nodeRef, box);
        shadow.append(box);
      }
      box.dataset.status = measurement.status;
      const isSelected = measurement.nodeRef === this.selected;
      box.dataset.selected = String(isSelected);
      box.style.cssText = `left: ${measurement.left}px; top: ${measurement.top}px; width: ${measurement.width}px; height: ${measurement.height}px;`;
      const existingLabel = box.firstElementChild;
      if (!isSelected) {
        existingLabel?.remove();
        continue;
      }
      const label = existingLabel ?? this.page.createElement("span");
      (label as HTMLElement).dataset.label = "";
      label.textContent = `${
        measurement.status === "needs-review" ? "Review" : "Violation"
      } · ${measurement.ruleId}`;
      if (!existingLabel) box.append(label);
    }

    return {
      rendered: measurements.length,
      missing,
      truncated,
      complete: missing === 0 && truncated === 0,
    };
  }
}
