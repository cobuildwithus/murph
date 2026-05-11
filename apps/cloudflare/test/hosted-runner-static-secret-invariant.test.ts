import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, expect, it, vi } from "vitest";

import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.ts";
import {
  createHostedExecutionRunnerChildResultMessage,
} from "../src/runner-job-transport.ts";
import {
  buildHostedRunnerChildRuntimeEnv,
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../src/runner-env.js";
import {
  createHostedRunnerChildProcessEnv,
  type HostedRunnerChildLauncherDirectories,
} from "../src/runner-child-launcher.ts";
import {
  RunnerContainer,
} from "../src/runner-container.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", async () => {
  const actual = await vi.importActual<typeof import("@murphai/hosted-execution")>(
    "@murphai/hosted-execution",
  );
  return {
    ...actual,
    emitHostedExecutionStructuredLog: mocks.emitHostedExecutionStructuredLog,
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: mocks.spawn,
  };
});

const HOSTED_SECRET_KEY_PATTERN =
  /(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|CLIENT_SECRET|PASSWORD)/iu;

const REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS = [
  "OPENAI_API_KEY",
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "LINQ_API_TOKEN",
  "MAPBOX_ACCESS_TOKEN",
  "MURPH_HOSTED_CLI_BRIDGE_TOKEN",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK",
  "HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON",
  "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
  "TELEGRAM_BOT_TOKEN",
  "DEVICE_SYNC_SECRET",
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "OURA_CLIENT_ID",
  "OURA_CLIENT_SECRET",
  "WHOOP_CLIENT_ID",
  "WHOOP_CLIENT_SECRET",
] as const;

const TEMPORARY_REVIEWED_HOSTED_SECRET_KEYS = new Set<string>([
  ...REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS,
]);

const CURRENT_FORWARDED_SECRET_KEYS = [
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "LINQ_API_TOKEN",
  "MAPBOX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
] as const;

const CURRENT_PLATFORM_SECRET_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
] as const;

const CURRENT_USER_SECRET_KEYS = [
  "OPENAI_API_KEY",
] as const;

const CURRENT_RESOLVED_CONFIG_SECRET_SUFFIXES = [
  "deviceSync.providerConfigs.oura.clientId",
  "deviceSync.providerConfigs.oura.clientSecret",
  "deviceSync.providerConfigs.whoop.clientId",
  "deviceSync.providerConfigs.whoop.clientSecret",
  "deviceSync.secret",
] as const;

// Temporary current-exposure allowlist: shrink these exact locations as hosted
// runtime secret forwarding is hardened.
const TEMPORARY_HOSTED_JOB_SECRET_PATH_ALLOWLIST = new Set<string>([
  ...buildAllowedSecretPaths(
    [
      "actual isolated child env",
      "direct child env",
      "direct child env projection",
      "runtime.forwardedEnv",
      "serialized job input.runtime.forwardedEnv",
      "job payload sent to container.job.runtime.forwardedEnv",
      "child stdin payload.job.runtime.forwardedEnv",
    ],
    CURRENT_FORWARDED_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "runtime.platformEnv",
      "serialized job input.runtime.platformEnv",
      "job payload sent to container.job.runtime.platformEnv",
      "child stdin payload.job.runtime.platformEnv",
    ],
    CURRENT_PLATFORM_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "runtime.userEnv",
      "serialized job input.runtime.userEnv",
      "job payload sent to container.job.runtime.userEnv",
      "child stdin payload.job.runtime.userEnv",
    ],
    CURRENT_USER_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "runtime.resolvedConfig",
      "serialized job input.runtime.resolvedConfig",
      "job payload sent to container.job.runtime.resolvedConfig",
      "child stdin payload.job.runtime.resolvedConfig",
    ],
    CURRENT_RESOLVED_CONFIG_SECRET_SUFFIXES,
  ),
  "job payload sent to container.internalWorkerProxyToken",
  "job payload sent to container.browserVaultBackgroundProxyToken",
  "child stdin payload.internalWorkerProxyToken",
]);

