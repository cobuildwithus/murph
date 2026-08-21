import { afterEach, expect, it, vi } from "vitest";

import type {
  HostedExecutionWorkspaceInvocationJobInput,
} from "../src/runner-job-transport.ts";
import {
  buildHostedRunnerContainerEnv,
  buildHostedRunnerJobRuntimeConfig,
} from "../src/runner-env.js";
import {
  RunnerContainer,
} from "../src/runner-container.ts";
import {
  HOSTED_RUNTIME_ARCHITECTURE_VERSION,
} from "../src/hosted-runtime-architecture.ts";
import {
  buildHostedExecutionJobRuntime,
} from "../src/hosted-workspace-invocation.ts";

const mocks = vi.hoisted(() => ({
  emitHostedExecutionStructuredLog: vi.fn(),
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

const HOSTED_SECRET_KEY_PATTERN =
  /(?:API_KEY|TOKEN|SECRET|PRIVATE_JWK|PRIVATE_KEY|CLIENT_SECRET|PASSWORD)/iu;

const REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS = [
  "ELEVENLABS_API_KEY",
  "EXA_API_KEY",
  "GEMINI_API_KEY",
  "XAI_API_KEY",
  "OPENAI_API_KEY",
  "HOSTED_AI_USAGE_REPORTING_SECRET",
  "HOSTED_LOG_FINGERPRINT_SECRET",
  "HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET",
  "LINQ_API_TOKEN",
  "MAPBOX_ACCESS_TOKEN",
  "MURPH_DATA_API_KEY",
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
  "ELEVENLABS_API_KEY",
  "EXA_API_KEY",
  "GEMINI_API_KEY",
  "XAI_API_KEY",
  "LINQ_API_TOKEN",
  "MAPBOX_ACCESS_TOKEN",
  "OPENAI_API_KEY",
  "MURPH_DATA_API_KEY",
] as const;

const CURRENT_PLATFORM_SECRET_KEYS = [
  "JUNCTION_API_KEY",
  "JUNCTION_CLIENT_USER_ID_SECRET",
  "TELEGRAM_BOT_TOKEN",
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
      "direct runtime.forwardedEnv",
      "runtime.forwardedEnv",
      "serialized job input.runtime.forwardedEnv",
      "job payload sent to container.job.runtime.forwardedEnv",
    ],
    CURRENT_FORWARDED_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "direct runtime.platformEnv",
      "runtime.platformEnv",
      "serialized job input.runtime.platformEnv",
      "job payload sent to container.job.runtime.platformEnv",
    ],
    CURRENT_PLATFORM_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "direct runtime.userEnv",
      "runtime.userEnv",
      "serialized job input.runtime.userEnv",
      "job payload sent to container.job.runtime.userEnv",
    ],
    CURRENT_USER_SECRET_KEYS,
  ),
  ...buildAllowedSecretPaths(
    [
      "direct runtime.resolvedConfig",
      "runtime.resolvedConfig",
      "serialized job input.runtime.resolvedConfig",
      "job payload sent to container.job.runtime.resolvedConfig",
    ],
    CURRENT_RESOLVED_CONFIG_SECRET_SUFFIXES,
  ),
  ...buildAllowedSecretPaths(
    [
      "serialized job input.diagnostics",
      "job payload sent to container.job.diagnostics",
    ],
    ["workspaceSnapshotPathHashSecret"],
  ),
]);

afterEach(() => {
  vi.restoreAllMocks();
});

it("guards hosted runner job JSON and direct invocation surfaces against unreviewed static secret keys", async () => {
  expect([...TEMPORARY_REVIEWED_HOSTED_SECRET_KEYS].sort()).toEqual(
    [...REASONABLY_AVAILABLE_HOSTED_SECRET_KEYS].sort(),
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
  const job = createWorkspaceJob(runtime, {
    workspaceSnapshotPathHashSecret: "a".repeat(64),
  });
  const directRuntime = buildHostedExecutionJobRuntime({
    requestedRuntime: runtime,
    supervisorEnv: configSource,
  });
  const serializedJobInput = JSON.stringify(job);
  const containerRequestBody = await serializeContainerRequestBody(job);
  expect(serializedJobInput).not.toContain(configSource.HOSTED_LOG_FINGERPRINT_SECRET);
  expect(containerRequestBody).not.toContain(configSource.HOSTED_LOG_FINGERPRINT_SECRET);
  expect(serializedJobInput).not.toContain(runnerSecrets.HOSTED_LOG_FINGERPRINT_SECRET);
  expect(containerRequestBody).not.toContain(runnerSecrets.HOSTED_LOG_FINGERPRINT_SECRET);
  expect(serializedJobInput).not.toContain(
    configSource.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
  );
  expect(containerRequestBody).not.toContain(
    configSource.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
  );
  expect(serializedJobInput).not.toContain(
    runnerSecrets.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
  );
  expect(containerRequestBody).not.toContain(
    runnerSecrets.HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET,
  );
  const scannedSurfaces = {
    "direct runtime.forwardedEnv": directRuntime.forwardedEnv ?? {},
    "direct runtime.platformEnv": directRuntime.platformEnv ?? {},
    "direct runtime.resolvedConfig": directRuntime.resolvedConfig ?? {},
    "direct runtime.userEnv": directRuntime.userEnv ?? {},
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
    HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "runner-callback.example.test",
    HOSTED_EXECUTION_RUNNER_ENV_PROFILES: "exa,hosted-email,linq,mapbox,telegram",
    HOSTED_LOG_FINGERPRINT_SECRET: "fixture-log-fingerprint-secret",
    HOSTED_PROVIDER_EGRESS_CREDENTIAL_SIGNING_SECRET:
      "fixture-provider-egress-signing-secret",
    ELEVENLABS_API_KEY: "fixture-elevenlabs-token",
    HOSTED_WEB_BASE_URL: "https://web.example.test",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK:
      '{"kty":"EC","d":"fixture-callback"}',
    JUNCTION_API_KEY: "sk_us_fixture_junction_api_key",
    JUNCTION_CLIENT_USER_ID_SECRET: "fixture-junction-user-secret",
    JUNCTION_ENV: "sandbox",
    JUNCTION_REGION: "us",
    EXA_API_KEY: "fixture-exa-token",
    GEMINI_API_KEY: "fixture-gemini-token",
    XAI_API_KEY: "fixture-xai-token",
    LINQ_API_BASE_URL: "https://linq.example.test",
    LINQ_API_TOKEN: "fixture-linq-token",
    MAPBOX_ACCESS_TOKEN: "fixture-mapbox-token",
    MURPH_DATA_API_KEY: "fixture-data-api-key",
    NODE_ENV: "production",
    OURA_CLIENT_ID: "fixture-oura-client-id",
    OURA_CLIENT_SECRET: "fixture-oura-client-secret",
    TELEGRAM_API_BASE_URL: "https://telegram.example.test",
    TELEGRAM_BOT_TOKEN: "fixture-telegram-token",
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
  diagnostics?: HostedExecutionWorkspaceInvocationJobInput["diagnostics"],
): HostedExecutionWorkspaceInvocationJobInput {
  return {
    ...(diagnostics ? { diagnostics } : {}),
    kind: "workspace-invocation",
    request: {
      attemptId: "attempt_secret_invariant",
      leaseGeneration: "1",
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
    HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "runner-callback.example.test",
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
        return new Response(JSON.stringify({
          hostedRuntimeArchitectureVersion: HOSTED_RUNTIME_ARCHITECTURE_VERSION,
          ok: true,
        }), {
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
