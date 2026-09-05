import {
  EVIDENCE_ATTRIBUTE_NAMES,
  isSensitiveEvidenceText,
  parseAssistantRequest,
  type AssistantRequestV1,
  type ElementEvidenceV1,
} from "./assistant-contracts";
import type { FindingV1 } from "./contracts";
import { SCHEMA_VERSION } from "./contracts";

const allowedAttributes = new Set<string>(EVIDENCE_ATTRIBUTE_NAMES);

function boundedEvidenceText(
  value: string | null | undefined,
  max: number,
): string {
  const normalized = (value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  return isSensitiveEvidenceText(normalized)
    ? "[redacted]"
    : normalized.slice(0, max);
}

function implicitRole(element: Element): string {
  const tag = element.tagName.toLowerCase();
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "img") return "img";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    const type = (element.getAttribute("type") ?? "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type !== "hidden") return "textbox";
  }
  return "";
}

function isHidden(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const tag = current.tagName.toLowerCase();
    const style = getComputedStyle(current);
    if (
      ["script", "style", "template", "noscript"].includes(tag) ||
      current.hasAttribute("hidden") ||
      current.getAttribute("aria-hidden") === "true" ||
      (current instanceof HTMLInputElement && current.type === "hidden") ||
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return true;
  }
  return false;
}

function isUserEntered(element: Element): boolean {
  for (
    let current: Element | null = element;
    current;
    current = current.parentElement
  ) {
    const editable = current.getAttribute("contenteditable");
    if (
      current instanceof HTMLInputElement ||
      current instanceof HTMLSelectElement ||
      current instanceof HTMLTextAreaElement ||
      (editable !== null && editable.toLowerCase() !== "false") ||
      (current instanceof HTMLElement && current.isContentEditable)
    )
      return true;
  }
  return false;
}

function accessibleName(element: Element): string {
  if (isHidden(element)) return "";
  const direct = element.getAttribute("aria-label");
  if (direct !== null) return boundedEvidenceText(direct, 300);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const label = labelledBy
      .split(/\s+/)
      .slice(0, 3)
      .map((id) => element.ownerDocument.getElementById(id))
      .filter(
        (label): label is HTMLElement =>
          !!label && !isHidden(label) && !isUserEntered(label),
      )
      .map((label) => label.textContent ?? "")
      .join(" ");
    if (label.trim()) return boundedEvidenceText(label, 300);
  }
  if (element instanceof HTMLInputElement) {
    const labelElement = element.labels?.[0];
    const label =
      labelElement && !isHidden(labelElement) && !isUserEntered(labelElement)
        ? labelElement.textContent
        : "";
    if (label) return boundedEvidenceText(label, 300);
  }
  return boundedEvidenceText(
    element.getAttribute("alt") ?? element.getAttribute("title"),
    300,
  );
}

function attributes(element: Element): Record<string, string> {
  return Object.fromEntries(
    [...element.attributes]
      .filter(
        ({ name, value }) =>
          allowedAttributes.has(name.toLowerCase()) &&
          !isSensitiveEvidenceText(name) &&
          !isSensitiveEvidenceText(value),
      )
      .slice(0, 8)
      .map(({ name, value }) => [
        name.toLowerCase(),
        boundedEvidenceText(value, 200),
      ]),
  );
}

function visibleText(element: Element): string {
  if (isUserEntered(element) || element.getAttribute("aria-hidden") === "true")
    return "";
  if (isHidden(element)) return "";

  const walker = element.ownerDocument.createTreeWalker(element, 4);
  const fragments: string[] = [];
  let length = 0;
  let visited = 0;
  for (
    let node = walker.nextNode();
    node && length <= 500 && visited < 200;
    node = walker.nextNode()
  ) {
    visited += 1;
    if (
      node.parentElement &&
      !isHidden(node.parentElement) &&
      !isUserEntered(node.parentElement) &&
      node.textContent
    ) {
      fragments.push(node.textContent);
      length += node.textContent.length;
    }
  }
  return boundedEvidenceText(fragments.join(" "), 500);
}

function relevantStyles(
  element: Element,
  ruleId: string,
): Record<string, string> {
  if (ruleId !== "color-contrast") return {};
  const style = getComputedStyle(element);
  return {
    color: boundedEvidenceText(style.color, 200),
    "background-color": boundedEvidenceText(style.backgroundColor, 200),
    "font-size": boundedEvidenceText(style.fontSize, 200),
    "font-weight": boundedEvidenceText(style.fontWeight, 200),
  };
}

export function buildAssistantRequest(
  element: Element,
  finding: FindingV1,
): AssistantRequestV1 {
  const evidence: ElementEvidenceV1 = {
    tagName: element.tagName.toLowerCase().slice(0, 32),
    role: boundedEvidenceText(
      element.getAttribute("role") ?? implicitRole(element),
      100,
    ),
    accessibleName: accessibleName(element),
    attributes: attributes(element),
    visibleText: visibleText(element),
    computedStyles: relevantStyles(element, finding.ruleId),
  };
  const categories = [
    "tag name",
    ...(evidence.role ? ["semantic role"] : []),
    ...(evidence.accessibleName ? ["accessible name"] : []),
    ...(Object.keys(evidence.attributes).length ? ["attributes"] : []),
    ...(evidence.visibleText ? ["visible text"] : []),
    ...(Object.keys(evidence.computedStyles).length
      ? ["relevant computed styles"]
      : []),
  ];
  return parseAssistantRequest({
    schemaVersion: SCHEMA_VERSION,
    operation: "explain-finding",
    finding: {
      ruleId: finding.ruleId.slice(0, 100),
      source: "axe-core",
      status: finding.status,
      impact: finding.impact,
      tags: finding.tags.slice(0, 16).map((tag) => tag.slice(0, 64)),
      help: finding.help.slice(0, 500),
      failureSummary: finding.failureSummary.slice(0, 1_000),
    },
    evidence,
    disclosure: {
      execution: "local",
      screenshotIncluded: false,
      evidenceCategories: categories,
    },
  });
}
