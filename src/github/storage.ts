import type { SimpleStorage } from "./auth";

export const chromeLocalStorage: SimpleStorage = {
  async get(key: string): Promise<unknown> {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      const res = await chrome.storage.local.get(key);
      return res[key];
    }
    return undefined;
  },
  async set(key: string, value: unknown): Promise<void> {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.set({ [key]: value });
    }
  },
  async remove(key: string): Promise<void> {
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      await chrome.storage.local.remove(key);
    }
  },
};
