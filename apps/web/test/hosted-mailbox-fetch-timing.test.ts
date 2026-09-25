import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { runWithHostedMailboxFetchTiming } from "../src/lib/hosted-mailbox/fetch-timing";
import { recordPrismaOperationTiming, startPrismaPoolAcquisitionTiming } from "../src/lib/prisma-operation-timing";

afterEach(() => vi.restoreAllMocks());

function request(signedAt = "2026-09-21T12:00:00.000Z") {
  return new Request("https://web.example.test/api/internal/hosted-mailbox/fetch?private=excluded", {
    method: "POST", body: "private payload excluded",
    headers: { [HOSTED_EXECUTION_TIMESTAMP_HEADER]: signedAt, "x-hosted-execution-user-id": "private-member-excluded" },
  });
}

describe("mailbox fetch timing", () => {
  it("separates transport/startup age, phases, pool acquisition and query time without payloads", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-21T12:00:02.000Z"));
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const response = await runWithHostedMailboxFetchTiming(request(), async timing => {
      clock = 10;
      const acquired = startPrismaPoolAcquisitionTiming({ idleConnections: 0, totalConnections: 0, waitingRequests: 0 });
      clock = 410;
      acquired?.();
      recordPrismaOperationTiming("$queryRaw", 420);
      clock = 430;
      timing.authenticated();
      timing.start("transaction_acquire");
      clock = 450;
      timing.start("authority");
      clock = 700;
      timing.start("mailbox");
      clock = 705;
      return "response";
    });
    expect(response).toBe("response");
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      event: "hosted-mailbox.fetch.timing", completed: true, failedPhase: null,
      signedRequestToHandlerMs: 2000, totalMs: 705,
      phaseMs: { authentication: 430, transaction_acquire: 20, authority: 250, mailbox: 5 },
      poolAcquisitionCount: 1, poolAcquireMs: [400], dbOperationCount: 1, dbTotalMs: 420,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("logs pre-handler delay even when handler work is fast", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-21T12:00:03.000Z"));
    vi.spyOn(performance, "now").mockReturnValue(0);
    await runWithHostedMailboxFetchTiming(request(), async timing => { timing.authenticated(); });
    expect(log.mock.calls[0]?.[1]).toMatchObject({ totalMs: 0, signedRequestToHandlerMs: 3000 });
  });

  it("retains the failed lock phase through rollback and never trusts a rejected signature timestamp", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const failure = new Error("private error excluded");
    await expect(runWithHostedMailboxFetchTiming(request(), async timing => {
      timing.start("authority");
      timing.failed();
      timing.start("transaction_finish");
      throw failure;
    })).rejects.toBe(failure);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      completed: false, failedPhase: "authority", signedAt: null, signedRequestToHandlerMs: null,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("isolates overlapping requests and pool callbacks that complete from another scope", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-21T12:00:02.000Z"));
    let finish: () => void = () => {};
    let acquired: (() => void) | null = null;
    const pending = runWithHostedMailboxFetchTiming(request(), async timing => {
      timing.authenticated();
      acquired = startPrismaPoolAcquisitionTiming({ idleConnections: 0, totalConnections: 0, waitingRequests: 0 });
      await new Promise<void>(resolve => { finish = resolve; });
      recordPrismaOperationTiming("first", 31);
    });
    await runWithHostedMailboxFetchTiming(request(), async timing => {
      timing.authenticated();
      acquired?.();
      recordPrismaOperationTiming("second", 7);
    });
    finish();
    await pending;
    expect(log.mock.calls[0]?.[1]).toMatchObject({ dbTotalMs: 7, poolAcquisitionCount: 0 });
    expect(log.mock.calls[1]?.[1]).toMatchObject({ dbTotalMs: 31, poolAcquisitionCount: 1 });
  });

  it("keeps logging failures from replacing success or the original failure", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log unavailable"); });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-21T12:00:02.000Z"));
    await expect(runWithHostedMailboxFetchTiming(request(), async timing => {
      timing.authenticated(); return "ok";
    })).resolves.toBe("ok");
    const failure = new Error("original failure");
    await expect(runWithHostedMailboxFetchTiming(request(), async () => { throw failure; })).rejects.toBe(failure);
  });
});
