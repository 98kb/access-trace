import type { FindingV1 } from "./contracts";

type ResolveElement = (nodeRef: string) => Element | undefined;

function viewportRect(element: Element) {
  const rect = element.getBoundingClientRect();
  let left = rect.left;
  let top = rect.top;
  let view = element.ownerDocument.defaultView;
  while (view?.frameElement) {
    const frame = view.frameElement;
    const frameRect = frame.getBoundingClientRect();
    left += frameRect.left + (frame as HTMLElement).clientLeft;
    top += frameRect.top + (frame as HTMLElement).clientTop;
    view = frame.ownerDocument.defaultView;
  }
  return { left, top, width: rect.width, height: rect.height };
}

export class OverlayController {
  private host?: HTMLElement;
  private findings: FindingV1[] = [];
  private selected?: string;
  private frame?: number;
  private observer?: ResizeObserver;

  constructor(
    private readonly page: Document,
    private readonly resolve: ResolveElement,
  ) {}

  show(findings: FindingV1[]): boolean {
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
    element.scrollIntoView({
      behavior: this.page.defaultView?.matchMedia?.(
        "(prefers-reduced-motion: reduce)",
      ).matches
        ? "auto"
        : "smooth",
      block: "center",
      inline: "nearest",
    });
    this.render();
    return true;
  }

  destroy(): void {
    window.removeEventListener("scroll", this.schedule, true);
    window.removeEventListener("resize", this.schedule);
    this.observer?.disconnect();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.host?.remove();
    this.host = undefined;
    this.findings = [];
    this.selected = undefined;
  }

  private ensureRoot(): void {
    if (this.host) return;
    const host = this.page.createElement("div");
    host.dataset.accessibilityInspectorOverlay = "";
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0px",
      zIndex: "2147483647",
      pointerEvents: "none",
    });
    const shadow = host.attachShadow({ mode: "open" });
    const style = this.page.createElement("style");
    style.textContent = `
      :host { all: initial; }
      [data-box] { box-sizing: border-box; position: fixed; border: 3px solid #d946ef; background: rgb(217 70 239 / 12%); pointer-events: none; }
      [data-box][data-selected="true"] { border-color: #7c3aed; border-width: 5px; background: rgb(124 58 237 / 14%); outline: 2px solid #fff; animation: emphasize 650ms cubic-bezier(.22, 1, .36, 1) 2 alternate; }
      [data-label] { position: absolute; top: -24px; left: -3px; max-width: 240px; overflow: hidden; padding: 3px 6px; border-radius: 3px; background: #111827; color: #fff; font: 600 12px/18px ui-monospace, monospace; white-space: nowrap; text-overflow: ellipsis; }
      @keyframes emphasize { to { border-color: #facc15; transform: scale(1.015); } }
      @media (prefers-reduced-motion: reduce) { [data-box][data-selected="true"] { animation: none; } }
    `;
    shadow.append(style);
    this.page.documentElement.append(host);
    this.host = host;
    window.addEventListener("scroll", this.schedule, true);
    window.addEventListener("resize", this.schedule);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(this.schedule);
      this.observer.observe(this.page.documentElement);
    }
  }

  private readonly schedule = (): void => {
    if (this.frame !== undefined) return;
    this.frame = -1;
    const id = requestAnimationFrame(() => {
      this.frame = undefined;
      this.render();
    });
    if (this.frame !== undefined) this.frame = id;
  };

  private render(): boolean {
    const shadow = this.host?.shadowRoot;
    if (!shadow) return false;
    let complete = true;
    shadow.querySelectorAll("[data-box]").forEach((box) => box.remove());
    for (const finding of this.findings) {
      const target = this.resolve(finding.nodeRef);
      if (!target?.isConnected) {
        complete = false;
        continue;
      }
      const rect = viewportRect(target);
      const box = this.page.createElement("div");
      box.dataset.box = "";
      box.dataset.nodeRef = finding.nodeRef;
      box.dataset.selected = String(finding.nodeRef === this.selected);
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      const label = this.page.createElement("span");
      label.dataset.label = "";
      label.textContent = `${finding.status === "needs-review" ? "Review" : "Violation"} · ${finding.ruleId}`;
      box.append(label);
      shadow.append(box);
    }
    return complete;
  }
}