afterEach(() => {
  mocks.spawn.mockReset();
  vi.restoreAllMocks();
});

it("guards hosted runner job JSON and child launch surfaces against unreviewed static secret keys", async () => {
  const processKillSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
  expect([...TEMPORARY_REVIEWED_HOSTED_SECRET_KEYS].sort()).toEqual(
    [...REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS].sort(),
  );
  expect([...TEMPORARY_HOSTED_JOB_SECRET_PATH_ALLOWLIST].join("\n")).not.toContain(
    "MURPH_HOSTED_CLI_BRIDGE_TOKEN",
  );
  const configSource = createReasonablyAvailableHostedConfigSource();
  const runnerSecrets = createReasonablyAvailableRunnerSecrets();
  const seedKeys = new Set([
    ...Object.keys(configSource),
    ...Object.keys(runnerSecrets),
  ]);
  for (const key of REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS) {
    expect(seedKeys.has(key)).toBe(true);
  }

  const runtime = buildHostedRunnerJobRuntimeConfig({
    configSource,
    forwardedEnv: buildHostedRunnerContainerEnv(configSource),
    rewritePlatformUrlsForContainer: true,
    runnerSecrets,
  });
  const childRuntimeEnv = buildHostedRunnerChildRuntimeEnv({
    forwardedEnv: runtime.forwardedEnv ?? {},
  });
  const childProcessEnv = createHostedRunnerChildProcessEnv({
    ambientEnv: {
      LANG: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      TZ: "UTC",
    },
    forwardedEnv: childRuntimeEnv,
    isTypeScriptChild: true,
    launcherDirectories: createLauncherDirectories("/tmp/hosted-runner-launch"),
  });
  const job = createWorkspaceJob(runtime);
  const serializedJobInput = JSON.stringify(job);
  const containerRequestBody = await serializeContainerRequestBody(job);
  const childLaunch = await serializeChildStdinPayload(job);
  const scannedSurfaces = {
    "actual isolated child env": childLaunch.childEnv,
    "direct child env": childProcessEnv,
    "direct child env projection": childRuntimeEnv,
    "child stdin payload": JSON.parse(childLaunch.stdinPayload) as unknown,
    "job payload sent to container": JSON.parse(containerRequestBody) as unknown,
    "runtime.forwardedEnv": runtime.forwardedEnv ?? {},
    "runtime.platformEnv": runtime.platformEnv ?? {},
    "runtime.resolvedConfig": runtime.resolvedConfig ?? {},
    "runtime.userEnv": runtime.userEnv ?? {},
    "serialized job input": JSON.parse(serializedJobInput) as unknown,
  };

  for (const [surface, value] of Object.entries(scannedSurfaces)) {
    assertNoUnreviewedStaticSecretKeys(surface, value);
  }

  for (const [surface, value] of Object.entries(scannedSurfaces)) {
    expect(collectExactKeyPaths(value, "MURPH_HOSTED_CLI_BRIDGE_TOKEN")).toEqual([]);
    expect(surface.length).toBeGreaterThan(0);
  }
  expect(Object.keys(childLaunch.childEnv).length).toBeGreaterThan(0);
  expect(processKillSpy).toHaveBeenCalled();
});

