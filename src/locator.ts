import type { LocatorSegmentV1 } from "./contracts";

export type LocatorFailureReason =
  | "stale"
  | "ambiguous"
  | "frame-inaccessible"
  | "closed-shadow-root"
  | "invalid";

export type LocatorResolution =
  | { ok: true; element: Element }
  | { ok: false; reason: LocatorFailureReason; message: string };

/**
 * Bounded, value-free HTML used both as displayed evidence and as the identity
 * check that stops a stale locator from highlighting a look-alike element.
 */
export function redactSnippet(html: string): string {
  return html
    .replace(
      /\svalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      ' value="[redacted]"',
    )
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1[redacted]$2")
    .slice(0, 500);
}

export function elementSnippet(element: Element): string {
  return redactSnippet(element.outerHTML);
}

export function locatorSegmentsFromAxeTarget(
  target: Array<string | string[]>,
): LocatorSegmentV1[] {
  const segments: LocatorSegmentV1[] = [];
  target.forEach((part, partIndex) => {
    const finalPart = partIndex === target.length - 1;
    const selectors = typeof part === "string" ? [part] : part;
    selectors.forEach((selector, selectorIndex) => {
      const finalSelector = selectorIndex === selectors.length - 1;
      segments.push({
        type: finalSelector ? (finalPart ? "css" : "frame") : "shadow",
        selector,
      });
    });
  });
  return segments;
}

function failure(
  reason: LocatorFailureReason,
  message: string,
): LocatorResolution {
  return { ok: false, reason, message };
}

function unique(
  root: ParentNode,
  selector: string,
): Element | LocatorFailureReason {
  let matches: NodeListOf<Element>;
  try {
    matches = root.querySelectorAll(selector);
  } catch {
    return "invalid";
  }
  if (matches.length === 0) return "stale";
  if (matches.length > 1) return "ambiguous";
  return matches[0]!;
}

/**
 * Walks the exact segment path. Every segment must resolve to exactly one
 * element; there is no nearest-match fallback at any depth.
 */
export function resolveLocator(
  root: Document | ShadowRoot,
  segments: LocatorSegmentV1[],
  expectedSnippet?: string,
): LocatorResolution {
  if (segments.length === 0)
    return failure("invalid", "The locator has no segments.");
  if (segments[segments.length - 1]!.type !== "css")
    return failure("invalid", "The locator does not end at an element.");

  let scope: Document | ShadowRoot = root;
  for (const segment of segments) {
    const found = unique(scope, segment.selector);
    if (typeof found === "string")
      return failure(
        found,
        found === "ambiguous"
          ? `'${segment.selector}' matches more than one element, so the exact target cannot be proven.`
          : found === "invalid"
            ? `'${segment.selector}' is not a usable selector.`
            : `'${segment.selector}' no longer matches an element.`,
      );

    if (segment.type === "css") {
      if (
        expectedSnippet !== undefined &&
        elementSnippet(found) !== expectedSnippet
      )
        return failure(
          "stale",
          "The element at this path changed since the scan.",
        );
      return { ok: true, element: found };
    }

    if (segment.type === "shadow") {
      if (!found.shadowRoot)
        return failure(
          "closed-shadow-root",
          `'${segment.selector}' has no open shadow root to inspect.`,
        );
      scope = found.shadowRoot;
      continue;
    }

    const frameDocument =
      (found as HTMLIFrameElement | HTMLFrameElement).contentDocument ?? null;
    if (!frameDocument)
      return failure(
        "frame-inaccessible",
        `The document inside '${segment.selector}' is not accessible from this frame.`,
      );
    scope = frameDocument;
  }
  return failure("invalid", "The locator path ended before an element.");
}
