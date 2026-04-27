import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedExecutionWorkspaceInvocationJobInput } from "../src/runner-job-transport.ts";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

describe("runHostedWorkspaceInvocationIsolatedDetailed", () => {
  afterEach(() => {
    spawnMock.mockReset();
    vi.restoreAllMocks();
  });

  function createWorkspaceJob(eventId: string): HostedExecutionWorkspaceInvocationJobInput {
    return {
      kind: "workspace-invocation",
      request: {
        attemptId: `attempt_${eventId}`,
        leaseGeneration: "1",
        reason: "nudge",
        userId: "member_123",
        workspaceVersion: "0",
      },
      runtime: {
        forwardedEnv: {},
        userEnv: {},
      },
    };
  }

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

    const result = await module.runHostedWorkspaceInvocationIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: createWorkspaceJob("evt_child_cleanup"),
    });

    expect(result.status).toBe("idle");
    expect(processKillSpy).toHaveBeenCalledWith(-4242, "SIGKILL");
  });

  it("passes only the normalized runtime env into the isolated child env", async () => {
    vi.stubEnv("HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK", '{"kty":"EC"}');
    vi.stubEnv("HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK", '{"kty":"EC","x":"pub","y":"pub"}');
    vi.stubEnv("HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK", '{"kty":"EC","x":"recovery","y":"recovery"}');
    vi.stubEnv("HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY", "platform-key");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", "development");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL", "http://127.0.0.1:4010/.well-known/jwks");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME", "murph-web");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG", "murph-team");
    vi.stubEnv("HOSTED_WAKE_ENCRYPTION_KEY", Buffer.alloc(32, 5).toString("base64url"));
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK", '{"kty":"EC","d":"secret"}');
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://ambient.example.test");
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation((_command, _args, options) => {
      expect(options?.env).toMatchObject({
        HOSTED_WEB_BASE_URL: "https://forwarded.example.test",
        OPENAI_API_KEY: "openai-key",
      });
      expect(options?.env?.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBeUndefined();
      expect(options?.env?.HOSTED_WAKE_ENCRYPTION_KEY).toBeUndefined();
      expect(options?.env?.HOSTED_WAKE_ENCRYPTION_KEYRING_JSON).toBeUndefined();
      expect(options?.env?.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();

      const child = new EventEmitter() as EventEmitter & {
        kill: ReturnType<typeof vi.fn>;
        pid: number;
        stderr: PassThrough;
        stdin: PassThrough;
        stdout: PassThrough;
      };
      child.kill = vi.fn();
      child.pid = 4245;
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

    await module.runHostedWorkspaceInvocationIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: {
        ...createWorkspaceJob("evt_child_env"),
        runtime: {
          forwardedEnv: {
            HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "platform-key",
            HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEYRING_JSON: "{}",
            HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
            HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: '{"kty":"EC","x":"recovery","y":"recovery"}',
            HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
            HOSTED_WAKE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
            HOSTED_WAKE_ENCRYPTION_KEYRING_JSON: "{}",
            HOSTED_WEB_BASE_URL: "https://forwarded.example.test",
            HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"secret"}',
            OPENAI_API_KEY: "openai-key",
          },
          userEnv: {},
        },
      },
    });
  });

  it("rejects legacy child results at the isolated runner boundary", async () => {
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
      child.pid = 4246;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stdout.end(formatLegacyChildResult({
          result: {
            bundle: null,
            result: {
              eventsHandled: 1,
              nextWakeAt: null,
              summary: "ok",
            },
          },
          finalGatewayProjectionSnapshot: null,
        }));
        child.emit("close", 0);
      });

      return child;
    });

    await expect(module.runHostedWorkspaceInvocationIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: createWorkspaceJob("evt_child_legacy_result"),
    })).rejects.toThrow("Hosted workspace invocation result");

    expect(processKillSpy).toHaveBeenCalledWith(-4246, "SIGKILL");
  });

});

function createRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function formatLegacyChildResult(result: unknown): string {
  return `__HB_ASSISTANT_RUNTIME_RESULT__${Buffer.from(
    JSON.stringify({
      ok: true,
      result,
    }),
    "utf8",
  ).toString("base64")}`;
}
