import { lstatSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";
import {
  HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_COMMAND_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_CLI_VAULT_WRITE_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT,
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT,
  HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
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
    const restoredEnv = new Map([
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
      "LD_PRELOAD",
      "MURPH_SMOKE_AMBIENT_POISON",
      "NODE_OPTIONS",
      "OPENAI_API_KEY",
      HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV,
    ].map((key) => [key, process.env[key]]));
    process.env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK = "fixture-callback-secret";
    process.env.LD_PRELOAD = "/tmp/fixture-preload.so";
    process.env.MURPH_SMOKE_AMBIENT_POISON = "fixture-poison";
    process.env.NODE_OPTIONS = "--require fixture-poison";
    process.env.OPENAI_API_KEY = "fixture-openai-secret";
    process.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV] =
      "/usr/local/share/murph/codex-model-catalog.openai-flex.json";
    const module = await import("../src/hosted-runner-smoke.ts");

    spawnMock.mockImplementation((_file: string, _args: string[], options: {
      cwd: string;
      env: Record<string, string | undefined>;
    }) => {
      const expectedLauncherEnv = {
        HF_HOME: path.join(options.cwd, "hf-home"),
        HOME: path.join(options.cwd, "home"),
        TEMP: path.join(options.cwd, "tmp"),
        TMP: path.join(options.cwd, "tmp"),
        TMPDIR: path.join(options.cwd, "tmp"),
        XDG_CACHE_HOME: path.join(options.cwd, "cache"),
      };
      expect(options.env).toMatchObject(expectedLauncherEnv);
      expect(options.env[HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]).toBe(
        "/usr/local/share/murph/codex-model-catalog.openai-flex.json",
      );
      expect(options.env.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
      expect(options.env.LD_PRELOAD).toBeUndefined();
      expect(options.env.MURPH_SMOKE_AMBIENT_POISON).toBeUndefined();
      expect(options.env.NODE_OPTIONS).toBeUndefined();
      expect(options.env.OPENAI_API_KEY).toBeUndefined();
      for (const directory of new Set(Object.values(expectedLauncherEnv))) {
        const entry = lstatSync(directory);
        expect(entry.isDirectory()).toBe(true);
        expect(entry.isSymbolicLink()).toBe(false);
        expect(entry.mode & 0o777).toBe(0o700);
      }

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
            audioNormalizedMp3Bytes: 9216,
            audioPreparedWavBytes: 35328,
            childCwdIsIsolated: options.cwd.includes("hosted-runner-smoke-launch-"),
            codexAppServerHelpBytes: 2048,
            codexCommandDiscovered: true,
            codexGroupReadAuthorizedFileRead: true,
            codexGroupReadDeepEnvReadDenied: true,
            codexGroupReadGroupWriteDenied: true,
            codexGroupReadNetworkDenied: true,
            codexGroupReadOutsideRootReadDenied: true,
            codexGroupReadPermissionProfileAttested: true,
            codexGroupReadRuntimeReadDenied: true,
            codexGroupReadSecretEnvironmentDenied: true,
            codexGroupReadSiblingRootReadDenied: true,
            codexMemberWorkspaceAutomationMutationDeniedCount:
              HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT,
            codexMemberWorkspaceAutomationReadProofCount:
              HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT,
            codexMemberWorkspaceAutomationTreeUnchanged: true,
            codexMemberWorkspaceLocalMutationProofCount:
              HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
            codexMemberWorkspacePermissionProfileAttested: true,
            codexMemberWorkspacePreloadBypassDenied: true,
            codexMemberWorkspaceTempWriteAllowed: true,
            codexMemberWorkspaceVaultWriteAllowed: true,
            codexHostedCliSurfaceContractBytes: 37282,
            codexHostedCliSurfaceHotPathProofCount:
              HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
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
            healthCommonsFinnishDrySaunaTitle: "Finnish Dry Sauna",
            healthCommonsRuntimeProtocolHitKeys: [
              "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
            ],
            healthCommonsRuntimeSearchHitKeys: [
              "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
            ],
            murphCommandDiscovered: true,
            operatorHomeRebound: true,
            pdfParserProviderId: "poppler.pdf",
            pdfTextSha256: "b".repeat(64),
            pythonVersion: "Python 3.11.2",
            reportedVaultIdMatchesExpected: true,
            ripgrepCommandDiscovered: true,
            ripgrepVersion: "ripgrep 13.0.0",
            schema: "murph.cloudflare-hosted-runner-smoke.v1",
            vaultCliCommandDiscovered: true,
            vaultRootRebound: true,
            vaultShowBytes: 128,
          }),
        );
        child.emit("close", 0);
      });

      return child;
    });

    try {
      const result = await module.runHostedRunnerSmokeDetailed({
        bundle: "bundle-base64",
        expectedVaultId: "vault_01JNV40W8VFYQ2H7CMJY5A9R4K",
        wavRelativePath: "raw/smoke/hosted-runner.wav",
      });

      expect(result.childCwdIsIsolated).toBe(true);
      expect(result.codexAppServerHelpBytes).toBe(2048);
      expect(result.codexCommandDiscovered).toBe(true);
      expect(result.codexGroupReadAuthorizedFileRead).toBe(true);
      expect(result.codexGroupReadDeepEnvReadDenied).toBe(true);
      expect(result.codexGroupReadGroupWriteDenied).toBe(true);
      expect(result.codexGroupReadNetworkDenied).toBe(true);
      expect(result.codexGroupReadOutsideRootReadDenied).toBe(true);
      expect(result.codexGroupReadPermissionProfileAttested).toBe(true);
      expect(result.codexGroupReadRuntimeReadDenied).toBe(true);
      expect(result.codexGroupReadSecretEnvironmentDenied).toBe(true);
      expect(result.codexGroupReadSiblingRootReadDenied).toBe(true);
      expect(result.codexMemberWorkspaceAutomationMutationDeniedCount).toBe(
        HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_MUTATION_DENIED_COUNT,
      );
      expect(result.codexMemberWorkspaceAutomationReadProofCount).toBe(
        HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_AUTOMATION_READ_PROOF_COUNT,
      );
      expect(result.codexMemberWorkspaceAutomationTreeUnchanged).toBe(true);
      expect(result.codexMemberWorkspaceLocalMutationProofCount).toBe(
        HOSTED_RUNNER_SMOKE_MEMBER_WORKSPACE_LOCAL_MUTATION_PROOF_COUNT,
      );
      expect(result.codexMemberWorkspacePermissionProfileAttested).toBe(true);
      expect(result.codexMemberWorkspacePreloadBypassDenied).toBe(true);
      expect(result.codexMemberWorkspaceTempWriteAllowed).toBe(true);
      expect(result.codexMemberWorkspaceVaultWriteAllowed).toBe(true);
      expect(result.codexHostedCliSurfaceContractBytes).toBe(37282);
      expect(result.codexHostedCliSurfaceHotPathProofCount).toBe(
        HOSTED_RUNNER_SMOKE_CLI_SURFACE_HOT_PATH_PROOF_COUNT,
      );
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
      expect(result.audioNormalizedMp3Bytes).toBe(9216);
      expect(result.audioPreparedWavBytes).toBe(35328);
      expect(result.pdfParserProviderId).toBe("poppler.pdf");
      expect(result.pythonVersion).toBe("Python 3.11.2");
      expect(result.ripgrepVersion).toBe("ripgrep 13.0.0");
      expect(processKillSpy).toHaveBeenCalledWith(-5252, "SIGKILL");
    } finally {
      for (const [key, value] of restoredEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });
});
