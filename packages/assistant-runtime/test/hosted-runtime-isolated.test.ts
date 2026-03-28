import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mkdtemp: vi.fn(async () => "/tmp/hosted-runner-launch-test"),
  rm: vi.fn(async () => undefined),
  spawn: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: mocks.spawn,
}));

vi.mock("node:fs/promises", () => ({
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm,
}));

describe("runHostedAssistantRuntimeJobIsolated", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("launches the isolated child from a temp cwd with the absolute tsx preload and cleans up on success", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");
    const environmentModule = await import("../src/hosted-runtime/environment.ts");
    let stdinPayload = "";

    mocks.spawn.mockImplementation((_command, _args, _options) => {
      const child = createMockChildProcess({
        onStdinEnd: (payload) => {
          stdinPayload = payload;
          child.stdout.emit("data", runtimeModule.formatHostedRuntimeChildResult({
            ok: true,
            result: {
              bundles: {
                agentState: null,
                vault: null,
              },
              result: {
                eventsHandled: 1,
                nextWakeAt: null,
                summary: "ok",
              },
            },
          }));
          child.emit("close", 0);
        },
      });
      return child;
    });

    const input = createHostedRuntimeJobInput();
    const result = await runtimeModule.runHostedAssistantRuntimeJobIsolated(input);

    const [, childArgs, childOptions] = mocks.spawn.mock.calls[0] ?? [];
    expect(childArgs).toEqual([
      "--import",
      environmentModule.resolveHostedRuntimeTsxImportSpecifier(),
      environmentModule.resolveHostedRuntimeChildEntry(),
    ]);
    expect(childOptions.cwd).toBe("/tmp/hosted-runner-launch-test");
    expect(childOptions.cwd).not.toBe(process.cwd());
    expect(childOptions.env.TSX_TSCONFIG_PATH).toBe(
      environmentModule.resolveHostedRuntimeTsconfigPath(),
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });

    const parsedPayload = JSON.parse(stdinPayload) as {
      request: ReturnType<typeof createHostedRuntimeJobInput>["request"];
      runtime: {
        internalWorkerProxyToken: string | null;
      };
    };
    expect(parsedPayload.request).toEqual(input.request);
    expect(parsedPayload.runtime.internalWorkerProxyToken).toBe("runner-proxy-token");
    expect(result.result.summary).toBe("ok");
  });

  it("removes the temp launcher directory when the child output is invalid", async () => {
    const runtimeModule = await import("../src/hosted-runtime.ts");

    mocks.spawn.mockImplementation(() => {
      const child = createMockChildProcess({
        onStdinEnd: () => {
          child.stdout.emit("data", "not-a-valid-result");
          child.stderr.emit("data", "stderr-output");
          child.emit("close", 1);
        },
      });
      return child;
    });

    await assert.rejects(
      () => runtimeModule.runHostedAssistantRuntimeJobIsolated(createHostedRuntimeJobInput()),
      /did not emit a result payload/u,
    );
    expect(mocks.rm).toHaveBeenCalledWith("/tmp/hosted-runner-launch-test", {
      force: true,
      recursive: true,
    });
  });
});

function createMockChildProcess(input: {
  onStdinEnd: (payload: string) => void;
}) {
  const child = new EventEmitter() as EventEmitter & {
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
    stdin: EventEmitter & { end: (payload: string) => void };
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  };
  child.stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stderr.setEncoding = () => {};
  child.stdin = new EventEmitter() as EventEmitter & { end: (payload: string) => void };
  child.stdin.end = (payload: string) => {
    input.onStdinEnd(payload);
  };
  return child;
}

function createHostedRuntimeJobInput() {
  return {
    request: {
      bundles: {
        agentState: null,
        vault: null,
      },
      dispatch: {
        event: {
          kind: "member.activated" as const,
          userId: "member_123",
        },
        eventId: "evt_123",
        occurredAt: "2026-03-28T09:00:00.000Z",
      },
    },
    runtime: {
      forwardedEnv: {
        CUSTOM_ENV: "value",
      },
      internalWorkerProxyToken: "runner-proxy-token",
    },
  };
}
