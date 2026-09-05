/**
 * Budgets measured on this repository's test environment: jsdom for overlay
 * work (running concurrently with the rest of the suite) and headless Chromium
 * for fixture scans. Observed baselines for 300 findings were 159-303 ms for
 * the first render and 25-42 ms for a reposition; the ceilings below add
 * headroom over the slowest observed run. They are calibrated to this
 * environment, not a guarantee about any particular browser or device.
 */
export const PERFORMANCE_BUDGETS = {
  /** First paint of the overlay for a page with 300 findings. */
  overlayInitialRenderMs: 500,
  /** A scroll/resize-driven reposition of an already-rendered overlay. */
  overlayUpdateMs: 150,
  /** End-to-end deterministic scan of a repository fixture. */
  fixtureScanMs: 8_000,
  /** Findings drawn at once before the overlay stops adding boxes. */
  overlayMaxBoxes: 400,
} as const;
