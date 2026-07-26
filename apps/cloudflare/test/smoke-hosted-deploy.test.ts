import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { HOSTED_EXECUTION_USER_ID_HEADER } from "@murphai/hosted-execution/contracts";

const undiciAgentProof = vi.hoisted(() => ({
  close: vi.fn(async () => {}),
  constructorOptions: [] as unknown[],
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    Agent: class Agent {
      constructor(options: unknown) {
        undiciAgentProof.constructorOptions.push(options);
      }

      close(): Promise<void> {
        return undiciAgentProof.close();
      }
    },
  };
});

import { Agent } from "undici";
import {
  readBearerAuthorizationToken,
} from "../src/auth-adapter.js";
import {
  DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
} from "../src/deploy-smoke-live-model.ts";

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

const CONTAINER_SMOKE_PATH = "/internal/deploy/container-smoke";

// The smoke appends a per-attempt query param, so match on pathname rather than
// suffix.
function isContainerSmokeRequest(url: string): boolean {
  return new URL(url).pathname === CONTAINER_SMOKE_PATH;
}

// The bundle-identity phase carries no feature flags; the direct R2 and live model
// turn phases are separate later requests that must not be answered by it.
function isBundleOnlyContainerSmokeRequest(url: string): boolean {
  const parsed = new URL(url);
  return parsed.pathname === CONTAINER_SMOKE_PATH
    && parsed.searchParams.get("directR2PresignedPut") !== "1"
    && parsed.searchParams.get("liveModelTurn") !== "1";
}

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

  it("retries when the Worker banner has not reached the requested version", async () => {
    vi.useFakeTimers();
    try {
      let bannerCalls = 0;
      let healthCalls = 0;
      const smoke = runSmokeHostedDeploy({
        fetchImpl: async (url: RequestInfo | URL) => {
          if (String(url).endsWith("/")) {
            bannerCalls += 1;
            return new Response(JSON.stringify({
              ok: true,
              service: "cloudflare-hosted-runner",
              workerVersionId: bannerCalls === 1 ? "version-other" : "version-123",
            }), { status: 200 });
          }

          healthCalls += 1;
          return new Response(JSON.stringify({ ok: true, workerVersionId: "version-123" }), {
            status: 200,
          });
        },
        log() {},
        source: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        },
      });

      await vi.runAllTimersAsync();
      await smoke;

      expect(bannerCalls).toBe(2);
      expect(healthCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the banner and health pair when health has not reached the requested version", async () => {
    vi.useFakeTimers();
    try {
      let bannerCalls = 0;
      let healthCalls = 0;
      const smoke = runSmokeHostedDeploy({
        fetchImpl: async (url: RequestInfo | URL) => {
          if (String(url).endsWith("/")) {
            bannerCalls += 1;
            return new Response(JSON.stringify({
              ok: true,
              service: "cloudflare-hosted-runner",
              workerVersionId: "version-123",
            }), { status: 200 });
          }

          healthCalls += 1;
          return new Response(JSON.stringify({
            ok: true,
            workerVersionId: healthCalls === 1 ? "version-other" : "version-123",
          }), { status: 200 });
        },
        log() {},
        source: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        },
      });

      await vi.runAllTimersAsync();
      await smoke;

      expect(bannerCalls).toBe(2);
      expect(healthCalls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails after the bounded retry window when the Worker keeps reporting another version", async () => {
    vi.useFakeTimers();
    try {
      let bannerCalls = 0;
      const smoke = runSmokeHostedDeploy({
        fetchImpl: async () => {
          bannerCalls += 1;
          return new Response(JSON.stringify({
            ok: true,
            service: "cloudflare-hosted-runner",
            workerVersionId: "version-other",
          }), { status: 200 });
        },
        log() {},
        source: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        },
      });
      const assertion = expect(smoke).rejects.toThrow(
        "worker banner check did not run the requested Worker version.",
      );

      await vi.runAllTimersAsync();
      await assertion;

      expect(bannerCalls).toBe(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry public smoke HTTP failures", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        CF_WORKER_NAME: "hosted-worker",
        HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("worker banner check failed with HTTP 503.");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a public smoke payload missing Worker version metadata", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        service: "cloudflare-hosted-runner",
      }), { status: 200 }));
      const smoke = runSmokeHostedDeploy({
        fetchImpl,
        log() {},
        source: {
          CF_WORKER_NAME: "hosted-worker",
          HOSTED_EXECUTION_SMOKE_VERSION_ID: "version-123",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        },
      });
      const assertion = expect(smoke).rejects.toThrow(/worker banner check/u);

      await vi.runAllTimersAsync();
      await assertion;

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs the deploy-signed container smoke with its explicit deadline and dispatcher", async () => {
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
      dispatcher: unknown;
      headers: HeadersInit | undefined;
      method: string | undefined;
      signal: AbortSignal | null | undefined;
      url: string;
    }> = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      const initWithDispatcher = init as RequestInit & { dispatcher?: unknown } | undefined;
      fetchCalls.push({
        dispatcher: initWithDispatcher?.dispatcher,
        headers: init?.headers,
        method: init?.method,
        signal: init?.signal,
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

      if (isBundleOnlyContainerSmokeRequest(String(url))) {
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

    undiciAgentProof.close.mockClear();
    undiciAgentProof.constructorOptions.length = 0;
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await runSmokeHostedDeploy({
        log() {},
        source: {
          HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
          HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }

    const containerCall = fetchCalls.find((entry) => isContainerSmokeRequest(entry.url));
    expect(containerCall).toBeDefined();
    expect(containerCall?.dispatcher).toBeInstanceOf(Agent);
    expect(undiciAgentProof.constructorOptions).toEqual([{
      bodyTimeout: 0,
      headersTimeout: 0,
    }]);
    expect(undiciAgentProof.close).toHaveBeenCalledTimes(1);
    expect(containerCall?.method).toBe("POST");
    expect(containerCall?.signal).toBeInstanceOf(AbortSignal);
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

      if (new URL(String(url)).searchParams.get("directR2PresignedPut") === "1") {
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

    expect(fetchCalls.some((entry) =>
      isContainerSmokeRequest(entry)
      && new URL(entry).searchParams.get("directR2PresignedPut") === "1"
    )).toBe(true);
  });

  it("can request the deployed runner live model turn smoke", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-live-model-turn-manifest-"));
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

      if (isBundleOnlyContainerSmokeRequest(String(url))) {
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

      const parsedUrl = new URL(String(url));
      if (
        parsedUrl.pathname === "/internal/deploy/container-smoke" &&
        parsedUrl.searchParams.get("liveModelTurn") === "1"
      ) {
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            liveModelTurn: {
              durationMs: 1_234,
              egressGrantConsumed: true,
              model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
              stdoutBytes: 2_048,
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
        HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    expect(fetchCalls.some((entry) => isBundleOnlyContainerSmokeRequest(entry))).toBe(true);
    const liveCall = fetchCalls
      .map((entry) => new URL(entry))
      .find((entry) => entry.searchParams.get("liveModelTurn") === "1");
    expect(liveCall).toBeDefined();
    expect(liveCall?.searchParams.has("expectedBundleFingerprint")).toBe(false);
    expect(liveCall?.searchParams.has("expectedSourceFingerprint")).toBe(false);
  });

  it("fails the live model turn smoke when the deployed turn metadata is missing or wrong", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-live-model-turn-bad-manifest-"));
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
    const buildFetchImpl = (liveModelTurn: unknown) => async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }

      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (isBundleOnlyContainerSmokeRequest(String(url))) {
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

      return new Response(JSON.stringify({
        ok: true,
        runnerContainer: {
          codexShell: createCodexShellSmokeResult(),
          ...(liveModelTurn === undefined ? {} : { liveModelTurn }),
          ok: true,
          runnerBundle: {
            buildSkipped: false,
            bundleFingerprint: "bundle-fingerprint",
            sourceFingerprint: "source-fingerprint",
          },
          service: "cloudflare-hosted-runner-node",
        },
      }), { status: 200 });
    };
    const source = {
      HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: "true",
      HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
      HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
      HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "1",
      HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
    };

    await expect(runSmokeHostedDeploy({
      fetchImpl: buildFetchImpl(undefined),
      log() {},
      source,
    })).rejects.toThrow("runner container live model turn smoke did not return metadata.");

    await expect(runSmokeHostedDeploy({
      fetchImpl: buildFetchImpl({
        durationMs: 1_234,
        egressGrantConsumed: true,
        model: "gpt-other",
        stdoutBytes: 2_048,
      }),
      log() {},
      source,
    })).rejects.toThrow("runner container live model turn smoke did not use the expected model.");

    await expect(runSmokeHostedDeploy({
      fetchImpl: buildFetchImpl({
        durationMs: 1_234,
        egressGrantConsumed: false,
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        stdoutBytes: 2_048,
      }),
      log() {},
      source,
    })).rejects.toThrow("runner container live model turn smoke did not consume the egress grant.");

    await expect(runSmokeHostedDeploy({
      fetchImpl: buildFetchImpl({
        durationMs: 1_234,
        egressGrantConsumed: true,
        model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
        stdoutBytes: 0,
      }),
      log() {},
      source,
    })).rejects.toThrow("runner container live model turn smoke reported no codex exec output.");
  });

  it("does not retry live model turn smoke failures after the live endpoint is called", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-live-model-turn-no-retry-"));
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

      const parsedUrl = new URL(String(url));
      if (
        parsedUrl.pathname === "/internal/deploy/container-smoke" &&
        parsedUrl.searchParams.get("liveModelTurn") === "1"
      ) {
        return new Response(JSON.stringify({
          detail: "Codex final output was not OK.",
          error: "Deploy container smoke failed.",
          ok: false,
        }), { status: 500 });
      }

      if (parsedUrl.pathname === "/internal/deploy/container-smoke") {
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

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log(message) {
        logs.push(message);
      },
      source: {
        HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "3",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    })).rejects.toThrow("runner container smoke failed with HTTP 500");

    const liveCalls = fetchCalls
      .map((entry) => new URL(entry))
      .filter((entry) => entry.searchParams.get("liveModelTurn") === "1");
    expect(liveCalls).toHaveLength(1);
    expect(logs.some((message) =>
      message.startsWith("Runner container smoke attempt") &&
      message.includes("Codex final output was not OK")
    )).toBe(false);
  });

  it("requires the managed-container smoke when the live model turn smoke is enabled", async () => {
    await expect(runSmokeHostedDeploy({
      fetchImpl: async () => {
        throw new Error("Live model turn precondition should fail before deploy smoke requests.");
      },
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: "true",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow(
      "HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN requires HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER=true.",
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

  it("scopes each runner container smoke attempt to its own container instance", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-attempt-scope-"));
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

    const smokeAttempts: (string | null)[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (isContainerSmokeRequest(String(url))) {
        const attempt = new URL(String(url)).searchParams.get("attempt");
        smokeAttempts.push(attempt);
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: smokeAttempts.length < 3
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
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "3",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    // Distinct attempt values are what give each retry a fresh smoke Durable
    // Object, so a pre-rollout container cannot be re-read for the whole run.
    expect(smokeAttempts).toEqual(["1", "2", "3"]);
  });

  it("runs the live model turn against the container the bundle phase proved current", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-live-after-retry-"));
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

    // Attempt 1 is the pre-rollout container. Once the bundle phase converges on
    // attempt 2, the live model turn must stay on attempt 2: its failures are
    // non-retryable, so returning to the stale attempt-1 container would hard-fail
    // the deploy in exactly the rollout window this is meant to survive.
    const staleAttempts = new Set(["1"]);
    const liveAttempts: (string | null)[] = [];
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (isContainerSmokeRequest(String(url))) {
        const parsed = new URL(String(url));
        const attempt = parsed.searchParams.get("attempt");
        const liveModelTurn = parsed.searchParams.get("liveModelTurn") === "1";
        if (liveModelTurn) {
          liveAttempts.push(attempt);
        }
        const stale = attempt !== null && staleAttempts.has(attempt);
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ...(liveModelTurn
              ? {
                  liveModelTurn: {
                    durationMs: 1234,
                    egressGrantConsumed: true,
                    model: DEPLOY_LIVE_MODEL_TURN_SMOKE_MODEL,
                    stdoutBytes: 128,
                  },
                }
              : {}),
            ok: true,
            runnerBundle: stale
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
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_LIVE_MODEL_TURN: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "3",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    });

    expect(liveAttempts).toEqual(["2"]);
  });

  it("stops waiting for the runner container rollout once the wall-clock budget is spent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-max-wait-"));
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

    let smokeCalls = 0;
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (isContainerSmokeRequest(String(url))) {
        smokeCalls += 1;
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "stale-bundle",
              sourceFingerprint: "stale-source",
            },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    // A zero budget makes the deadline unreachable on the first retry decision, so
    // the gate reports its own failure instead of outliving the deploy job.
    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "300",
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS: "0",
        HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "0",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      },
    })).rejects.toThrow("runner container smoke did not converge within 0ms");

    expect(smokeCalls).toBe(1);
  });

  it("aborts a pending container request at the configured wall-clock deadline", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-request-deadline-"));
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

    const fetchImpl = async (
      url: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (isContainerSmokeRequest(String(url))) {
        const signal = init?.signal;
        if (!signal) {
          throw new Error("Container smoke request did not receive an abort signal.");
        }
        return await new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason);
            return;
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    undiciAgentProof.close.mockClear();
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await expect(runSmokeHostedDeploy({
        log() {},
        source: {
          HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
          HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
          HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS: "10",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
      })).rejects.toThrow("runner container smoke did not converge within 10ms");
    } finally {
      vi.unstubAllGlobals();
    }
    expect(undiciAgentProof.close).toHaveBeenCalledTimes(1);
  });

  it("lets the wall-clock budget preempt a much larger attempt ceiling", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "cloudflare-smoke-budget-preempt-"));
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

    let smokeCalls = 0;
    // Drive elapsed time off the smoke-call count rather than real sleeping or a
    // fixed call sequence, so the assertion does not depend on how many times
    // Date.now happens to be read. The budget must stop the loop long before the
    // 300-attempt ceiling, which is the relationship that let a stalled rollout
    // outlive the deploy job.
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => smokeCalls * 5_000);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (isContainerSmokeRequest(String(url))) {
        smokeCalls += 1;
        return new Response(JSON.stringify({
          ok: true,
          runnerContainer: {
            codexShell: createCodexShellSmokeResult(),
            ok: true,
            runnerBundle: {
              buildSkipped: false,
              bundleFingerprint: "stale-bundle",
              sourceFingerprint: "stale-source",
            },
            service: "cloudflare-hosted-runner-node",
          },
        }), { status: 200 });
      }

      throw new Error(`Unexpected smoke request: ${String(url)}`);
    };

    try {
      const error = await runSmokeHostedDeploy({
        fetchImpl,
        log() {},
        source: {
          HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
          HOSTED_EXECUTION_SMOKE_RUNNER_MANIFEST_PATH: manifestPath,
          HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "300",
          HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS: "10000",
          HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "1000",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
          HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
        },
      }).then(() => null, (reason: unknown) => reason as Error);

      // One retry is allowed under budget, then the deadline stops the loop and the
      // failure names attempts, elapsed time, and the underlying mismatch.
      expect(smokeCalls).toBe(2);
      expect(timeoutSpy.mock.calls.map(([timeoutMs]) => timeoutMs)).toEqual([10_000, 5_000]);
      expect(error?.message).toContain("runner container smoke did not converge within 10000ms");
      expect(error?.message).toContain("(2 attempts, 10000ms elapsed)");
      expect(error?.message).toContain("did not run the expected runner bundle");
    } finally {
      timeoutSpy.mockRestore();
      nowSpy.mockRestore();
    }
  });

  it("rejects a negative runner container smoke wall-clock budget", async () => {
    const fetchImpl = async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/")) {
        return new Response(JSON.stringify({ ok: true, service: "cloudflare-hosted-runner" }), {
          status: 200,
        });
      }
      if (String(url).endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`Invalid wall-clock budget should fail before ${String(url)}.`);
    };

    await expect(runSmokeHostedDeploy({
      fetchImpl,
      log() {},
      source: {
        HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
        HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS: "-1",
        HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "https://worker.example.test",
      },
    })).rejects.toThrow("HOSTED_EXECUTION_SMOKE_RUNNER_MAX_WAIT_MS must be a non-negative integer.");
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

      if (isContainerSmokeRequest(String(url))) {
        const smokeAttempt = fetchCalls.filter((entry) =>
          isContainerSmokeRequest(entry)
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
      isContainerSmokeRequest(entry)
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

      if (isContainerSmokeRequest(String(url))) {
        const smokeAttempt = fetchCalls.filter((entry) =>
          isContainerSmokeRequest(entry)
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
      isContainerSmokeRequest(entry)
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

      if (isContainerSmokeRequest(String(url))) {
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
