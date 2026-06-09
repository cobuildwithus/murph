import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.js";

import {
  buildVersionOverrideHeaders,
  resolveSmokeRunnerManifestPath,
  resolveSmokeWorkerBaseUrl,
  runSmokeHostedDeploy,
} from "../scripts/smoke-hosted-deploy.shared.js";
import { TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON } from "./hosted-execution-fixtures.js";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_OIDC_TOKEN = "vercel-oidc-token";

describe("resolveSmokeWorkerBaseUrl", () => {
  it("prefers the explicit smoke worker base URL over the other envs", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        CF_PUBLIC_BASE_URL: "https://worker.example.test/",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://override.example.test/",
      }),
    ).toBe("https://override.example.test");
  });

  it("falls back to the public worker URL when no smoke override is set", () => {
    expect(
      resolveSmokeWorkerBaseUrl({
        CF_PUBLIC_BASE_URL: " https://worker.example.test/ ",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "   ",
      }),
    ).toBe("https://worker.example.test");
  });

  it("keeps the configured-error text stable when no worker base URL env is set", () => {
    expect(() => resolveSmokeWorkerBaseUrl({})).toThrow(
      "HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL or CF_PUBLIC_BASE_URL must be configured.",
    );
  });
});

function createCodexShellSmokeResult() {
  return {
    cliSurfaceContractBytes: 37282,
    cliSurfaceHotPathProofCount: 4,
    client: "codex-app-server",
    murphPathBytes: 28,
    noteAddBytes: 128,
    stderrBytes: 0,
    vaultCliLlmsBytes: 4096,
    vaultCliPathBytes: 32,
    vaultShowBytes: 256,
  };
}

describe("buildVersionOverrideHeaders", () => {
  it("formats the Cloudflare version override header when the worker name and version id are present", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
    })).toEqual({
      "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
    });
  });

  it("returns undefined when no candidate version id is configured", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
    })).toBeUndefined();
  });

  it("fails fast when a version id is configured without a worker name", () => {
    expect(() => buildVersionOverrideHeaders({
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
    })).toThrow("HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME must be configured.");
  });

  it("falls back to CF_WORKER_NAME when the smoke worker name is blank", () => {
    expect(buildVersionOverrideHeaders({
      CF_WORKER_NAME: "hosted-worker",
      HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
      HOSTED_EXECUTION_SMOKE_WORKER_NAME: "   ",
    })).toEqual({
      "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
    });
  });
});

