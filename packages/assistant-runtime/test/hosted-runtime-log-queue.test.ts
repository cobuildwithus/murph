import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  HostedRuntimeLogEntry,
  HostedRuntimeLogResponse,
} from "@murphai/hosted-execution/runtime-control";

import {
  drainHostedRuntimeLogWritesBestEffort,
  writeHostedRuntimeLogBestEffort,
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

  it("returns info writes immediately while the port write is still pending", async () => {
    const { port, writes } = createControlledLogPort();

    await expect(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
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
        level: "info",
      }),
    ]);

    const drainSettled = trackSettled(drainHostedRuntimeLogWritesBestEffort());
    await flushMicrotasks();
    expect(drainSettled()).toBe(false);
    writes[0]!.resolve();
    await flushMicrotasks();
    expect(drainSettled()).toBe(true);
  });

  it("writes warn and error directly, never waiting behind a queued info backlog", async () => {
    const { port, writes } = createControlledLogPort();

    const infoSettled = trackSettled(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:01.000Z",
      platform: { logPort: port },
    }));
    const warnSettled = trackSettled(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("warn"),
      now: () => "2026-06-12T00:00:02.000Z",
      platform: { logPort: port },
    }));

    await flushMicrotasks();
    expect(infoSettled()).toBe(true);
    expect(warnSettled()).toBe(false);
    // The warn write starts immediately (synchronously, ahead of the
    // microtask-scheduled info write): the crash-diagnostic tail must not
    // wait behind backlog. `at` stamps preserve logical ordering for readers.
    expect(writes).toHaveLength(2);
    const warnWrite = writes.find((write) => write.entries[0]!.at === "2026-06-12T00:00:02.000Z");
    const infoWrite = writes.find((write) => write.entries[0]!.at === "2026-06-12T00:00:01.000Z");
    expect(warnWrite).toBeDefined();
    expect(infoWrite).toBeDefined();

    // The warn settles on its own write, independent of the info backlog.
    warnWrite!.resolve();
    await flushMicrotasks();
    expect(warnSettled()).toBe(true);

    infoWrite!.resolve();
    await flushMicrotasks();
    await expect(drainHostedRuntimeLogWritesBestEffort()).resolves.toBeUndefined();
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

  it("swallows queued port-write failures so the chain and later writes never reject", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { port, writes } = createControlledLogPort();

    await writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:04.000Z",
      platform: { logPort: port },
    });
    const secondInfoSettled = trackSettled(writeHostedRuntimeLogBestEffort({
      entry: buildQueueLogEntry("info"),
      now: () => "2026-06-12T00:00:05.000Z",
      platform: { logPort: port },
    }));

    await flushMicrotasks();
    expect(writes).toHaveLength(1);
    writes[0]!.reject(new TypeError("Synthetic queued log write failure."));
    await flushMicrotasks();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Hosted runtime durable log write failed.",
      {
        component: "runtime",
        errorName: "TypeError",
        eventCode: "runner.started",
      },
    );

    // The failed info write did not poison the chain: the next queued info
    // write still runs, and the drain resolves cleanly.
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
