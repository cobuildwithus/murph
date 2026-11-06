import { createServer } from "node:net";
import { performance } from "node:perf_hooks";

import { expect, it, vi } from "vitest";

it("bounds real Temporal retries after mailbox signal cancellation", async () => {
  vi.useRealTimers();
  vi.resetModules();
  // Isolate the real client's cached connection from ambient Temporal settings.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("HOSTED_TEMPORAL_") || key.startsWith("TEMPORAL_")) {
      vi.stubEnv(key, undefined);
    }
  }
  const port = await findRefusedLoopbackPort();
  vi.stubEnv("HOSTED_TEMPORAL_ADDRESS", `127.0.0.1:${port}`);
  vi.stubEnv("HOSTED_TEMPORAL_TLS_ENABLED", "false");

  const { Client } = await import("@temporalio/client");
  const {
    readHostedRuntimeTemporalSignalClientIfConfigured,
    withHostedRuntimeTemporalDeadline,
  } = await import("@/src/lib/hosted-orchestration/temporal-client");
  const { signalHostedMailboxAppendRuntime } = await import(
    "@/src/lib/hosted-orchestration/signal-runtime"
  );
  const client = await readHostedRuntimeTemporalSignalClientIfConfigured();
  expect(client).toBeInstanceOf(Client);
  if (!(client instanceof Client)) throw new Error("Expected a real Temporal client.");

  const controller = new AbortController();
  const startedAt = performance.now();
  const abortTimer = setTimeout(() => controller.abort(), 200);
  try {
    await expect(withHostedRuntimeTemporalDeadline(Date.now() + 1_500, () =>
      signalHostedMailboxAppendRuntime({
        abortSignal: controller.signal,
        knownCheckpoint: { lane: "system", laneSeq: "1", userId: "synthetic-member" },
        mailboxItemId: "synthetic-mailbox",
      }),
    )).rejects.toThrow();
    const elapsedMs = performance.now() - startedAt;
    expect(controller.signal.aborted).toBe(true);
    expect(elapsedMs).toBeLessThan(8_000);
  } finally {
    clearTimeout(abortTimer);
    await client.connection.close();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

async function findRefusedLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  if (!address || typeof address === "string") throw new Error("Expected a loopback port.");
  return address.port;
}
