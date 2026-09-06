import { describe, expect, it, beforeEach } from "vitest";
import { DomainMappingStore } from "../../src/github/mappings";
import type { DomainRepositoryMappingV1 } from "../../src/github/contracts";

describe("Domain Mapping Store", () => {
  let mockStorage: Record<string, unknown>;
  let store: DomainMappingStore;

  const sampleMapping: DomainRepositoryMappingV1 = {
    schemaVersion: "1.0",
    domainKey: "example.com",
    installationId: 101,
    repository: {
      id: 501,
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      htmlUrl: "https://github.com/acme/web",
    },
    label: { id: 1, name: "a11y", color: "blue" },
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
  };

  beforeEach(() => {
    mockStorage = {};
    store = new DomainMappingStore({
      get: async (key: string) => mockStorage[key],
      set: async (key: string, val: unknown) => {
        mockStorage[key] = val;
      },
      remove: async (key: string) => {
        delete mockStorage[key];
      },
    });
  });

  it("adds and retrieves mappings by domainKey", async () => {
    await store.saveMapping(sampleMapping);

    const retrieved = await store.getMappingForDomain("example.com");
    expect(retrieved).toEqual(sampleMapping);

    // Case insensitive domain lookup
    const upperLookup = await store.getMappingForDomain("EXAMPLE.COM");
    expect(upperLookup).toEqual(sampleMapping);

    // Different subdomains do not match
    const subLookup = await store.getMappingForDomain("www.example.com");
    expect(subLookup).toBeNull();
  });

  it("updates existing mapping without duplicating entry", async () => {
    await store.saveMapping(sampleMapping);

    const updatedMapping: DomainRepositoryMappingV1 = {
      ...sampleMapping,
      label: null, // Change label to No label
      updatedAt: "2026-09-06T11:00:00.000Z",
    };

    await store.saveMapping(updatedMapping);

    const all = await store.getMappings();
    expect(all).toHaveLength(1);
    expect(all[0]?.label).toBeNull();
  });

  it("removes mapping for a domain", async () => {
    await store.saveMapping(sampleMapping);
    await store.deleteMapping("example.com");

    const retrieved = await store.getMappingForDomain("example.com");
    expect(retrieved).toBeNull();
    const all = await store.getMappings();
    expect(all).toHaveLength(0);
  });
});