function createReasonablyAvailableHostedConfigSource(): Record<string, string> {
  return {
    DEVICE_SYNC_PUBLIC_BASE_URL: "https://device-sync.example.test",
    DEVICE_SYNC_SECRET: "fixture-device-sync-secret",
    HOSTED_AI_USAGE_REPORTING_SECRET: "fixture-usage-reporting-secret",
    HOSTED_ASSISTANT_MODEL: "gpt-fixture",
    HOSTED_ASSISTANT_PROVIDER: "openai",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
      '{"kty":"EC","d":"fixture-automation"}',
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_KEYRING_JSON:
      '{"keys":[{"keyId":"cloudflare-automation:v1","privateJwk":{"kty":"EC","d":"fixture-automation"}}]}',
    HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL:
      "http://host.docker.internal:8787",
    HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "hosted-email,linq,mapbox,telegram,whatsapp",
    HOSTED_LOG_FINGERPRINT_SECRET: "fixture-log-fingerprint-secret",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      '{"kty":"EC","d":"fixture-callback"}',
    JUNCTION_API_KEY: "sk_us_fixture_junction_api_key",
    JUNCTION_CLIENT_USER_ID_SECRET: "fixture-junction-user-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
    LINQ_API_BASE_URL: "https://linq.example.test",
    LINQ_API_TOKEN: "fixture-linq-token",
    MAPBOX_ACCESS_TOKEN: "fixture-mapbox-token",
    MURPH_HOSTED_CLI_BRIDGE_TOKEN: "fixture-runtime-bridge-token",
    NODE_ENV: "production",
    OURA_CLIENT_ID: "fixture-oura-client-id",
    OURA_CLIENT_SECRET: "fixture-oura-client-secret",
    TELEGRAM_API_BASE_URL: "https://telegram.example.test",
    TELEGRAM_BOT_TOKEN: "fixture-telegram-token",
    WHATSAPP_ACCESS_TOKEN: "fixture-whatsapp-token",
    WHATSAPP_PHONE_NUMBER_ID: "fixture-whatsapp-phone-number-id",
    TELEGRAM_FILE_BASE_URL: "https://telegram-files.example.test",
    OPENAI_API_KEY: "fixture-vercel-openai-key",
    WHOOP_CLIENT_ID: "fixture-whoop-client-id",
    WHOOP_CLIENT_SECRET: "fixture-whoop-client-secret",
  };
}

function createReasonablyAvailableRunnerSecrets(): Record<string, string> {
  return Object.fromEntries(
    REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS.map((key) => [
      key,
      `user-${key.toLowerCase().replaceAll("_", "-")}`,
    ]),
  );
}

function createWorkspaceJob(
  runtime: HostedExecutionWorkspaceInvocationJobInput["runtime"],
): HostedExecutionWorkspaceInvocationJobInput {
  return {
    kind: "workspace-invocation",
    request: {
      attemptId: "attempt_secret_invariant",
      leaseGeneration: "1",
      reason: "nudge",
      userId: "member_secret_invariant",
      workspaceVersion: "7",
    },
    runtime,
  };
}

async function serializeContainerRequestBody(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<string> {
  let requestBody = "";
  let running = false;
  const container = new RunnerContainer({}, {
    HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
    HOSTED_EXECUTION_RUNNER_CALLBACK_BASE_URL: "https://runner-callback.example.test",
  });

  Object.assign(container, {
    containerFetch: vi.fn(async (
      requestOrUrl: Request | URL | string,
      portOrInit?: number | RequestInit,
      _port?: number,
    ) => {
      const url =
        typeof requestOrUrl === "string"
          ? requestOrUrl
          : requestOrUrl instanceof URL
            ? requestOrUrl.toString()
            : requestOrUrl.url;
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json; charset=utf-8" },
          status: 200,
        });
      }

      const init = typeof portOrInit === "object" ? portOrInit : undefined;
      requestBody = typeof init?.body === "string" ? init.body : "";
      return new Response(JSON.stringify(createRunnerResult()), {
        headers: { "content-type": "application/json; charset=utf-8" },
        status: 200,
      });
    }),
    destroy: vi.fn(async () => {
      running = false;
    }),
    getState: vi.fn(async () => ({
      lastChange: Date.now(),
      status: running ? "running" : "stopped",
    })),
    setOutboundByHosts: vi.fn(async () => {}),
    startAndWaitForPorts: vi.fn(async () => {
      running = true;
    }),
  });

  await container.invoke({
    job,
    timeoutMs: 45_000,
    userId: job.request.userId,
  });

  expect(requestBody.length).toBeGreaterThan(0);
  return requestBody;
}

