import type { FrameScanFailureV1, FrameScanV1 } from "./aggregate";
import { aggregateFrameScans } from "./aggregate";
import type { ScanReportV1 } from "./contracts";
import { SCHEMA_VERSION, TOP_FRAME_ID } from "./contracts";
import { parseExtensionResponse, type ScanFailure } from "./messages";
import { ExpectedScanError } from "./orchestrator";

export const DEFAULT_FRAME_TIMEOUT_MS = 15_000;

export type FrameTransport = {
  /** Injects the scanner into every reachable frame and returns their ids. */
  inject: (tabId: number) => Promise<number[]>;
  send: (tabId: number, frameId: number, message: unknown) => Promise<unknown>;
};

type FrameAttempt =
  | { ok: true; frameScan: FrameScanV1 }
  | { ok: false; failure: FrameScanFailureV1 };

function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  onTimeout: () => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function requestFrameScan(
  input: {
    tabId: number;
    scanId: string;
    transport: FrameTransport;
    frameTimeoutMs: number;
  },
  frameId: number,
): Promise<FrameAttempt> {
  const failure = (
    reason: FrameScanFailureV1["reason"],
    detail: string,
  ): FrameAttempt => ({
    ok: false,
    failure: { frameId, url: "", reason, detail },
  });

  try {
    const raw = await withTimeout(
      input.transport.send(input.tabId, frameId, {
        schemaVersion: SCHEMA_VERSION,
        type: "scan-request",
        scan: { scanId: input.scanId, frameId },
      }),
      input.frameTimeoutMs,
      () => undefined,
    );
    if (raw === undefined)
      return failure("timeout", "The frame did not answer the scan request.");
    const response = parseExtensionResponse(raw);
    if (response.type !== "frame-scan-result")
      return failure(
        "execution-failure",
        "The frame returned an unexpected response.",
      );
    if (!response.ok)
      return failure("execution-failure", response.error.message);
    // A frame answering for an older scan is discarded, not merged.
    if (response.frameScan.scanId !== input.scanId)
      return failure(
        "execution-failure",
        "The frame answered for a superseded scan.",
      );
    return { ok: true, frameScan: response.frameScan };
  } catch (error) {
    return failure(
      "execution-failure",
      error instanceof Error
        ? error.message
        : "The frame could not be reached.",
    );
  }
}

/**
 * Injects, scans, and folds every reachable frame of one tab into a single
 * report. Frames that cannot answer become failed coverage regions instead of
 * silently shrinking the scanned scope.
 */
export async function runTabScan(input: {
  tabId: number;
  scanId: string;
  page: { url: string; title: string };
  startedAt: string;
  transport: FrameTransport;
  signal?: AbortSignal;
  frameTimeoutMs?: number;
  elapsedMs: () => number;
}): Promise<ScanReportV1> {
  let frameIds: number[];
  try {
    frameIds = await input.transport.inject(input.tabId);
  } catch (error) {
    throw new ExpectedScanError(
      "permission-denied",
      error instanceof Error
        ? error.message
        : "Chrome denied access to this page.",
    );
  }
  if (frameIds.length === 0)
    throw new ExpectedScanError(
      "permission-denied",
      "Chrome did not allow the scanner to run in this page.",
    );

  const attempts = await Promise.all(
    frameIds.map((frameId) =>
      requestFrameScan(
        {
          tabId: input.tabId,
          scanId: input.scanId,
          transport: input.transport,
          frameTimeoutMs: input.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS,
        },
        frameId,
      ),
    ),
  );

  const frames = attempts.flatMap((attempt) =>
    attempt.ok ? [attempt.frameScan] : [],
  );
  const failures = attempts.flatMap((attempt) =>
    attempt.ok ? [] : [attempt.failure],
  );
  const topFailure = failures.find(
    (failure) => failure.frameId === TOP_FRAME_ID,
  );
  if (topFailure && frames.length === 0)
    throw new ExpectedScanError(
      topFailure.reason === "timeout" ? "timeout" : "scan-failed",
      topFailure.detail ?? "The page could not be scanned.",
    );

  return aggregateFrameScans({
    scanId: input.scanId,
    page: input.page,
    startedAt: input.startedAt,
    durationMs: input.elapsedMs(),
    scannerVersion: frames[0]?.scannerVersion ?? "unknown",
    frames,
    failures: failures.map((failure) => ({
      ...failure,
      url:
        failure.url ||
        frames.find((frame) => frame.frameId === failure.frameId)?.url ||
        input.page.url,
    })),
    ...(input.signal?.aborted ? { cancelled: true } : {}),
  });
}

