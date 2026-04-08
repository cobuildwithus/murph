import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("runHostedRunnerSmokeDetailed", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  it("spawns a temp-cwd child and returns the parsed smoke result", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const module = await import("../src/hosted-runner-smoke.ts");

    spawnMock.mockImplementation((_file: string, _args: string[], options: { cwd: string }) => {
      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 5252;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stdout.end(
          JSON.stringify({
            childCwd: options.cwd,
            expectedPdfText: "fixture text",
            murphBin: "/app/node_modules/.bin/murph",
            normalizedTranscript: "hello murph smoke test",
            operatorHomeRoot: "/tmp/home",
            pdfText: "fixture text",
            reportedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
            schema: "murph.cloudflare-hosted-runner-smoke.v1",
            vaultCliBin: "/app/node_modules/.bin/vault-cli",
            vaultRoot: "/tmp/vault",
            vaultShowBytes: 128,
            wavTranscript: "hello murph smoke test",
          }),
        );
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedRunnerSmokeDetailed({
      bundle: "bundle-base64",
      expectedPdfText: "fixture text",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      pdfRelativePath: "raw/smoke/hosted-runner.pdf",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    });

    expect(result.childCwd).toMatch(/hosted-runner-smoke-launch-/u);
    expect(result.murphBin).toContain("murph");
    expect(processKillSpy).toHaveBeenCalledWith(-5252, "SIGKILL");
  });
});
