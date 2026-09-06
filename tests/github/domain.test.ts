import { describe, expect, it } from "vitest";
import { getDomainKeyFromUrl } from "../../src/github/domain";

describe("GitHub domain canonicalization", () => {
  it("extracts exact lower-cased domain key for standard HTTP/HTTPS URLs", () => {
    expect(getDomainKeyFromUrl("https://EXAMPLE.com/path/to/page")).toBe(
      "example.com",
    );
    expect(getDomainKeyFromUrl("http://Sub.Domain.org:8080/")).toBe(
      "sub.domain.org:8080",
    );
  });

  it("handles standard default ports correctly", () => {
    expect(getDomainKeyFromUrl("http://example.com:80/foo")).toBe(
      "example.com",
    );
    expect(getDomainKeyFromUrl("https://example.com:443/foo")).toBe(
      "example.com",
    );
    expect(getDomainKeyFromUrl("http://localhost:3000/")).toBe(
      "localhost:3000",
    );
    expect(getDomainKeyFromUrl("http://localhost:4000/")).toBe(
      "localhost:4000",
    );
  });

  it("keeps www distinct from apex domain without inheritance", () => {
    expect(getDomainKeyFromUrl("https://www.example.com")).toBe(
      "www.example.com",
    );
    expect(getDomainKeyFromUrl("https://example.com")).toBe("example.com");
    expect(getDomainKeyFromUrl("https://www.example.com")).not.toBe(
      getDomainKeyFromUrl("https://example.com"),
    );
  });

  it("strips scheme, userinfo, path, query, and fragment", () => {
    expect(
      getDomainKeyFromUrl(
        "https://admin:secret@MyDomain.com:8443/secret/path?query=val#fragment",
      ),
    ).toBe("mydomain.com:8443");
  });

  it("rejects unsupported schemes and malformed URLs", () => {
    expect(getDomainKeyFromUrl("chrome://extensions")).toBeNull();
    expect(
      getDomainKeyFromUrl(
        "chrome-extension://abcdefghijklmnopqrstuvwxyz/index.html",
      ),
    ).toBeNull();
    expect(getDomainKeyFromUrl("about:blank")).toBeNull();
    expect(getDomainKeyFromUrl("file:///C:/index.html")).toBeNull();
    expect(getDomainKeyFromUrl("not a url")).toBeNull();
    expect(getDomainKeyFromUrl("")).toBeNull();
  });
});
