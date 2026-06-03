import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

class CapturingWritable extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

interface StripeSpawnScript {
  readonly postCaptureStdoutChunks?: readonly string[];
  readonly stderrAfterCapture?: string;
  readonly stderrBeforeCapture?: string;
  readonly stdoutFirstLine: string;
  readonly stdoutFollowUp?: string;
}

function createStripeChild(script: StripeSpawnScript) {
  const child = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    killCalls: Array<NodeJS.Signals | number | undefined>;
    off: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
    pid: number;
    stderr: PassThrough;
    stdout: PassThrough;
  };
  child.killCalls = [];
  child.kill = (signal?: NodeJS.Signals | number): boolean => {
    child.killCalls.push(signal);
    return true;
  };
  child.pid = 9876;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();

  queueMicrotask(() => {
    if (script.stderrBeforeCapture) {
      child.stderr.write(script.stderrBeforeCapture);
    }
    child.stdout.write(script.stdoutFirstLine);
    queueMicrotask(() => {
      if (script.stdoutFollowUp) {
        child.stdout.write(script.stdoutFollowUp);
      }
      if (script.stderrAfterCapture) {
        child.stderr.write(script.stderrAfterCapture);
      }
      const postCapture = script.postCaptureStdoutChunks ?? [];
      for (const chunk of postCapture) {
        child.stdout.write(chunk);
      }
    });
  });

  return child;
}

async function loadRuntimeWithStripeChild(
  script: StripeSpawnScript | { __enoent: true },
) {
  const spawn = vi.fn(() => {
    if ("__enoent" in script) {
      const child = new EventEmitter() as EventEmitter & {
        kill: () => boolean;
        off: (event: string, listener: (...args: unknown[]) => void) => EventEmitter;
        pid: number;
        stderr: PassThrough;
        stdout: PassThrough;
      };
      child.kill = () => true;
      child.pid = 0;
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        const err = new Error("spawn stripe ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        child.emit("error", err);
      });
      return child;
    }
    return createStripeChild(script);
  });

  vi.doMock("node:child_process", async () => {
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    return { ...actual, spawn };
  });

  const runtime = await import("../../src/dev-hosted-local/runtime.ts");
  return { runtime, spawn };
}

