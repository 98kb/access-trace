import { describe, expect, it } from "vitest";

import {
  elementSnippet,
  locatorSegmentsFromAxeTarget,
  resolveLocator,
} from "../src/locator";

function page(html: string): Document {
  document.body.innerHTML = html;
  return document;
}

describe("locatorSegmentsFromAxeTarget", () => {
  it("types frame, shadow, and element segments from an Axe target path", () => {
    expect(
      locatorSegmentsFromAxeTarget(["#frame", ["my-card", "#inner", "button"]]),
    ).toEqual([
      { type: "frame", selector: "#frame" },
      { type: "shadow", selector: "my-card" },
      { type: "shadow", selector: "#inner" },
      { type: "css", selector: "button" },
    ]);
  });

  it("keeps a single flat selector as one element segment", () => {
    expect(locatorSegmentsFromAxeTarget(["img"])).toEqual([
      { type: "css", selector: "img" },
    ]);
  });
});

describe("resolveLocator", () => {
  it("resolves an element through an open shadow boundary", () => {
    const document = page("<div id=host></div>");
    const host = document.querySelector("#host")!;
    host.attachShadow({ mode: "open" }).innerHTML = "<img id=logo>";

    const result = resolveLocator(document, [
      { type: "shadow", selector: "#host" },
      { type: "css", selector: "#logo" },
    ]);

    expect(result.ok).toBe(true);
    expect(result.ok && result.element.id).toBe("logo");
  });

  it("reports a closed shadow root as uninspectable rather than stale", () => {
    const document = page("<div id=host></div>");
    document.querySelector("#host")!.attachShadow({ mode: "closed" });

    expect(
      resolveLocator(document, [
        { type: "shadow", selector: "#host" },
        { type: "css", selector: "img" },
      ]),
    ).toMatchObject({ ok: false, reason: "closed-shadow-root" });
  });

  it("fails stale when any segment no longer resolves", () => {
    const document = page("<div id=host></div>");
    document.querySelector("#host")!.attachShadow({ mode: "open" }).innerHTML =
      "<img id=logo>";

    expect(
      resolveLocator(document, [
        { type: "shadow", selector: "#gone" },
        { type: "css", selector: "#logo" },
      ]),
    ).toMatchObject({ ok: false, reason: "stale" });
  });

  it("refuses an ambiguous selector instead of highlighting a similar element", () => {
    const document = page("<img class=hero><img class=hero>");

    expect(
      resolveLocator(document, [{ type: "css", selector: ".hero" }]),
    ).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("fails stale when the element at the path is no longer the recorded element", () => {
    const document = page('<img id="a" src="one.png">');
    const original = elementSnippet(document.querySelector("#a")!);
    document.querySelector("#a")!.setAttribute("src", "two.png");

    expect(
      resolveLocator(document, [{ type: "css", selector: "#a" }], original),
    ).toMatchObject({ ok: false, reason: "stale" });
    expect(
      resolveLocator(
        document,
        [{ type: "css", selector: "#a" }],
        elementSnippet(document.querySelector("#a")!),
      ),
    ).toMatchObject({ ok: true });
  });

  it("reports an inaccessible frame distinctly from a missing element", () => {
    const document = page("<iframe id=remote></iframe>");
    const frame = document.querySelector("#remote")!;
    Object.defineProperty(frame, "contentDocument", { value: null });

    expect(
      resolveLocator(document, [
        { type: "frame", selector: "#remote" },
        { type: "css", selector: "img" },
      ]),
    ).toMatchObject({ ok: false, reason: "frame-inaccessible" });
  });

  it("rejects an empty or malformed path without throwing", () => {
    const document = page("<img>");
    expect(resolveLocator(document, [])).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(
      resolveLocator(document, [{ type: "css", selector: "::::" }]),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("elementSnippet", () => {
  it("redacts form values so evidence never carries user input", () => {
    const document = page('<input id=field value="secret-token">');
    expect(elementSnippet(document.querySelector("#field")!)).toContain(
      "[redacted]",
    );
    expect(elementSnippet(document.querySelector("#field")!)).not.toContain(
      "secret-token",
    );
  });
});
