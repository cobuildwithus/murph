import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_TIMESTAMP_HEADER } from "@murphai/hosted-execution/contracts";
import { runWithHostedWorkspaceReadTiming } from "../src/lib/hosted-workspace/read-timing";
import { recordPrismaOperationTiming, startPrismaPoolAcquisitionTiming } from "../src/lib/prisma-operation-timing";

afterEach(() => vi.restoreAllMocks());

function request() {
  return new Request("https://web.example.test/api/internal/hosted-workspace?private=excluded", {
    headers: {
      [HOSTED_EXECUTION_TIMESTAMP_HEADER]: "2026-09-01T12:00:00.000Z",
      "x-hosted-execution-user-id": "private-member-excluded",
    },
  });
}

function observe() {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-01T12:00:02.000Z"));
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  return { log, advance: (ms: number) => { clock += ms; } };
}

describe("workspace callback timing", () => {
  it("separates verified pre-handler age, pool and query time from overlapping reads", async () => {
    const { log, advance } = observe();
    const expected = Response.json({ ok: true });
    const response = await runWithHostedWorkspaceReadTiming(request(), async timing => {
      await timing.measure("authentication", () => {
        const acquired = startPrismaPoolAcquisitionTiming({ idleConnections: 0, totalConnections: 0, waitingRequests: 0 });
        advance(300);
        acquired?.();
        advance(20);
        recordPrismaOperationTiming("$queryRaw", 320);
      });
      timing.authenticated();
      let releaseWorkspace!: () => void;
      const workspace = timing.measure("workspace", async () => {
        await new Promise<void>(resolve => { releaseWorkspace = resolve; });
        recordPrismaOperationTiming("HostedWorkspace.findUnique", 500);
      });
      await timing.measure("usage", () => {
        advance(200);
        recordPrismaOperationTiming("HostedMember.findUnique", 200);
      });
      advance(300);
      releaseWorkspace();
      await workspace;
      return timing.measure("response", () => { advance(5); return expected; });
    });
    expect(response).toBe(expected);
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      completed: true, failedPhase: null, pendingPhases: [],
      signedRequestToHandlerMs: 2000, totalMs: 825,
      phaseMs: { authentication: 320, workspace: 500, usage: 200, response: 5 },
      poolAcquireMs: [300], dbOperationCount: 3, dbTotalMs: 1020,
    });
    expect(response.headers.get("Server-Timing")).toContain("murph_workspace_total;dur=825");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("does not trust timestamps or start reads after rejected authentication", async () => {
    const { log } = observe();
    const failure = new Error("private rejected signature");
    const read = vi.fn();
    await expect(runWithHostedWorkspaceReadTiming(request(), async timing => {
      await timing.measure("authentication", () => { throw failure; });
      timing.authenticated();
      return read();
    })).rejects.toBe(failure);
    expect(read).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      completed: false, failedPhase: "authentication", signedAt: null, signedRequestToHandlerMs: null,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("reports pending siblings without delaying or replacing the first read failure", async () => {
    const { log } = observe();
    let release!: () => void;
    let sibling!: Promise<void>;
    const failure = new Error("private query failure");
    await expect(runWithHostedWorkspaceReadTiming(request(), async timing => {
      timing.authenticated();
      sibling = timing.measure("workspace", () => new Promise<void>(resolve => { release = resolve; }));
      await Promise.all([sibling, timing.measure("configuration", () => { throw failure; })]);
      return new Response();
    })).rejects.toBe(failure);
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      completed: false, failedPhase: "configuration", pendingPhases: ["workspace"],
    });
    release();
    await sibling;
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });

  it("isolates overlapping requests and caps query/pool samples", async () => {
    const { log } = observe();
    let release!: () => void;
    const first = runWithHostedWorkspaceReadTiming(request(), async timing => {
      timing.authenticated();
      await new Promise<void>(resolve => { release = resolve; });
      recordPrismaOperationTiming("first", 31);
      return new Response();
    });
    await runWithHostedWorkspaceReadTiming(request(), async timing => {
      timing.authenticated();
      for (let i = 0; i < 30; i++) {
        recordPrismaOperationTiming("second", 7);
        startPrismaPoolAcquisitionTiming({ idleConnections: 1, totalConnections: 1, waitingRequests: 0 })?.();
      }
      return new Response();
    });
    release();
    await first;
    expect(log.mock.calls[0]?.[1]).toMatchObject({
      dbTotalMs: 210, dbOperationCount: 30, dbOperationsTruncated: true, poolAcquisitionCount: 30,
      poolAcquireMs: Array(24).fill(0),
    });
    expect(log.mock.calls[1]?.[1]).toMatchObject({ dbTotalMs: 31, dbOperationCount: 1, poolAcquisitionCount: 0 });
  });

  it("keeps diagnostics failures from replacing success and original failures", async () => {
    observe();
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("log unavailable"); });
    const response = new Response();
    vi.spyOn(response.headers, "set").mockImplementation(() => { throw new Error("immutable headers"); });
    await expect(runWithHostedWorkspaceReadTiming(request(), async () => response)).resolves.toBe(response);
    const failure = new Error("original failure");
    await expect(runWithHostedWorkspaceReadTiming(request(), async () => { throw failure; })).rejects.toBe(failure);
  });

  it("logs slow pre-handler age but keeps fast subsequent requests quiet", async () => {
    const { log } = observe();
    await runWithHostedWorkspaceReadTiming(request(), async timing => { timing.authenticated(); return new Response(); });
    expect(log.mock.calls[0]?.[1]).toMatchObject({ totalMs: 0, signedRequestToHandlerMs: 2000 });
    log.mockClear();
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-01T12:00:00.000Z"));
    await runWithHostedWorkspaceReadTiming(request(), async timing => { timing.authenticated(); return new Response(); });
    expect(log).not.toHaveBeenCalled();
  });
});

