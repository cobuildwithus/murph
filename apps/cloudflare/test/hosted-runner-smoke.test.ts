import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
} from "../src/hosted-runner-smoke-contract.js";

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
            childCwdIsIsolated: options.cwd.includes("hosted-runner-smoke-launch-"),
            codexAppServerHelpBytes: 2048,
            codexCommandDiscovered: true,
            codexHostedConfigShellEnvironmentPolicyAllowlisted: true,
            codexHostedCliSchemaVaultOptionHidden: true,
            codexHostedCliVaultCommandProofCount:
              HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
            codexHostedCliVaultWriteProofCount:
              HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
            codexHostedShellMurphPathBytes: 1536,
            codexHostedShellPythonVersion: "Python 3.11.2",
            codexHostedShellVaultCliLlmsBytes: 4096,
            codexVersion: "codex-cli 0.125.0",
            healthCommonsCatalogHash: "sha256:catalog",
            healthCommonsCliProtocolListBytes: 768,
            healthCommonsCliSearchBytes: 512,
            healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
            healthCommonsRuntimeProtocolHitKeys: [
              "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
            ],
            healthCommonsRuntimeSearchHitKeys: [
              "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
            ],
            murphCommandDiscovered: true,
            normalizedTranscriptMatchesExpectedSnippet: true,
            normalizedTranscriptProviderId: "whisper.cpp",
            normalizedTranscriptSha256: "c".repeat(64),
            operatorHomeRebound: true,
            pdfParserProviderId: "poppler.pdf",
            pdfTextSha256: "b".repeat(64),
            pythonVersion: "Python 3.11.2",
            reportedVaultIdMatchesExpected: true,
            schema: "murph.cloudflare-hosted-runner-smoke.v1",
            vaultCliCommandDiscovered: true,
            vaultRootRebound: true,
            vaultShowBytes: 128,
            wavTranscriptMatchesExpectedSnippet: true,
            wavTranscriptProviderId: "whisper.cpp",
            wavTranscriptSha256: "a".repeat(64),
          }),
        );
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedRunnerSmokeDetailed({
      bundle: "bundle-base64",
      expectedTranscriptSnippet: "hello",
      expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
      wavRelativePath: "raw/smoke/hosted-runner.wav",
    });

    expect(result.childCwdIsIsolated).toBe(true);
    expect(result.codexAppServerHelpBytes).toBe(2048);
    expect(result.codexCommandDiscovered).toBe(true);
    expect(result.codexHostedConfigShellEnvironmentPolicyAllowlisted).toBe(true);
    expect(result.codexHostedCliSchemaVaultOptionHidden).toBe(true);
    expect(result.codexHostedCliVaultCommandProofCount).toBe(
      HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
    );
    expect(result.codexHostedCliVaultWriteProofCount).toBe(
      HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
    );
    expect(result.codexHostedShellMurphPathBytes).toBe(1536);
    expect(result.codexHostedShellPythonVersion).toBe("Python 3.11.2");
    expect(result.codexHostedShellVaultCliLlmsBytes).toBe(4096);
    expect(result.codexVersion).toBe("codex-cli 0.125.0");
    expect(result.healthCommonsFinnishDrySaunaTitle).toBe("Finnish Dry Sauna");
    expect(result.murphCommandDiscovered).toBe(true);
    expect(result.normalizedTranscriptSha256).toBe("c".repeat(64));
    expect(result.pdfParserProviderId).toBe("poppler.pdf");
    expect(result.pythonVersion).toBe("Python 3.11.2");
    expect(result.wavTranscriptProviderId).toBe("whisper.cpp");
    expect(processKillSpy).toHaveBeenCalledWith(-5252, "SIGKILL");
  });
});