describe("resolveSmokeRunnerManifestPath", () => {
  it("defaults to the Cloudflare app deploy directory instead of the caller cwd", () => {
    const originalCwd = process.cwd();
    const differentCwd = os.tmpdir();

    try {
      process.chdir(differentCwd);

      expect(resolveSmokeRunnerManifestPath({})).toBe(
        path.resolve(
          appDir,
          ".deploy/runner-bundle/.murph-runner-bundle-manifest.json",
        ),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("uses an explicit runner manifest override when configured", () => {
    expect(resolveSmokeRunnerManifestPath({
      HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: " /tmp/runner-manifest.json ",
    })).toBe("/tmp/runner-manifest.json");
  });
});

describe("runSmokeHostedDeploy", () => {
  it("pins the candidate-version header and performs the authenticated status check", async () => {
    const fetchCalls: Array<{
      body: string | undefined;
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: init?.headers,
        method: init?.method,
        url: String(url),
      });

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({
          ok: true,
          service: "cloudflare-hosted-runner",
          workerVersionId: "version-123",
        }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({
          ok: true,
          workerVersionId: "version-123",
        }), { status: 200 });
      }

      if (String(url).endsWith("/status")) {
        return new Response(JSON.stringify({
          inFlight: false,
          lastErrorAt: null,
          lastErrorCode: null,
          lastInvocationAt: "2026-03-27T00:59:00.000Z",
          mailboxLag: [],
          userId: "member_123",
          workspace: null,
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    expect(fetchCalls).toEqual([
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
        },
        method: undefined,
        url: "https://worker.example.test/",
      },
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
        },
        method: undefined,
        url: "https://worker.example.test/health",
      },
      {
        body: undefined,
        headers: {
          "Cloudflare-Workers-Version-Overrides": "hosted-worker=\"version-123\"",
          authorization: `Bearer ${TEST_OIDC_TOKEN}`,
          [HOSTED_EXECUTION_USER_ID_HEADER]: "member_123",
        },
        method: "GET",
        url: "https://worker.example.test/internal/users/member_123/status",
      },
    ]);
  });

  it("omits the override header when no candidate version id is configured", async () => {
    const fetchCalls: Array<{ headers: HeadersInit | undefined; url: string }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        headers: init?.headers,
        url: String(url),
      });

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    expect(fetchCalls).toEqual([
      {
        headers: undefined,
        url: "https://worker.example.test/",
      },
      {
        headers: undefined,
        url: "https://worker.example.test/health",
      },
    ]);
  });

  it("fails when a version override is configured but the Worker reports a different version", async () => {
    await expect(runSmokeHostedDeploy({
      fetchImpl: async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/")) {
          return new Response(JSON.stringify({
            ok: true,
            service: "cloudflare-hosted-runner",
            workerVersionId: "version-other",
          }), {
            status: 200,
          });
        }

        return new Response(JSON.stringify({ ok: true, workerVersionId: "version-other" }), { status: 200 });
      },
      log() {},
      source: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("worker banner check did not run the requested Worker version.");
  });

  it("executes the deploy-signed runner container smoke when enabled", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-manifest-"));
    const manifestPath = path.join(root, ".deploy", "runner-bundle", ".murph-runner-bundle-manifest.json");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        sourceFingerprint: "source-fingerprint",
      }, null, 2)}\n`,
      "utf8",
    );
    const fetchCalls: Array<{
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        headers: init?.headers,
        method: init?.method,
        url: String(url),
      });

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/internal/deploy/container-smoke")) {
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "bundle-fingerprint",
              sourceFingerprint: "source-fingerprint",
            },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    const containerCall = fetchCalls.find((entry) =>
      entry.url === "https://worker.example.test/internal/deploy/container-smoke"
    );
    expect(containerCall).toBeDefined();
    expect(containerCall?.method).toBe("POST");
    const headers = new Headers(containerCall?.headers);
    expect(headers.get("x-hosted-execution-signature")).toEqual(expect.any(String));
    expect(headers.get("x-hosted-execution-timestamp")).toEqual(expect.any(String));
  });

  it("can request the deployed runner direct R2 presigned PUT smoke", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-direct-r2-manifest-"));
    const manifestPath = path.join(root, ".deploy", "runner-bundle", ".murph-runner-bundle-manifest.json");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "bundle-fingerprint",
        sourceFingerprint: "source-fingerprint",
      }, null, 2)}\n`,
      "utf8",
    );
    const fetchCalls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/internal/deploy/container-smoke?directR2PresignedPut=1")) {
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            directR2PresignedPut: {
              byteLength: 160 * 1024 * 1024,
              ok: true,
              payloadSha256: "b".repeat(64),
              status: 200,
            },
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "bundle-fingerprint",
              sourceFingerprint: "source-fingerprint",
            },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    expect(fetchCalls).toContain(
      "https://worker.example.test/internal/deploy/container-smoke?directR2PresignedPut=1",
    );
  });

  it("requires the managed-container smoke when the direct R2 smoke is enabled", async () => {
    await expect(runSmokeHostedDeploy({
      fetchImpl: async () => {
        throw new Error("Direct R2 smoke precondition should fail before deploy smoke requests.");
      },
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT: "true",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow(
      "HOSTED_EXECUTION_SMOKE_DIRECT_R2_PRESIGNED_PUT requires HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true.",
    );
  });

  it("retries the deploy-signed runner container smoke until the expected bundle is active", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-retry-manifest-"));
    const manifestPath = path.join(root, ".deploy", "runner-bundle", ".murph-runner-bundle-manifest.json");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "expected-bundle",
        sourceFingerprint: "expected-source",
      }, null, 2)}\n`,
      "utf8",
    );
    const logs: string[] = [];
    const fetchCalls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/internal/deploy/container-smoke")) {
        const smokeAttempt = fetchCalls.filter((entry) =>
          entry.endsWith("/internal/deploy/container-smoke")
        ).length;
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: smokeAttempt === 1
              ? {
                  buildSkipped: false,
                  bundleFingerprint: "stale-bundle",
                  sourceFingerprint: "stale-source",
                }
              : {
                  buildSkipped: false,
                  bundleFingerprint: "expected-bundle",
                  sourceFingerprint: "expected-source",
                },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log(message) {
        logs.push(message);
      },
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "2",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    expect(fetchCalls.filter((entry) =>
      entry.endsWith("/internal/deploy/container-smoke")
    )).toHaveLength(2);
    expect(logs.some((message) =>
      message.startsWith("Runner container smoke attempt 1/2 failed (")
      && message.includes("did not run the expected runner bundle")
      && message.endsWith("; retrying in 0ms.")
    )).toBe(true);
  });

  it("retries transient HTTP 400 runner container smoke responses", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-http-400-retry-"));
    const manifestPath = path.join(root, ".deploy", "runner-bundle", ".murph-runner-bundle-manifest.json");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "expected-bundle",
        sourceFingerprint: "expected-source",
      }, null, 2)}\n`,
      "utf8",
    );
    const fetchCalls: string[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      fetchCalls.push(String(url));

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/internal/deploy/container-smoke")) {
        const smokeAttempt = fetchCalls.filter((entry) =>
          entry.endsWith("/internal/deploy/container-smoke")
        ).length;
        if (smokeAttempt === 1) {
          return new Response(JSON.stringify({ error: "Invalid request." }), { status: 400 });
        }

        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "expected-bundle",
              sourceFingerprint: "expected-source",
            },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "2",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    expect(fetchCalls.filter((entry) =>
      entry.endsWith("/internal/deploy/container-smoke")
    )).toHaveLength(2);
  });

  it("redacts failed runner container smoke response bodies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-http-400-redact-"));
    const manifestPath = path.join(root, ".deploy", "runner-bundle", ".murph-runner-bundle-manifest.json");
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({
        buildSkipped: false,
        bundleFingerprint: "expected-bundle",
        sourceFingerprint: "expected-source",
      }, null, 2)}\n`,
      "utf8",
    );
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/internal/deploy/container-smoke")) {
        return new Response(
          JSON.stringify({
            access_key: "fixture-access-value",
            error: "Invalid request.",
            url: "https://r2.example.test/object?X-Amz-Signature=fixture-signature-value",
          }),
          { status: 400 },
        );
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    let thrown: unknown;
    try {
      await runSmokeHostedDeploy({
        fetchImpl,
        log() {},
        source: {
          HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
          HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
          HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "1",
          HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
      });
    } catch (error) {
      thrown = error;
    }

    const message = thrown instanceof Error ? thrown.message : String(thrown);
    expect(message).toContain("runner container smoke failed with HTTP 400:");
    expect(message).toContain("X-Amz-Signature=<REDACTED>");
    expect(message).toContain("\"access_key\":\"<REDACTED>\"");
    expect(message).not.toContain("fixture-signature-value");
    expect(message).not.toContain("fixture-access-value");
  });

  it("fails when the authenticated hosted status check returns a non-ok response", async () => {
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      expect(init?.method).toBe("GET");
      return new Response("runner stalled secret", { status: 500 });
    };

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("Hosted execution status check failed with HTTP 500.");
  });

  it("does not echo authenticated status response bodies in thrown errors", async () => {
    const promise = runSmokeHostedDeploy({
      fetchImpl: async (url: RequestInfo | URL) => {
        if (String(url).endsWith("/")) {
          return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
            status: 200,
          });
        }

        if (String(url).endsWith("/health")) {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }

        return new Response("runner token secret", { status: 500 });
      },
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_OIDC_TOKEN: "vercel-oidc-token",
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    });

    await expect(promise).rejects.toThrow("Hosted execution status check failed with HTTP 500.");
    await expect(promise).rejects.not.toThrow(/runner token secret/u);
  });

  it("accepts either HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN for authenticated status requests", async () => {
    const fetchCalls: Array<{
      headers: HeadersInit | undefined;
      method: string | undefined;
      url: string;
    }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({
        headers: init?.headers,
        method: init?.method,
        url: String(url),
      });

      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (String(url).endsWith("/status")) {
        return new Response(JSON.stringify({
          inFlight: false,
          lastErrorAt: null,
          lastErrorCode: null,
          lastInvocationAt: "2026-03-27T00:59:00.000Z",
          mailboxLag: [],
          userId: "member_123",
          workspace: null,
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    await runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        VERCEL_OIDC_TOKEN: "vercel-oidc-token",
      },
    });

    const statusCall = fetchCalls.find((entry) => entry.url.endsWith("/internal/users/member_123/status"));
    expect(statusCall).toBeDefined();
    const headers = new Headers(statusCall?.headers);
    expect(readBearerAuthorizationToken(headers.get("authorization"))).toBe(TEST_OIDC_TOKEN);
  });

  it("fails before issuing requests when a candidate version id is configured without a worker name", async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("HOSTED_EXECUTION_SMOKE_WORKER_NAME or CF_WORKER_NAME must be configured.");
  });

  it("fails with the OIDC-token error when manual smoke auth is unconfigured", async () => {
    await expect(runSmokeHostedDeploy({
      fetchImpl: async (url: RequestInfo | URL) =>
        new Response(
          JSON.stringify(
            String(url).endsWith("/")
              ? { ok: true, service: "cloudflare-hosted-runner" }
              : { ok: true },
          ),
          { status: 200 },
        ),
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_USER_ID: "member_123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow(
      "HOSTED_EXECUTION_SMOKE_OIDC_TOKEN or VERCEL_OIDC_TOKEN is required when HOSTED_EXECUTION_SMOKE_USER_ID is set.",
    );
  });
});
