import type { SimpleStorage } from "./auth";
import {
  parseDomainRepositoryMapping,
  type DomainRepositoryMappingV1,
} from "./contracts";
import { getDomainKeyFromUrl } from "./domain";

const MAPPINGS_STORAGE_KEY = "github-domain-mappings:v1";

export class DomainMappingStore {
  private storage: SimpleStorage;

  constructor(storage: SimpleStorage) {
    this.storage = storage;
  }

  async getMappings(): Promise<DomainRepositoryMappingV1[]> {
    const raw = await this.storage.get(MAPPINGS_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    const valid: DomainRepositoryMappingV1[] = [];
    for (const item of raw) {
      try {
        valid.push(parseDomainRepositoryMapping(item));
      } catch {
        // Skip invalid/corrupt mapping items
      }
    }
    return valid;
  }

  async getMappingForDomain(
    rawDomain: string,
  ): Promise<DomainRepositoryMappingV1 | null> {
    const key = rawDomain.includes("://")
      ? getDomainKeyFromUrl(rawDomain)
      : getDomainKeyFromUrl(`http://${rawDomain}`);

    if (!key) return null;
    const mappings = await this.getMappings();
    return mappings.find((m) => m.domainKey === key) ?? null;
  }

  async saveMapping(mapping: DomainRepositoryMappingV1): Promise<void> {
    const validated = parseDomainRepositoryMapping(mapping);
    const mappings = await this.getMappings();
    const index = mappings.findIndex(
      (m) => m.domainKey === validated.domainKey,
    );

    if (index >= 0) {
      mappings[index] = validated;
    } else {
      mappings.push(validated);
    }

    await this.storage.set(MAPPINGS_STORAGE_KEY, mappings);
  }

  async deleteMapping(rawDomain: string): Promise<void> {
    const key = rawDomain.includes("://")
      ? getDomainKeyFromUrl(rawDomain)
      : getDomainKeyFromUrl(`http://${rawDomain}`);

    if (!key) return;
    const mappings = await this.getMappings();
    const filtered = mappings.filter((m) => m.domainKey !== key);
    await this.storage.set(MAPPINGS_STORAGE_KEY, filtered);
  }
}
