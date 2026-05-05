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
    vi.stubEnv("HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK", '{"kty":"EC"}');
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT", "development");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL", "http://127.0.0.1:4010/.well-known/jwks");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME", "murph-web");
    vi.stubEnv("HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG", "murph-team");
    vi.stubEnv("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK", '{"kty":"EC","d":"secret"}');
    vi.stubEnv("HOSTED_WEB_BASE_URL", "https://ambient.example.test");
    const module = await import("../src/node-runner-isolated.ts");

    spawnMock.mockImplementation((_command, _args, options) => {
      expect(options?.env).toMatchObject({
        OPENAI_API_KEY: "vercel-key",
      });
      expect(options?.env?.CODEX_HOME).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL).toBeUndefined();
      expect(options?.env?.HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME).toBeUndefined();
      expect(options?.env?.HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG).toBeUndefined();
      expect(options?.env?.HOSTED_WEB_BASE_URL).toBeUndefined();
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
            CODEX_HOME: "/tmp/forwarded-codex-home",
            HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private-jwk",
            HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
            HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: "http://127.0.0.1:4010/.well-known/jwks",
            HOSTED_WEB_BASE_URL: "https://forwarded.example.test",
            HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: '{"kty":"EC","d":"secret"}',
            OPENAI_API_KEY: "vercel-key",
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

  it("redacts isolated child stderr before forwarding it to runner logs", async () => {
    const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
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
      child.pid = 4248;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stderr.write("Bearer secret-token\n");
        child.stderr.write(
          "OPENAI_API_KEY=secret-value person@example.test +15555550123 /tmp/hosted-runner/path",
        );
        child.stderr.end();
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
      job: createWorkspaceJob("evt_child_stderr_redaction"),
    });

    const forwarded = stderrWriteSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(forwarded).toContain("Bearer <redacted>");
    expect(forwarded).toContain("OPENAI_API_KEY=<redacted>");
    expect(forwarded).toContain("<redacted-email>");
    expect(forwarded).toContain("<redacted-phone>");
    expect(forwarded).toContain("<redacted-path>");
    expect(forwarded).not.toContain("secret-token");
    expect(forwarded).not.toContain("secret-value");
    expect(forwarded).not.toContain("person@example.test");
    expect(forwarded).not.toContain("+15555550123");
    expect(forwarded).not.toContain("/tmp/hosted-runner/path");
    expect(processKillSpy).toHaveBeenCalledWith(-4248, "SIGKILL");
  });

  it("redacts child failure payload diagnostics before rethrowing them", async () => {
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
      child.pid = 4249;
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      queueMicrotask(() => {
        child.stdout.end(module.formatHostedExecutionChildResult({
          ok: false,
          error: {
            details: {
              errorDetail:
                "Bearer detail-token /tmp/hosted-runner/detail-path",
            },
            message:
              "OPENAI_API_KEY=secret-value model_provider = openai /tmp/hosted-runner/private-file",
            name: "Error",
            stack:
              "Error: failed\n    at run (/tmp/hosted-runner/private-file.ts:7:3)",
          },
        }));
        child.emit("close", 1);
      });

      return child;
    });

    let thrown: (Error & { details?: Record<string, unknown> | null }) | null = null;
    try {
      await module.runHostedWorkspaceInvocationIsolatedDetailed({
        internalWorkerProxyToken: "proxy-token",
        job: createWorkspaceJob("evt_child_failure_redaction"),
      });
      throw new Error("Expected isolated child failure to throw.");
    } catch (error) {
      thrown = error as Error & { details?: Record<string, unknown> | null };
    }

    if (!thrown) {
      throw new Error("Expected isolated child failure to throw.");
    }

    expect(thrown.message).toContain("OPENAI_API_KEY=<redacted>");
    expect(thrown.message).toContain("model_provider=<redacted>");
    expect(thrown.message).toContain("<redacted-path>");
    expect(thrown.stack).toContain("<redacted-path>");
    expect(thrown.details?.errorDetail).toBe(
      "Bearer <redacted> <redacted-path>",
    );
    expect(thrown.message).not.toContain("secret-value");
    expect(thrown.message).not.toContain("openai");
    expect(thrown.message).not.toContain("/tmp/hosted-runner/private-file");
    expect(thrown.stack ?? "").not.toContain("/tmp/hosted-runner/private-file");
    expect(JSON.stringify(thrown.details)).not.toContain("detail-token");
    expect(JSON.stringify(thrown.details)).not.toContain("/tmp/hosted-runner/detail-path");
    expect(processKillSpy).toHaveBeenCalledWith(-4249, "SIGKILL");
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
