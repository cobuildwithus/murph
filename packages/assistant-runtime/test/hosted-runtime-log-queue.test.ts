import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
  type HostedRuntimeLogEntry,
  type HostedRuntimeLogResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  drainHostedRuntimeLogWritesBestEffort,
  HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES,
  writeHostedRuntimeLogBestEffort,
  writeHostedRuntimeLogEntriesBestEffort,
} from "../src/hosted-runtime/runtime-logs.ts";

interface ControlledLogWrite {
  entries: HostedRuntimeLogEntry[];
  reject: (reason: unknown) => void;
  resolve: () => void;
}

function createControlledLogPort(): {
  port: { write: (request: { entries: HostedRuntimeLogEntry[] }) => Promise<HostedRuntimeLogResponse> };
  writes: ControlledLogWrite[];
} {
  const writes: ControlledLogWrite[] = [];
  return {
    port: {
      write: async (request) =>
        await new Promise<HostedRuntimeLogResponse>((resolve, reject) => {
          writes.push({
            entries: request.entries,
            reject,
            resolve: () => resolve({ loggedCount: request.entries.length }),
          });
        }),
    },
    writes,
  };
}

function buildQueueLogEntry(
  level: HostedRuntimeLogEntry["level"],
): Omit<HostedRuntimeLogEntry, "at"> {
  return {
    component: "runtime",
    eventCode: "runner.started",
    level,
    phase: "invoke",
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function trackSettled(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return () => settled;
}

describe("hosted runtime log write queue", () => {
  afterEach(async () => {
    // Never leave the module-level tail pending across tests.
    await drainHostedRuntimeLogWritesBestEffort();
    vi.restoreAllMocks();
  });

  it.each(["debug", "info"] as const)(
    "returns %s writes immediately while the port write is still pending",
    async (level) => {
      const { port, writes } = createControlledLogPort();

      await expect(writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry(level),
        now: () => "2026-06-12T00:00:00.000Z",
        platform: { logPort: port },
      })).resolves.toBeUndefined();

      // The caller already returned, but the durable write has not settled.
      await flushMicrotasks();
      expect(writes).toHaveLength(1);
      // `at` is stamped at enqueue time, not at flush time.
      expect(writes[0]!.entries).toEqual([
        expect.objectContaining({
          at: "2026-06-12T00:00:00.000Z",
          eventCode: "runner.started",
          level,
        }),
      ]);

      const drainSettled = trackSettled(drainHostedRuntimeLogWritesBestEffort());
      await flushMicrotasks();
      expect(drainSettled()).toBe(false);
      writes[0]!.resolve();
      await flushMicrotasks();
      expect(drainSettled()).toBe(true);
    },
  );

  it.each(["warn", "error"] as const)(
    "writes %s directly, never waiting behind a queued info backlog",
    async (level) => {
      const { port, writes } = createControlledLogPort();

      const infoSettled = trackSettled(writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry("info"),
        now: () => "2026-06-12T00:00:01.000Z",
        platform: { logPort: port },
      }));
      const directSettled = trackSettled(writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry(level),
        now: () => "2026-06-12T00:00:02.000Z",
        platform: { logPort: port },
      }));

      await flushMicrotasks();
      expect(infoSettled()).toBe(true);
      expect(directSettled()).toBe(false);
      // The warn/error write starts immediately (synchronously, ahead of the
      // microtask-scheduled info write): the crash-diagnostic tail must not
      // wait behind backlog. `at` stamps preserve logical ordering for readers.
      expect(writes).toHaveLength(2);
      const directWrite = writes.find(
        (write) => write.entries[0]!.at === "2026-06-12T00:00:02.000Z",
      );
      const infoWrite = writes.find(
        (write) => write.entries[0]!.at === "2026-06-12T00:00:01.000Z",
      );
      expect(directWrite?.entries[0]!.level).toBe(level);
      expect(infoWrite).toBeDefined();

      // The warn/error settles on its own write, independent of the info backlog.
      directWrite!.resolve();
      await flushMicrotasks();
      expect(directSettled()).toBe(true);

      infoWrite!.resolve();
      await flushMicrotasks();
      await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
    },
  );

  it("checks foreground yield between direct diagnostic batches", async () => {
    const write = vi.fn(async (request: { entries: HostedRuntimeLogEntry[] }) => ({
      loggedCount: request.entries.length,
    }));
    const shouldYieldBetweenBatches = vi.fn(() => true);
    const entries = Array.from(
      { length: HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES + 1 },
      () => buildQueueLogEntry("warn"),
    );

    await writeHostedRuntimeLogEntriesBestEffort({
      entries,
      now: () => "2026-06-12T00:00:03.000Z",
      platform: { logPort: { write } },
      shouldYieldBetweenBatches,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0].entries).toHaveLength(
      HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES,
    );
    expect(shouldYieldBetweenBatches).toHaveBeenCalledTimes(1);
  });

  it("bounded drain returns on timeout while queued writes keep flushing", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { port, writes } = createControlledLogPort();

    const infoSettled = trackSettled(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:06.000Z",
      platform: { logPort: port },
    }));
    await flushMicrotasks();
    expect(infoSettled()).toBe(true);
    expect(writes).toHaveLength(1);

    // The queued write never resolves within the bound: the drain must
    // return (not hang) and warn that writes continue in the background.
    await drainHostedRuntimeLogWritesBestEffort({ timeoutMs: 20 });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime log drain timed out; queued writes continue in the background.",
      { timeoutMs: 20 },
    );

    writes[0]!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("coalesces entries buffered during an in-flight request into one later request", async () => {
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:04.000Z",
      platform: { logPort: port },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    // Entries logged while the first request is still in flight share one
    // round trip instead of costing one each.
    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:05.000Z",
      platform: { logPort: port },
    });
    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:06.000Z",
      platform: { logPort: port },
    });
    expect(writes).toHaveLength(1);

    writes[0]!.resolve();
    await flushMicrotasks();
    expect(writes).toHaveLength(2);
    expect(writes[1]!.entries.map((entry) => entry.at)).toEqual([
      "2026-06-12T00:00:05.000Z",
      "2026-06-12T00:00:06.000Z",
    ]);

    writes[1]!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("keeps each request within the callback entry and body bounds", async () => {
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:01:00.000Z",
      platform: { logPort: port },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    const bufferedCount = HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES + 3;
    for (let index = 0; index < bufferedCount; index += 1) {
      await writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry("info"),
        now: () => `2026-06-12T00:02:${String(index).padStart(2, "0")}.000Z`,
        platform: { logPort: port },
      });
    }

    writes[0]!.resolve();
    await flushMicrotasks();
    expect(writes[1]!.entries).toHaveLength(HOSTED_RUNTIME_LOG_REQUEST_MAX_ENTRIES);

    writes[1]!.resolve();
    await flushMicrotasks();
    expect(writes[2]!.entries).toHaveLength(3);

    writes[2]!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("splits oversized diagnostics so one request never exceeds the body limit", async () => {
    const { port, writes } = createControlledLogPort();
    // An oversized single entry gets its own request instead of wedging the
    // transport; two such entries must never share a request.
    const bulkyDiagnostic = { statusSummary: "x".repeat(100 * 1024) };

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:03:00.000Z",
      platform: { logPort: port },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    for (const at of ["2026-06-12T00:03:01.000Z", "2026-06-12T00:03:02.000Z"]) {
      await writeHostedRuntimeLogBestEffort({
        entry: {
          ...buildQueueLogEntry("info"),
          redactedJson: bulkyDiagnostic,
        },
        now: () => at,
        platform: { logPort: port },
      });
    }

    writes[0]!.resolve();
    await flushMicrotasks();
    expect(writes[1]!.entries).toHaveLength(1);

    writes[1]!.resolve();
    await flushMicrotasks();
    expect(writes[2]!.entries).toHaveLength(1);

    writes[2]!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("drops only the oldest info diagnostics when a stalled endpoint fills the queue", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:04:00.000Z",
      platform: { logPort: port },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    for (let index = 0; index < HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES + 1; index += 1) {
      await writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry("info"),
        now: () => `2026-06-12T00:05:00.${String(index).padStart(3, "0")}Z`,
        platform: { logPort: port },
      });
    }

    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime log queue is full; dropping verbose diagnostics.",
      {
        droppedEntryCount: 1,
        maxQueuedEntries: HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES,
      },
    );

    writes[0]!.resolve();
    await flushMicrotasks();
    // The oldest buffered entry was dropped; the newest ones survived.
    expect(writes[1]!.entries[0]!.at).toBe("2026-06-12T00:05:00.001Z");

    for (let index = 1; index < writes.length; index += 1) {
      writes[index]!.resolve();
      await flushMicrotasks();
    }
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("keeps a rotated invocation's entries in order and on their own port", async () => {
    // A warm runner process outlives an invocation: the bounded invocation-end
    // drain can return while a request is still in flight, so the next
    // invocation's fresh log port appears mid-queue. Older entries must still
    // be submitted first, and through the port they were logged on.
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = createControlledLogPort();
    const second = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T01:00:00.000Z",
      platform: { logPort: first.port },
    });
    await flushMicrotasks();
    expect(first.writes).toHaveLength(1);

    // More first-invocation entries pile up behind the in-flight request.
    for (const at of ["2026-06-12T01:00:01.000Z", "2026-06-12T01:00:02.000Z"]) {
      await writeHostedRuntimeLogBestEffort({
        entry: buildQueueLogEntry("info"),
        now: () => at,
        platform: { logPort: first.port },
      });
    }

    // The invocation-end drain gives up while that request is still open.
    await drainHostedRuntimeLogWritesBestEffort({ timeoutMs: 20 });

    // The next invocation starts on a new port.
    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T01:00:03.000Z",
      platform: { logPort: second.port },
    });
    expect(second.writes).toHaveLength(0);

    first.writes[0]!.resolve();
    await flushMicrotasks();

    // The older invocation's remainder goes next, on its own port.
    expect(first.writes).toHaveLength(2);
    expect(first.writes[1]!.entries.map((entry) => entry.at)).toEqual([
      "2026-06-12T01:00:01.000Z",
      "2026-06-12T01:00:02.000Z",
    ]);
    expect(second.writes).toHaveLength(0);

    first.writes[1]!.resolve();
    await flushMicrotasks();
    expect(second.writes).toHaveLength(1);
    expect(second.writes[0]!.entries[0]!.at).toBe("2026-06-12T01:00:03.000Z");

    second.writes[0]!.resolve();
    await flushMicrotasks();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime log drain timed out; queued writes continue in the background.",
      { timeoutMs: 20 },
    );
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("bounds retained info entries across repeated port rotations", async () => {
    // The cap is process-wide, not per port: rotating ports while the endpoint
    // is stalled must not multiply what a warm process retains.
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stalled = createControlledLogPort();
    const rotations = 4;
    const perRotation = HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES / 2;
    const ports = Array.from({ length: rotations }, () => createControlledLogPort());

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T02:00:00.000Z",
      platform: { logPort: stalled.port },
    });
    await flushMicrotasks();
    expect(stalled.writes).toHaveLength(1);

    let stamped = 0;
    for (const rotation of ports) {
      for (let index = 0; index < perRotation; index += 1) {
        stamped += 1;
        await writeHostedRuntimeLogBestEffort({
          entry: buildQueueLogEntry("info"),
          now: () => `2026-06-12T02:${String(stamped).padStart(2, "0")}:00.000Z`,
          platform: { logPort: rotation.port },
        });
      }
    }

    stalled.writes[0]!.resolve();
    await flushMicrotasks();

    // Only the newest 500 survived, so the two oldest rotations wrote nothing.
    const retained = [stalled, ...ports]
      .flatMap((candidate) => candidate.writes)
      .reduce((total, write) => total + write.entries.length, 0);
    expect(retained).toBeLessThanOrEqual(
      HOSTED_RUNTIME_LOG_MAX_QUEUED_ENTRIES + 1,
    );

    for (const candidate of [stalled, ...ports]) {
      for (const write of candidate.writes) {
        write.resolve();
        await flushMicrotasks();
      }
    }
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("swallows batch write failures so the chain and later writes never reject", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:04.000Z",
      platform: { logPort: port },
    });
    await flushMicrotasks();
    expect(writes).toHaveLength(1);

    const secondInfoSettled = trackSettled(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:05.000Z",
      platform: { logPort: port },
    }));

    writes[0]!.reject(new TypeError("Synthetic batched log write failure."));
    await flushMicrotasks();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime durable log write failed.",
      {
        component: "runtime",
        entryCount: 1,
        errorName: "TypeError",
        eventCode: "runner.started",
      },
    );

    // The failed write did not poison the chain: the next buffered info entry
    // still runs, and the drain resolves cleanly.
    expect(secondInfoSettled()).toBe(true);
    expect(writes).toHaveLength(2);
    writes[1]!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
  });

  it("drain waits for writes enqueued after the drain started", async () => {
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:06.000Z",
      platform: { logPort: port },
    });
    const drainSettled = trackSettled(drainHostedRuntimeLogWritesBestEffort());
    await flushMicrotasks();
    expect(drainSettled()).toBe(false);

    // A write enqueued while the drain is already awaiting the tail must
    // still be flushed before the drain resolves.
    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:07.000Z",
      platform: { logPort: port },
    });

    expect(writes).toHaveLength(1);
    writes[0]!.resolve();
    await flushMicrotasks();
    expect(drainSettled()).toBe(false);
    expect(writes).toHaveLength(2);
    expect(writes[1]!.entries[0]!.at).toBe("2026-06-12T00:00:07.000Z");

    writes[1]!.resolve();
    await flushMicrotasks();
    expect(drainSettled()).toBe(true);
  });
});