describe("spawnStripeListenerWithSecretCapture", () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:child_process");
  });

  it("captures the whsec from listener stdout and redacts it from piped output", async () => {
    const { runtime } = await loadRuntimeWithStripeChild({
      stdoutFirstLine:
        "> Ready! You are using Stripe API Version [2026-04-20]. Your webhook signing secret is whsec_test_secret_value_abc (^C to quit)\n",
      stdoutFollowUp: "2026-04-21 17:00:00   --> customer.subscription.created [whsec_test_secret_value_abc]\n",
    });

    const stdoutTarget = new CapturingWritable();
    const stderrTarget = new CapturingWritable();

    const result = await runtime.spawnStripeListenerWithSecretCapture({
      args: ["listen", "--forward-to", "http://localhost:3000/api/hosted-onboarding/stripe/webhook"],
      command: "stripe",
      env: { PATH: process.env.PATH ?? "" },
      pipeOutput: true,
      stderrTarget,
      stdoutTarget,
      timeoutMs: 2_000,
    });

    // Give the PassThrough a tick to flush the follow-up chunk
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.secret).toBe("whsec_test_secret_value_abc");

    const piped = stdoutTarget.text();
    expect(piped).not.toContain("whsec_test_secret_value_abc");
    expect(piped).toContain("[redacted whsec]");

    const buffered = result.child.stdoutText();
    expect(buffered).not.toContain("whsec_test_secret_value_abc");
    expect(buffered).toContain("[redacted whsec]");

    expect(stderrTarget.text()).not.toContain("whsec_test_secret_value_abc");
  });

  it("captures the whsec when the Stripe CLI prints the startup banner to stderr", async () => {
    // Current Stripe CLI (1.34+) prints the "Ready! ... whsec_..." banner on
    // stderr, not stdout. The capture helper must scan both streams so this
    // release keeps working.
    const { runtime } = await loadRuntimeWithStripeChild({
      stdoutFirstLine: "",
      stderrBeforeCapture:
        "Getting ready...\nReady! You are using Stripe API Version [2023-10-16]. Your webhook signing secret is whsec_only_on_stderr_0123456789abcdef (^C to quit)\n",
    });

    const stdoutTarget = new CapturingWritable();
    const stderrTarget = new CapturingWritable();

    const result = await runtime.spawnStripeListenerWithSecretCapture({
      args: ["listen"],
      command: "stripe",
      env: {},
      pipeOutput: true,
      stderrTarget,
      stdoutTarget,
      timeoutMs: 2_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.secret).toBe("whsec_only_on_stderr_0123456789abcdef");
    expect(stderrTarget.text()).not.toContain("whsec_only_on_stderr");
    expect(stderrTarget.text()).toContain("[redacted whsec]");
    expect(result.child.stderrText()).not.toContain("whsec_only_on_stderr");
  });

  it("rejects with StripeCliMissingError when stripe is not on PATH", async () => {
    const { runtime } = await loadRuntimeWithStripeChild({ __enoent: true });

    await expect(
      runtime.spawnStripeListenerWithSecretCapture({
        args: ["listen"],
        command: "stripe",
        env: {},
        timeoutMs: 1_000,
      }),
    ).rejects.toBeInstanceOf(runtime.StripeCliMissingError);
  });

  it("times out cleanly when no whsec ever appears", async () => {
    const { runtime } = await loadRuntimeWithStripeChild({
      stdoutFirstLine: "> Listening for events on http://localhost:3000 (no secret yet)\n",
    });

    await expect(
      runtime.spawnStripeListenerWithSecretCapture({
        args: ["listen"],
        command: "stripe",
        env: {},
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/stripe listen did not print a webhook signing secret/);
  });

  it("kills the stripe child on timeout so it does not outlive the caller", async () => {
    const spawnedChildren: ReturnType<typeof createStripeChild>[] = [];
    const spawn = vi.fn(() => {
      const child = createStripeChild({
        stdoutFirstLine: "> Listening for events (format changed, no whsec emitted)\n",
      });
      spawnedChildren.push(child);
      return child;
    });
    vi.doMock("node:child_process", async () => {
      const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
      return { ...actual, spawn };
    });

    const runtime = await import("../../src/dev-hosted-local/runtime.ts");
    await expect(
      runtime.spawnStripeListenerWithSecretCapture({
        args: ["listen"],
        command: "stripe",
        env: {},
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/did not print a webhook signing secret/);

    expect(spawnedChildren).toHaveLength(1);
    expect(spawnedChildren[0]!.killCalls).toEqual(["SIGTERM"]);
  });

  it("redacts a whsec that is split across chunk boundaries after capture", async () => {
    const { runtime } = await loadRuntimeWithStripeChild({
      stdoutFirstLine:
        "> Ready! You are using Stripe API Version [2026-04-20]. Your webhook signing secret is whsec_split_boundary_xyz (^C to quit)\n",
      // After capture, the same secret is emitted but split across two chunks
      // mid-token. A chunk-local redactor would miss this because neither chunk
      // contains the full substring; only the reassembled line does.
      postCaptureStdoutChunks: [
        "2026-04-21 18:00:00   --> event_1 [whsec_split_",
        "boundary_xyz] hello\n",
      ],
    });

    const stdoutTarget = new CapturingWritable();
    const stderrTarget = new CapturingWritable();

    const result = await runtime.spawnStripeListenerWithSecretCapture({
      args: ["listen"],
      command: "stripe",
      env: {},
      pipeOutput: true,
      stderrTarget,
      stdoutTarget,
      timeoutMs: 2_000,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.secret).toBe("whsec_split_boundary_xyz");

    const piped = stdoutTarget.text();
    expect(piped).not.toContain("whsec_split_boundary_xyz");
    expect(piped).toContain("[redacted whsec]");

    const buffered = result.child.stdoutText();
    expect(buffered).not.toContain("whsec_split_boundary_xyz");
    expect(buffered).toContain("[redacted whsec]");
  });
});
