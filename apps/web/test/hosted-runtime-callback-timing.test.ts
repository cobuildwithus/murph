import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { createHostedRuntimeCallbackTiming } from "../src/lib/hosted-execution/runtime-callback-timing";
import { recordPrismaOperationTiming, startPrismaPoolAcquisitionTiming } from "../src/lib/prisma-operation-timing";

const epoch = Date.parse("2026-01-01T00:00:00.000Z");
function request() {
  return new Request("https://example.test/callback?private=do-not-log", {
    headers: { [HOSTED_EXECUTION_TIMESTAMP_HEADER]: new Date(epoch - 800).toISOString() },
  });
}
afterEach(() => vi.restoreAllMocks());

describe("runtime callback timing", () => {
  it("separates signed request age, authentication, work and bounded database/pool evidence", async () => {
    vi.spyOn(Date, "now").mockReturnValue(epoch);
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = createHostedRuntimeCallbackTiming("owner");
    const response = new Response("private-response");
    expect(await run(request(), async (timing) => {
      now = 20;
      timing.authenticated();
      for (let index = 0; index < 30; index++) {
        const acquired = startPrismaPoolAcquisitionTiming({ idleConnections: 0, totalConnections: 1, waitingRequests: 2 });
        now += 5;
        acquired?.();
        recordPrismaOperationTiming("$queryRaw", 6);
      }
      now = 240;
      return response;
    })).toBe(response);
    expect(log).toHaveBeenCalledOnce();
    const details = log.mock.calls[0]![1];
    expect(details).toMatchObject({ route: "owner", completed: true, firstRequestInModule: true,
      signedRequestToHandlerMs: 800, authenticationMs: 20, workMs: 220, totalMs: 240,
      dbOperationCount: 30, dbTotalMs: 180, dbOperationsTruncated: true, poolAcquisitionCount: 30 });
    expect(details.poolAcquireMs).toEqual(Array(24).fill(5));
    expect(details.poolBeforeAcquire).toHaveLength(24);
    expect(JSON.stringify(details)).not.toContain("private");
    expect(response.headers.has("server-timing")).toBe(false);
  });

  it("logs slow signed arrival even for a fast warm handler, and suppresses ordinary warm calls", async () => {
    vi.spyOn(Date, "now").mockReturnValue(epoch);
    vi.spyOn(performance, "now").mockReturnValue(0);
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = createHostedRuntimeCallbackTiming("checkpoint");
    const fast = new Request("https://example.test/callback");
    await run(fast, async (timing) => { timing.authenticated(); return 1; });
    await run(fast, async (timing) => { timing.authenticated(); return 2; });
    await run(request(), async (timing) => { timing.authenticated(); return 3; });
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[1]![1]).toMatchObject({ firstRequestInModule: false, totalMs: 0, signedRequestToHandlerMs: 800 });
    expect(log.mock.calls[1]![1]).not.toHaveProperty("dbOperationCount");
  });

  it("preserves authentication errors and does not trust the signed timestamp before verification", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const run = createHostedRuntimeCallbackTiming("owner");
    const error = new Error("private-auth-error");
    await expect(run(request(), async () => { throw error; })).rejects.toBe(error);
    expect(console.info).toHaveBeenCalledWith("Hosted runtime callback timing.", expect.objectContaining({
      completed: false, signedRequestToHandlerMs: null, workMs: null,
    }));
    vi.mocked(console.info).mockImplementation(() => { throw new Error("logging failure"); });
    await expect(run(request(), async () => { throw error; })).rejects.toBe(error);
    await expect(run(request(), async (timing) => { timing.authenticated(); return "ok"; })).resolves.toBe("ok");
  });
});