export type CommandOutcome = { ok: true } | { ok: false; error: ScanFailure };

/**
 * Sends one overlay command to every frame the scan reached and fails if any
 * of them reports a typed failure, so the panel is never told an overlay was
 * updated in a document that could not update it.
 */
export async function broadcastCommand(input: {
  tabId: number;
  frameIds: number[];
  message: unknown;
  transport: FrameTransport;
}): Promise<CommandOutcome> {
  if (input.frameIds.length === 0)
    return {
      ok: false,
      error: {
        code: "stale-finding",
        message: "No scanned document is available for this command.",
      },
    };
  const outcomes = await Promise.all(
    input.frameIds.map(async (frameId): Promise<CommandOutcome> => {
      let raw: unknown;
      try {
        raw = await input.transport.send(input.tabId, frameId, input.message);
      } catch {
        return {
          ok: false,
          error: {
            code: "frame-unreachable",
            message: "A scanned frame is no longer reachable. Rescan the page.",
          },
        };
      }
      if (raw === undefined)
        return {
          ok: false,
          error: {
            code: "frame-unreachable",
            message: "A scanned frame has no scanner context. Rescan the page.",
          },
        };
      const response = parseExtensionResponse(raw);
      if (response.type !== "command-result")
        return {
          ok: false,
          error: {
            code: "invalid-message",
            message: "A frame returned an unexpected response.",
          },
        };
      return response.ok ? { ok: true } : { ok: false, error: response.error };
    }),
  );
  return outcomes.find((outcome) => !outcome.ok) ?? { ok: true };
}

export type SelectionOutcome = CommandOutcome;

/**
 * Sends a selection to the one frame that owns the node and clears any
 * selection elsewhere. Every path returns an explicit acknowledgement.
 */
export async function routeSelection(input: {
  tabId: number;
  frameIds: number[];
  owningFrameId: number | undefined;
  findingId: string;
  transport: FrameTransport;
}): Promise<SelectionOutcome> {
  if (input.owningFrameId === undefined)
    return {
      ok: false,
      error: {
        code: "stale-finding",
        message: "This finding has no known frame in the current scan.",
      },
    };

  await Promise.all(
    input.frameIds
      .filter((frameId) => frameId !== input.owningFrameId)
      .map((frameId) =>
        input.transport
          .send(input.tabId, frameId, {
            schemaVersion: SCHEMA_VERSION,
            type: "overlay-command",
            command: "deselect",
          })
          .catch(() => undefined),
      ),
  );

  let raw: unknown;
  try {
    raw = await input.transport.send(input.tabId, input.owningFrameId, {
      schemaVersion: SCHEMA_VERSION,
      type: "overlay-command",
      command: "select",
      findingId: input.findingId,
    });
  } catch {
    return {
      ok: false,
      error: {
        code: "frame-unreachable",
        message:
          "The frame that owns this finding is no longer reachable. Rescan the page.",
      },
    };
  }
  if (raw === undefined)
    return {
      ok: false,
      error: {
        code: "frame-unreachable",
        message:
          "The frame that owns this finding has no scanner context. Rescan the page.",
      },
    };
  const response = parseExtensionResponse(raw);
  if (response.type !== "command-result")
    return {
      ok: false,
      error: {
        code: "invalid-message",
        message: "The frame returned an unexpected response.",
      },
    };
  return response.ok ? { ok: true } : { ok: false, error: response.error };
}
