import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("runHostedExecutionJobIsolatedDetailed", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  it("kills the child process group after a successful run so descendants cannot survive warm reuse", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4242;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stdout.end(module.formatHostedExecutionChildResult({
          ok: true,
          result: createRunnerResult(),
        }));
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedExecutionJobIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: {
        request: {
          bundle: null,
          dispatch: {
            event: {
              kind: "assistant.cron.tick",
              reason: "manual",
              userId: "member_123",
            },
            eventId: "evt_child_cleanup",
            occurredAt: "2026-04-08T00:00:00.000Z",
          },
        },
        runtime: {
          forwardedEnv: {},
          userEnv: {},
        },
      },
    });

    expect(result.result.result.summary).toBe("ok");
    expect(processKillSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
  });
});

function createRunnerResult() {
  return {
    result: {
      bundle: null,
      result: {
        eventsHandled: 1,
        nextWakeAt: null,
        summary: "ok",
      },
    },
    finalGatewayProjectionSnapshot: null,
  };
}