async function serializeChildStdinPayload(
  job: HostedExecutionWorkspaceInvocationJobInput,
): Promise<{
  childEnv: Record<string, string>;
  stdinPayload: string;
}> {
  const module = await import("../src/node-runner-isolated.ts");
  let childEnv: Record<string, string> = {};
  let stdinPayload = "";

  mocks.spawn.mockImplementation((_command: unknown, _args: unknown, options: {
    env?: Record<string, string>;
  } = {}) => {
    childEnv = options.env ?? {};
    const child = new EventEmitter() as EventEmitter & {
      kill: ReturnType<typeof vi.fn>;
      pid: number;
      stderr: PassThrough;
      stdin: PassThrough;
      stdout: PassThrough;
    };
    child.kill = vi.fn();
    child.pid = 45_678;
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdin.on("data", (chunk: Buffer | string) => {
      stdinPayload += String(chunk);
    });

    queueMicrotask(() => {
      child.emit("message", createHostedExecutionRunnerChildResultMessage({
        ok: true,
        result: createRunnerResult(),
      }));
      child.stdout.end();
      child.emit("close", 0);
    });

    return child;
  });

  await module.runHostedWorkspaceInvocationIsolatedDetailed({
    internalWorkerProxyToken: "fixture-invocation-token",
    job,
    localInternalProxyBaseUrl: "http://127.0.0.1:8787",
  });

  expect(stdinPayload.length).toBeGreaterThan(0);
  return {
    childEnv,
    stdinPayload,
  };
}

function createLauncherDirectories(
  root: string,
): HostedRunnerChildLauncherDirectories {
  return {
    cacheRoot: `${root}/cache`,
    homeRoot: `${root}/home`,
    huggingFaceRoot: `${root}/hf-home`,
    tempRoot: `${root}/tmp`,
  };
}

function createRunnerResult() {
  return {
    nextWakeAt: null,
    redactedStatus: {
      importedCount: 0,
    },
    status: "idle" as const,
  };
}

function assertNoUnreviewedStaticSecretKeys(
  surface: string,
  value: unknown,
): void {
  expect(collectUnreviewedStaticSecretKeys(value, surface)).toEqual([]);
}

function collectUnreviewedStaticSecretKeys(
  value: unknown,
  surface: string,
): string[] {
  const findings: string[] = [];
  collectSecretKeyFindings(value, surface, findings);
  return findings;
}

function collectSecretKeyFindings(
  value: unknown,
  path: string,
  findings: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectSecretKeyFindings(entry, `${path}[${index}]`, findings);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const keyPath = `${path}.${key}`;
    if (
      isHostedStaticSecretKey(key, keyPath)
      && !isTemporarilyAllowlistedHostedSecretKey(key, keyPath)
    ) {
      findings.push(keyPath);
    }
    collectSecretKeyFindings(nested, keyPath, findings);
  }
}

function isHostedStaticSecretKey(key: string, path: string): boolean {
  const normalized = normalizeSecretKey(key);
  return HOSTED_SECRET_KEY_PATTERN.test(normalized)
    || REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS.includes(
      key as (typeof REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS)[number],
    )
    || (normalized === "CLIENT_ID" && path.includes(".providerConfigs."));
}

function isTemporarilyAllowlistedHostedSecretKey(
  key: string,
  path: string,
): boolean {
  void key;
  return TEMPORARY_HOSTED_JOB_SECRET_PATH_ALLOWLIST.has(path);
}

function collectExactKeyPaths(value: unknown, targetKey: string): string[] {
  const paths: string[] = [];
  collectExactKeyPathFindings(value, targetKey, "", paths);
  return paths;
}

function collectExactKeyPathFindings(
  value: unknown,
  targetKey: string,
  path: string,
  paths: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      collectExactKeyPathFindings(entry, targetKey, `${path}[${index}]`, paths);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    const keyPath = path.length === 0 ? key : `${path}.${key}`;
    if (key === targetKey) {
      paths.push(keyPath);
    }
    collectExactKeyPathFindings(nested, targetKey, keyPath, paths);
  }
}

function normalizeSecretKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replace(/[^A-Z0-9]+/giu, "_")
    .toUpperCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildAllowedSecretPaths(
  prefixes: readonly string[],
  suffixes: readonly string[],
): string[] {
  return prefixes.flatMap((prefix) =>
    suffixes.map((suffix) => `${prefix}.${suffix}`),
  );
}
