import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";

import { buildHostedExecutionMemberActivatedWake } from "@murphai/hosted-execution";
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

  function createCronJobRequest(eventId: string) {
    const wake = buildHostedExecutionMemberActivatedWake({
      eventId,
      memberChannels: {
        email: false,
        linq: false,
        telegram: false,
      },
      memberId: "member_123",
      occurredAt: "2026-04-08T00:00:00.000Z",
    });

    return {
      bundle: null,
      run: {
        attempt: 1,
        runId: "run_123",
        startedAt: "2026-04-08T00:00:00.000Z",
      },
      runDrain: {
        acquiredAt: "2026-04-08T00:00:00.000Z",
        events: [
          {
            seq: "1",
            wake,
            ingressEventId: `wake_${eventId}`,
          },
        ],
        inputCommittedSeq: "1",
        inputCursorVersion: "1",
        runId: "run_123",
        triggerKind: "external_ingress" as const,
        userId: "member_123",
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

    const result = await module.runHostedExecutionJobIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: {
        request: createCronJobRequest("evt_child_cleanup"),
        runtime: {
          forwardedEnv: {},
          userEnv: {},
        },
      },
    });

    expect(result.result.result.summary).toBe("ok");
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

    await module.runHostedExecutionJobIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: {
        request: createCronJobRequest("evt_child_env"),
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

  it("accepts completed child results that omit the explicit phase field", async () => {
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
        child.stdout.end(module.formatHostedExecutionChildResult({
          ok: true,
          result: {
            result: {
              bundle: null,
              result: {
                eventsHandled: 1,
                nextWakeAt: null,
                summary: "ok",
              },
            },
            finalGatewayProjectionSnapshot: null,
          },
        }));
        child.emit("close", 0);
      });

      return child;
    });

    const result = await module.runHostedExecutionJobIsolatedDetailed({
      internalWorkerProxyToken: "proxy-token",
      job: {
        request: createCronJobRequest("evt_child_phase_optional"),
        runtime: {
          forwardedEnv: {},
          userEnv: {},
        },
      },
    });

    expect(result.result.result.summary).toBe("ok");
    expect(processKillSpy).toHaveBeenCalledWith(-4246, "SIGKILL");
  });

});

function createRunnerResult() {
  return {
    phase: "completed" as const,
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
