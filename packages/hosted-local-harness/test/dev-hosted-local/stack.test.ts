import { access, copyFile, cp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BufferedNamedChildProcess,
  HostedLocalChildProcess,
  HostedLocalChildProcessName,
  HostedLocalDevConfig,
} from "../../src/dev-hosted-local/types.ts";
import type { HostedLocalWorkerPortMode } from "../../src/dev-hosted-local/runtime.ts";
import type { HostedLocalTemporalRuntime } from "../../src/dev-hosted-local/temporal.ts";

type HostedLocalLinqWebhookSetup = {
  phoneNumbers: readonly string[] | null;
  publicBaseUrl: string;
  shouldRegister: boolean;
  shouldStartTunnel: boolean;
  targetUrl: string;
  tunnelConfigPath: string | null;
  tunnelName: string | null;
};

class CapturingWritable extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    callback();
  }

  text(): string {
    return this.chunks.join("");
  }
}

const defaultConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookRegistrationCachePath: ".tmp/linq-webhook-registration.json",
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "disabled",
  linqWebhookTunnelName: "dev",
  skipHealthCommonsWatch: true,
  skipLinqWebhookRegister: false,
  skipRunnerSmoke: false,
  skipPrismaMigrate: false,
  skipStripeListen: true,
  skipWeb: false,
  skipVercelPull: false,
  temporal: {
    host: "127.0.0.1",
    mode: "disabled",
    namespace: "default",
    port: 7233,
    taskQueue: "murph-hosted-runtime",
  },
  useVercelDatabaseUrl: false,
  webHost: "localhost",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const hostedLocalE2eRunnerSmokeOnceEnv =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_ONCE";
const hostedLocalE2eRunnerSmokeProvedBuildIdEnv =
  "MURPH_HOSTED_LOCAL_E2E_RUNNER_SMOKE_PROVED_BUILD_ID";

const runCommand = vi.fn<(
  command: string,
  args: string[],
  input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    name: "setup";
  },
) => Promise<void>>(async () => {});
let nextChildPid = 100;
const spawnChildProcess = vi.fn<
  (
    name: HostedLocalChildProcessName,
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    input?: {
      pipeOutput?: boolean;
      stderrTarget?: NodeJS.WritableStream;
      stdoutTarget?: NodeJS.WritableStream;
    },
  ) => BufferedNamedChildProcess
>((name) =>
  createBufferedChild({
    exitCode: null,
    name,
    pid: nextChildPid++,
  }),
);
class StripeCliMissingError extends Error {
  constructor() {
    super("stripe CLI executable was not found on PATH");
    this.name = "StripeCliMissingError";
  }
}
const spawnHostedLocalDockerEventsForensics = vi.fn<
  (
    env: NodeJS.ProcessEnv,
    input?: {
      pipeOutput?: boolean;
      stderrTarget?: NodeJS.WritableStream;
      stdoutTarget?: NodeJS.WritableStream;
    },
  ) => BufferedNamedChildProcess
>(() =>
  createBufferedChild({
    exitCode: null,
    name: "docker-events",
    pid: nextChildPid++,
  }),
);
const spawnStripeListenerWithSecretCapture = vi.fn<
  (input: {
    command: string;
    args: string[];
    env: NodeJS.ProcessEnv;
    pipeOutput?: boolean;
    stderrTarget?: NodeJS.WritableStream;
    stdoutTarget?: NodeJS.WritableStream;
    timeoutMs: number;
  }) => Promise<{ child: BufferedNamedChildProcess; secret: string }>
>();
const terminateChildProcessAndWait = vi.fn(async () => {});
const terminateChildProcess = vi.fn(() => {});
const waitForHealthyHttpEndpoint = vi.fn(async () => {});
const resolveHostedLocalWorkerPortMode = vi.fn<
  (input: {
    host: string;
    message: string;
    port: number;
    protocol: "http" | "https";
  }) => Promise<HostedLocalWorkerPortMode>
>(async () => "start");
const waitForFirstChildExit = vi.fn<(
  children: readonly BufferedNamedChildProcess[],
) => Promise<BufferedNamedChildProcess>>(() => new Promise(() => {}));
const cleanupHostedRunnerContainers = vi.fn<
  (input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    ignoreErrors?: boolean;
    scope?: "all-builds" | "current-build";
  }) => Promise<void>
>(async () => {});
const cleanupHostedRunnerImages = vi.fn<
  (input: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    ignoreErrors?: boolean;
    scope?: "all-builds" | "current-build";
  }) => Promise<void>
>(async () => {});
const cleanupHostedRunnerContainerLocalState = vi.fn<
  (input: {
    env: NodeJS.ProcessEnv;
    ignoreErrors?: boolean;
    persistDir: string;
  }) => Promise<void>
>(async () => {});
const collectDockerDevDiagnostics = vi.fn(async () => "Docker diagnostics:\n- docker version: ok");
const DEFAULT_CODEX_MODEL_CATALOG_TEXT = JSON.stringify({
  models: [
    {
      name: "GPT-5.5",
      service_tiers: [
        {
          id: "priority",
          name: "Priority",
        },
      ],
      slug: "gpt-5.6-terra",
    },
    {
      display_name: "GPT-5.4-Mini",
      priority: 4,
      service_tiers: [],
      slug: "gpt-5.4-mini",
    },
  ],
});
const defaultSpawnSyncImplementation = (
  command: string,
  args: readonly string[],
): {
  error: undefined;
  status: number;
  stdout: string;
} => {
  if (
    command === "codex" &&
    args[0] === "debug" &&
    args[1] === "models" &&
    args[2] === "--bundled"
  ) {
    return {
      error: undefined,
      status: 0,
      stdout: DEFAULT_CODEX_MODEL_CATALOG_TEXT,
    };
  }

  return {
    error: undefined,
    status: 0,
    stdout: "",
  };
};
const spawnSync = vi.fn<(
  command: string,
  args: readonly string[],
  options?: unknown,
) => {
  error: undefined;
  status: number;
  stdout: string;
}>(defaultSpawnSyncImplementation);
const resolveHostedLocalLinqWebhookSetup = vi.fn<
  (input: {
    config: HostedLocalDevConfig;
    env: NodeJS.ProcessEnv;
  }) => Promise<HostedLocalLinqWebhookSetup | null>
>(async () => null);
const registerHostedLocalLinqWebhookSubscription = vi.fn(
  async (input: { env: NodeJS.ProcessEnv }) => ({
    webhookSecret: input.env.LINQ_WEBHOOK_SECRET ?? "linq-webhook-secret",
    webhookSecretSource: "configured" as const,
  }),
);
const STUB_ID_TOKEN = buildFakeJwtPayload({ iss: "https://auth.openai.com", sub: "user-1" });
const STUB_CODEX_SUBSCRIPTION_AUTH_JSON = Buffer.from(
  JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgptAuthTokens",
    last_refresh: "2026-06-11T00:00:00.000Z",
    tokens: {
      access_token: "stub-access-token",
      account_id: "stub-account-id",
      id_token: STUB_ID_TOKEN,
      refresh_token: "",
    },
  }),
  "utf8",
).toString("base64url");
const resolveHostedLocalCodexSubscriptionAuthEnvValue = vi.fn(
  async () => STUB_CODEX_SUBSCRIPTION_AUTH_JSON,
);
const maybeStartHostedLocalMinio = vi.fn<
  (input: unknown) => Promise<{
    containerName: string;
    env: Record<string, string>;
    ensureReady: () => Promise<BufferedNamedChildProcess | null>;
    process: BufferedNamedChildProcess;
    processes: () => readonly BufferedNamedChildProcess[];
  } | null>
>(async () => null);
const cleanupHostedLocalMinioContainerBestEffort = vi.fn(async () => {});
const startHostedLocalTemporalRuntime = vi.fn<
  (input: unknown) => Promise<HostedLocalTemporalRuntime | null>
>(async () => null);
const requireHostedLocalTemporalWorkerPackageDir = vi.fn(
  (source: Readonly<Record<string, string | undefined>>): string => {
    const packageDir =
      source.MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR?.trim() || null;
    if (!packageDir) {
      throw new Error(
        "Hosted-local Temporal requires an external worker package. Set MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR or set MURPH_DEV_TEMPORAL=disabled.",
      );
    }
    return packageDir;
  },
);

vi.mock("node:fs/promises", () => ({
  access: vi.fn(async () => {
    const error = new Error("not found") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    throw error;
  }),
  chmod: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
  cp: vi.fn(async () => {}),
  mkdir: vi.fn(async () => {}),
  mkdtemp: vi.fn(async () => "/tmp/murph-dev-env-test"),
  readFile: vi.fn(async () => {
    const error = new Error("File not found") as Error & { code: string };
    error.code = "ENOENT";
    throw error;
  }),
  rename: vi.fn(async () => {}),
  rm: vi.fn(async () => {}),
  symlink: vi.fn(async () => {}),
  utimes: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn((filePath: Parameters<typeof actual.existsSync>[0]) =>
      /[/\\]packages[/\\][^/\\]+[/\\]dist$/u.test(String(filePath))
        || actual.existsSync(filePath)
    ),
  };
});

vi.mock("node:child_process", () => ({
  spawnSync,
}));

vi.mock("../../src/dev-hosted-local/codex-subscription-auth.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/dev-hosted-local/codex-subscription-auth.ts")>()),
  resolveHostedLocalCodexSubscriptionAuthEnvValue,
}));

vi.mock("../../src/dev-hosted-local/config.ts", () => ({
  resolveHostedLocalDevConfig: vi.fn(() => defaultConfig),
}));

vi.mock("../../src/dev-hosted-local/environment.ts", () => ({
  buildHostedRunnerLocalBuildId: vi.fn((value: string | undefined) => {
    const normalized = value?.trim();
    if (!normalized) {
      return "local";
    }
    if (/^sha256-[a-f0-9]{24}$/u.test(normalized)) {
      return normalized;
    }

    let hex = "";
    for (const character of normalized) {
      hex += character.charCodeAt(0).toString(16).padStart(2, "0");
    }
    return `sha256-${hex.padEnd(24, "0").slice(0, 24)}`;
  }),
  buildHostedLocalDevOverrides: vi.fn(() => ({
    DEVICE_SYNC_PUBLIC_BASE_URL: "http://localhost:3000/api/device-sync",
    HOSTED_WEB_BASE_URL: "http://localhost:3000",
  })),
  buildHostedLocalStateEnvFileText: vi.fn(() => 'HOSTED_CRYPTO_ENV="local"'),
  buildWranglerEnvFileText: vi.fn(() => 'HOSTED_WEB_BASE_URL="http://localhost:3000"'),
  buildWranglerLocalDevConfig: vi.fn((
    source: Readonly<Record<string, string | undefined>>,
  ) => {
    const usesTestRoutes =
      source.NODE_ENV === "test" && source.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1";
    return {
      name: "murph-hosted",
      main: usesTestRoutes ? "../src/hosted-local-test-index.ts" : "../src/index.ts",
      ...(usesTestRoutes || source.MURPH_DEV_SKIP_WORKERS_AI === "1"
        ? {}
        : { ai: { binding: "AI" } }),
    };
  }),
  buildWranglerVarArgs: vi.fn((source: Readonly<Record<string, string | undefined>>) => [
    "--var",
    `HOSTED_WEB_BASE_URL:${source.HOSTED_WEB_BASE_URL}`,
    "--var",
    `DEVICE_SYNC_PUBLIC_BASE_URL:${source.DEVICE_SYNC_PUBLIC_BASE_URL}`,
  ]),
  includesWranglerLocalDevAiBinding: vi.fn(
    (source: Readonly<Record<string, string | undefined>>) =>
      !(source.NODE_ENV === "test" && source.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1")
        && source.MURPH_DEV_SKIP_WORKERS_AI !== "1",
  ),
  isHostedLocalTruthyEnvValue: vi.fn((value: string | undefined) => {
    const normalized = value?.trim().toLowerCase();
    return normalized !== undefined && ["1", "true", "yes", "on"].includes(normalized);
  }),
  usesWranglerLocalDevTestRoutes: vi.fn(
    (source: Readonly<Record<string, string | undefined>>) =>
      source.NODE_ENV === "test" && source.MURPH_HOSTED_LOCAL_TEST_ROUTES === "1",
  ),
  normalizeLocalDatabaseUrl: vi.fn((value: string | undefined) => value ?? "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync"),
  resolveHostedLocalDatabaseUrl: vi.fn((input: {
    databaseUrlOverride?: string | null;
    fallbackUrl?: string;
    pulledDatabaseUrl?: string;
    repoDatabaseUrl?: string;
    shellDatabaseUrl?: string;
    useVercelDatabaseUrl?: boolean;
  }) =>
    input.databaseUrlOverride
      ?? input.shellDatabaseUrl
      ?? (input.useVercelDatabaseUrl ? input.pulledDatabaseUrl ?? input.repoDatabaseUrl : undefined)
      ?? input.fallbackUrl
      ?? "postgresql://postgres:postgres@127.0.0.1:5432/murph_device_sync"
  ),
  shouldSyncLocalDatabaseSchema: vi.fn(() => true),
  readOptionalSimpleEnvFile: vi.fn(async () => ({
    HOSTED_ASSISTANT_PROVIDER: "openai",
    OPENAI_API_KEY: "local-openai-key",
  })),
  readHostedLocalStripeEnvFile: vi.fn(async () => ({})),
  readSimpleEnvFile: vi.fn(async () => ({})),
  requireEnvValue: vi.fn(),
  resolveCloudflareLocalEnv: vi.fn(async (input: { overrides?: Record<string, string | undefined> }) => ({
    ...Object.fromEntries(
      Object.entries(input.overrides ?? {}).filter(([name]) =>
        /^(?:HOSTED_)?TEMPORAL_/u.test(name)
      ),
    ),
    HOSTED_ASSISTANT_MODEL: input.overrides?.HOSTED_ASSISTANT_MODEL ?? "gpt-5.6-terra",
    HOSTED_ASSISTANT_PROVIDER:
      input.overrides?.HOSTED_ASSISTANT_PROVIDER ?? "openai",
    OPENAI_API_KEY: input.overrides?.OPENAI_API_KEY,
    DEVICE_SYNC_PUBLIC_BASE_URL: "http://127.0.0.1:1/api/device-sync",
    HOSTED_EXECUTION_RUNNER_HOST_ALIAS:
      input.overrides?.HOSTED_EXECUTION_RUNNER_HOST_ALIAS
      ?? "127.0.0.1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_KEY_VERSION: "projects/test/cryptoKeyVersions/1",
    HOSTED_CRYPTO_AUTHORITY_SIGN_PUBLIC_KEY_PEM:
      "-----BEGIN PUBLIC KEY-----\\nabc\\n-----END PUBLIC KEY-----",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_KEY_ID: "cloudflare-automation:local",
    HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: JSON.stringify({
      crv: "P-256",
      d: "automation-d",
      kty: "EC",
      x: "automation-x",
      y: "automation-y",
    }),
    HOSTED_CRYPTO_ENV: "development",
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "local-callback-private",
    NODE_ENV: input.overrides?.NODE_ENV,
  })),
  resolveHostedLocalClientWorkerHost: vi.fn((workerHost: string) =>
    workerHost === "0.0.0.0" ? "127.0.0.1" : workerHost
  ),
  resolveHostedLocalPersistentCryptoStatePath: vi.fn((env: Record<string, string | undefined>) => {
    const profile = env.MURPH_HOSTED_LOCAL_PROFILE;
    if (
      env.MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED === "1"
      || profile === "e2e:stub"
      || profile === "e2e:live"
    ) {
      return null;
    }
    if (env.MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH) {
      return `/repo/${env.MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH}`;
    }
    return "/tmp/murph-dev-crypto-state.dev.vars";
  }),
  warnForMissingEnv: vi.fn(),
}));

vi.mock("../../src/dev-hosted-local/linq-webhook-tunnel.ts", () => ({
  registerHostedLocalLinqWebhookSubscription,
  resolveHostedLocalLinqWebhookSetup,
}));

vi.mock("../../src/dev-hosted-local/minio.ts", () => ({
  cleanupHostedLocalMinioContainerBestEffort,
  maybeStartHostedLocalMinio,
}));

vi.mock("../../src/dev-hosted-local/temporal.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/dev-hosted-local/temporal.ts")>()),
  requireHostedLocalTemporalWorkerPackageDir,
  startHostedLocalTemporalRuntime,
}));

vi.mock("../../src/dev-hosted-local/runtime.ts", () => ({
  assertHostedWebDevServerAvailable: vi.fn(async () => {}),
  assertPortAvailable: vi.fn(async () => {}),
  cleanupHostedRunnerContainerLocalState,
  cleanupHostedRunnerContainers,
  cleanupHostedRunnerImages,
  collectDockerDevDiagnostics,
  redactHostedLocalDiagnosticText: (value: string) => value,
  resolveHostedLocalWorkerPortMode,
  runCommand,
  spawnChildProcess,
  spawnHostedLocalDockerEventsForensics,
  spawnStripeListenerWithSecretCapture,
  StripeCliMissingError,
  terminateChildProcess,
  terminateChildProcessAndWait,
  throwIfAbortSignalAborted: vi.fn((signal?: AbortSignal) => {
    if (signal?.aborted) {
      const error = new Error("Hosted-local startup was interrupted.");
      error.name = "AbortError";
      throw error;
    }
  }),
  waitForFirstChildExit,
  waitForHealthyHttpEndpoint,
}));

vi.mock("../../src/dev-hosted-local/vercel.ts", () => ({
  ensureVercelLinkExists: vi.fn(async () => {}),
  parseHostedExecutionOidcIdentity: vi.fn(() => ({
    environment: "development",
    projectName: "murph",
    teamSlug: "cobuildwithus",
  })),
  resolveVercelOidcToken: vi.fn(async () => "oidc-token"),
}));

function createBufferedChild(input: {
  exitCode: number | null;
  name: HostedLocalChildProcessName;
  pid: number;
  stderrText?: string;
  stdoutText?: string;
}): BufferedNamedChildProcess {
  const child: HostedLocalChildProcess = {
    exitCode: input.exitCode,
    kill: vi.fn(() => true),
    once: vi.fn(function once(this: HostedLocalChildProcess) {
      return this;
    }),
    pid: input.pid,
    signalCode: null,
  };

  return {
    child,
    name: input.name,
    stderrTail: (maxChars?: number) => tailForTest(input.stderrText ?? "", maxChars),
    stderrText: () => input.stderrText ?? "",
    stdoutTail: (maxChars?: number) => tailForTest(input.stdoutText ?? "", maxChars),
    stdoutText: () => input.stdoutText ?? "",
  };
}

function tailForTest(value: string, maxChars: number = 2_000): string {
  return value.length <= maxChars ? value : value.slice(value.length - maxChars);
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

describe("hosted local dev stack", () => {
  beforeEach(() => {
    vi.stubEnv("HOSTED_EXECUTION_RUNNER_HOST_ALIAS", "host.docker.internal");
  });

  afterEach(() => {
    vi.clearAllMocks();
    runCommand.mockImplementation(async () => {});
    spawnSync.mockImplementation(defaultSpawnSyncImplementation);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("starts Cloudflare with web-only process environment overrides", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const inheritedAppSessionHmacKey = Buffer.alloc(32, 9).toString("base64url");
    const localAppSessionHmacKey = Buffer.alloc(32, 8).toString("base64url");
    vi.stubEnv("HOSTED_APP_SESSION_HMAC_KEY", inheritedAppSessionHmacKey);
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));
    vi.mocked(access).mockImplementation(async (filePath) => {
      const value = String(filePath);
      if (
        /node_modules[/\\](?:zod|jose)$/u.test(value)
        || /node_modules[/\\]@cloudflare[/\\]containers$/u.test(value)
      ) {
        return;
      }

      const error = new Error("not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    });

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const runtimeModule = await import("../../src/dev-hosted-local/runtime.ts");
    const vercelModule = await import("../../src/dev-hosted-local/vercel.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");
    vi.mocked(runtimeModule.assertHostedWebDevServerAvailable).mockImplementationOnce(
      async () => {
        expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
      },
    );
    resolveHostedLocalWorkerPortMode.mockImplementationOnce(async () => {
      expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
      return "start";
    });
    startHostedLocalTemporalRuntime.mockImplementationOnce(async () => {
      expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
      return null;
    });

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_APP_SESSION_HMAC_KEY: inheritedAppSessionHmacKey,
        LINQ_API_BASE_URL: "http://host.docker.internal:4011",
      },
      webProcessEnvOverrides: {
        LINQ_API_BASE_URL: "http://127.0.0.1:4011",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(process.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(stack.runtimeEnv.LINQ_API_BASE_URL).toBe(
      "http://host.docker.internal:4011",
    );
    expect(stack.runtimeEnv.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(stack.workerRuntimeEnv?.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(startHostedLocalTemporalRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          LINQ_API_BASE_URL: "http://host.docker.internal:4011",
        }),
      }),
    );

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      [
        "--dir",
        "apps/cloudflare",
        "worker:dev:prepared",
        "--",
        "--ip",
        "127.0.0.1",
        "--port",
        "8787",
        "--config",
        "/tmp/murph-dev-env-test/cloudflare-worker.local-dev.generated.json",
        "--local-protocol",
        "http",
        "--persist-to",
        "/tmp/murph-dev-env-test/wrangler-state",
        "--env-file",
        "/tmp/murph-dev-env-test/cloudflare-worker.env",
        "--var",
        "HOSTED_WEB_BASE_URL:http://localhost:3000",
        "--var",
        "DEVICE_SYNC_PUBLIC_BASE_URL:http://localhost:3000/api/device-sync",
      ],
      expect.objectContaining({
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
        HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK:
          expect.stringContaining("automation-d"),
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
        NODE_ENV: "development",
        TSX_TSCONFIG_PATH: expect.stringMatching(/tsconfig\.base\.json$/),
        LINQ_API_BASE_URL: "http://host.docker.internal:4011",
        OPENAI_API_KEY: "local-openai-key",
        VERCEL_OIDC_TOKEN: "oidc-token",
      }),
      expect.any(Object),
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      "pnpm",
      expect.arrayContaining([
        "apps/web/scripts/dev-local.ts",
        "--",
        "--hostname",
        "localhost",
        "--port",
        "3000",
      ]),
      expect.objectContaining({
        LINQ_API_BASE_URL: "http://127.0.0.1:4011",
        MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      }),
      expect.any(Object),
    );
    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const devWebCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    expect(cloudflareCall?.[3].HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(devWebCall?.[3].HOSTED_APP_SESSION_HMAC_KEY).toBe(localAppSessionHmacKey);
    expect(devWebCall?.[3].HOSTED_APP_SESSION_HMAC_KEY).not.toBe(
      inheritedAppSessionHmacKey,
    );
    expect(
      vi.mocked(vercelModule.resolveVercelOidcToken).mock.calls.at(-1)?.[0]
        .HOSTED_APP_SESSION_HMAC_KEY,
    ).toBeUndefined();
    expect(
      vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0]
        .overrides?.HOSTED_APP_SESSION_HMAC_KEY,
    ).toBeUndefined();
    for (const [name, , , env] of spawnChildProcess.mock.calls) {
      if (name !== "web") {
        expect(env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
      }
    }
    for (const [, , options] of runCommand.mock.calls) {
      expect(options.env?.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    }
    for (const [input] of spawnStripeListenerWithSecretCapture.mock.calls) {
      expect(input.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    }
    for (const [input] of startHostedLocalTemporalRuntime.mock.calls) {
      expect(input.env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    }
    expect(
      vi.mocked(environmentModule.buildWranglerEnvFileText).mock.calls.at(-1)?.[0]
        .HOSTED_APP_SESSION_HMAC_KEY,
    ).toBeUndefined();
    expect(
      vi.mocked(environmentModule.buildWranglerLocalDevConfig).mock.calls.at(-1)?.[0]
        .HOSTED_APP_SESSION_HMAC_KEY,
    ).toBeUndefined();
    expect(devWebCall?.[2]).not.toContain("start");
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:generate"],
      expect.any(Object),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"],
      expect.any(Object),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "runner:bundle:hosted-local"],
      expect.objectContaining({
        cwd: expect.stringContaining("murph"),
        env: expect.objectContaining({
          MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: expect.stringMatching(/^sha256-[a-f0-9]{24}$/u),
          MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS: "1",
        }),
        name: "setup",
      }),
    );
    const runnerBundleCall = runCommand.mock.calls.find(([, args]) =>
      args.includes("runner:bundle:hosted-local")
    );
    expect(runnerBundleCall?.[2].env.HOSTED_APP_SESSION_HMAC_KEY).toBeUndefined();
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "deploy:smoke"],
      expect.objectContaining({
        cwd: expect.stringContaining("murph"),
        env: expect.objectContaining({
          HOSTED_EXECUTION_SMOKE_RUNNER_CONTAINER: "true",
          HOSTED_EXECUTION_SMOKE_RUNNER_MAX_ATTEMPTS: "30",
          HOSTED_EXECUTION_SMOKE_RUNNER_RETRY_DELAY_MS: "1000",
          HOSTED_EXECUTION_SMOKE_WORKER_BASE_URL: "http://127.0.0.1:8787",
        }),
        name: "setup",
      }),
    );
    expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
      expect.stringContaining("Dockerfile.cloudflare-hosted-runner"),
      "/tmp/murph-dev-env-test/cloudflare-source/Dockerfile.cloudflare-hosted-runner",
    );
    expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
      expect.stringContaining("apps/cloudflare/package.json"),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/package.json",
    );
    expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
      expect.stringContaining("apps/cloudflare/.dockerignore"),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/.dockerignore",
    );
    expect(vi.mocked(cp)).toHaveBeenCalledWith(
      expect.stringContaining("apps/cloudflare/src"),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/src",
      { recursive: true },
    );
    expect(vi.mocked(cp)).toHaveBeenCalledWith(
      expect.stringContaining("apps/cloudflare/.deploy/runner-bundle"),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/.deploy/runner-bundle",
      { recursive: true },
    );
    expect(vi.mocked(copyFile)).toHaveBeenCalledWith(
      expect.stringMatching(/packages[/\\]assistant-engine[/\\]package\.json$/u),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/node_modules/@murphai/assistant-engine/package.json",
    );
    expect(vi.mocked(cp)).toHaveBeenCalledWith(
      expect.stringMatching(/packages[/\\]assistant-engine[/\\]dist$/u),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/node_modules/@murphai/assistant-engine/dist",
      { recursive: true },
    );
    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      expect.stringMatching(/packages[/\\]contracts[/\\]node_modules[/\\]zod$/u),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/node_modules/@murphai/contracts/node_modules/zod",
      "dir",
    );
    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      expect.stringMatching(/apps[/\\]cloudflare[/\\]node_modules[/\\]jose$/u),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/node_modules/jose",
      "dir",
    );
    expect(vi.mocked(symlink)).not.toHaveBeenCalledWith(
      expect.stringContaining("apps/cloudflare/node_modules"),
      "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare/node_modules",
      "dir",
    );
    expect(vi.mocked(environmentModule.buildWranglerLocalDevConfig)).toHaveBeenCalledWith(
      expect.objectContaining({
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID: "1",
      }),
      {
        cloudflareAppDir: "/tmp/murph-dev-env-test/cloudflare-source/apps/cloudflare",
        configDir: "/tmp/murph-dev-env-test",
        workspaceRoot: "/tmp/murph-dev-env-test/cloudflare-source",
      },
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/cloudflare-worker.env",
      expect.any(String),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/cloudflare-worker.dev.vars",
      expect.any(String),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/hosted-local-state.dev.vars",
      'HOSTED_CRYPTO_ENV="local"\n',
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    const cryptoStateWrite = vi.mocked(writeFile).mock.calls.find(([filePath]) =>
      String(filePath).startsWith("/tmp/murph-dev-crypto-state.dev.vars.")
      && String(filePath).endsWith(".tmp")
    );
    if (!cryptoStateWrite) {
      throw new Error("missing atomic crypto state temp write");
    }
    const [cryptoStateTempPath, cryptoStateText, cryptoStateWriteOptions] =
      cryptoStateWrite;
    expect(cryptoStateText).toBe('HOSTED_CRYPTO_ENV="local"\n');
    expect(cryptoStateWriteOptions).toMatchObject({
      encoding: "utf8",
      mode: 0o600,
    });
    expect(vi.mocked(rename)).toHaveBeenCalledWith(
      cryptoStateTempPath,
      "/tmp/murph-dev-crypto-state.dev.vars",
    );
    expect(vi.mocked(symlink)).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/cloudflare-worker.dev.vars",
      expect.stringContaining("apps/cloudflare/.dev.vars"),
    );
    expect(vi.mocked(rename)).not.toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/hosted-local-state.dev.vars",
      expect.stringContaining("apps/cloudflare/.dev.vars"),
    );
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledTimes(2);
    expect(cleanupHostedRunnerContainers).toHaveBeenNthCalledWith(1, expect.objectContaining({
      scope: "all-builds",
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current-build",
    }));
    expect(cleanupHostedRunnerContainerLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        persistDir: "/tmp/murph-dev-env-test/wrangler-state",
      }),
    );
    expect(stack.config.workerPersistDir).toBe("/tmp/murph-dev-env-test/wrangler-state");
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(2);
    expect(waitForHealthyHttpEndpoint).toHaveBeenNthCalledWith(1, {
      host: "127.0.0.1",
      label: "cloudflare",
      path: "/health",
      port: 8787,
      protocol: "http",
    });
    expect(waitForHealthyHttpEndpoint).toHaveBeenNthCalledWith(2, {
      host: "localhost",
      label: "web",
      path: "/api/internal/health",
      port: 3000,
      protocol: "http",
    });
  });

  it("marks the final wrangler command to ignore CLOUDFLARE_API_TOKEN when the Workers AI binding is active", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "account-scoped-token");
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));

    const {
      STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV,
    } = await import("../../src/dev-hosted-local/constants.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    const cloudflareSpawn = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    expect(cloudflareSpawn?.[2]).toEqual(expect.arrayContaining(["worker:dev:prepared"]));
    expect(cloudflareSpawn?.[3]).toMatchObject({
      CLOUDFLARE_API_TOKEN: "account-scoped-token",
      [STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV]: "1",
    });
  });

  it("keeps CLOUDFLARE_API_TOKEN for the wrangler child when MURPH_DEV_SKIP_WORKERS_AI is set", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "account-scoped-token");
    vi.stubEnv("MURPH_DEV_SKIP_WORKERS_AI", "1");
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));

    const {
      STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV,
    } = await import("../../src/dev-hosted-local/constants.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    const cloudflareSpawn = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    expect(cloudflareSpawn?.[2]).toEqual(expect.arrayContaining(["worker:dev:prepared"]));
    expect(cloudflareSpawn?.[3]).toMatchObject({
      CLOUDFLARE_API_TOKEN: "account-scoped-token",
    });
    expect(cloudflareSpawn?.[3]).not.toHaveProperty(
      STRIP_CLOUDFLARE_API_TOKEN_FOR_WRANGLER_ENV,
    );
  });

  it("clears remote Temporal env from every disabled-mode child boundary", async () => {
    const temporalEnvNames = [
      "HOSTED_TEMPORAL_ADDRESS",
      "HOSTED_TEMPORAL_API_KEY",
      "HOSTED_TEMPORAL_CLIENT_CERT_BASE64",
      "HOSTED_TEMPORAL_CLIENT_CERT_PEM",
      "HOSTED_TEMPORAL_CLIENT_KEY_BASE64",
      "HOSTED_TEMPORAL_CLIENT_KEY_PEM",
      "HOSTED_TEMPORAL_NAMESPACE",
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
      "HOSTED_TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
      "HOSTED_TEMPORAL_TASK_QUEUE",
      "HOSTED_TEMPORAL_TLS_ENABLED",
      "HOSTED_TEMPORAL_TLS_SERVER_NAME_OVERRIDE",
      "TEMPORAL_ADDRESS",
      "TEMPORAL_API_KEY",
      "TEMPORAL_CLIENT_CERT_BASE64",
      "TEMPORAL_CLIENT_CERT_PEM",
      "TEMPORAL_CLIENT_KEY_BASE64",
      "TEMPORAL_CLIENT_KEY_PEM",
      "TEMPORAL_NAMESPACE",
      "TEMPORAL_SERVER_ROOT_CA_CERT_BASE64",
      "TEMPORAL_SERVER_ROOT_CA_CERT_PEM",
      "TEMPORAL_TASK_QUEUE",
      "TEMPORAL_TLS_ENABLED",
      "TEMPORAL_TLS_SERVER_NAME_OVERRIDE",
    ] as const;
    const remoteValuesFor = (
      source: string,
      names: readonly (typeof temporalEnvNames)[number][],
    ): NodeJS.ProcessEnv => Object.fromEntries(
      names.map((name) => [name, `${source}-${name.toLowerCase()}`]),
    );
    const shellEnv = remoteValuesFor(
      "shell",
      temporalEnvNames.filter((_, index) => index % 4 === 0),
    );
    const pulledEnv = remoteValuesFor(
      "pulled",
      temporalEnvNames.filter((_, index) => index % 4 === 1),
    );
    const webEnv = remoteValuesFor(
      "env",
      temporalEnvNames.filter((_, index) => index % 4 === 2),
    );
    const webLocalEnv = remoteValuesFor(
      "env-local",
      temporalEnvNames.filter((_, index) => index % 4 === 3),
    );
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readOptionalSimpleEnvFile)
      .mockResolvedValueOnce({
        HOSTED_ASSISTANT_PROVIDER: "openai",
        OPENAI_API_KEY: "local-openai-key",
      })
      .mockResolvedValueOnce(webEnv)
      .mockResolvedValueOnce(webLocalEnv);
    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce(pulledEnv);
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 211 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 212 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");
    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        ...shellEnv,
        MURPH_DEV_TEMPORAL: "disabled",
      },
      // The final child overlay must also beat callers that customize Web-only
      // values; dev-local then sees defined empty values before loading .env files.
      webProcessEnvOverrides: remoteValuesFor("web-override", temporalEnvNames),
    });
    await stack.ready;
    await stack.stop();

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    const effectiveEnvironments = [
      stack.runtimeEnv,
      stack.workerRuntimeEnv,
      cloudflareCall?.[3],
      webCall?.[3],
      vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0]
        .overrides,
      vi.mocked(environmentModule.buildWranglerEnvFileText).mock.calls.at(-1)?.[0],
    ];
    for (const environment of effectiveEnvironments) {
      expect(environment).toBeDefined();
      for (const name of temporalEnvNames) {
        expect(environment?.[name], `${name} should be empty`).toBe("");
      }
    }
    expect(stack.processes.temporalServer).toBeNull();
    expect(stack.processes.temporalWorker).toBeNull();
    expect(spawnChildProcess.mock.calls.map(([name]) => name)).not.toContain("temporal-server");
    expect(spawnChildProcess.mock.calls.map(([name]) => name)).not.toContain("temporal-worker");
  });

  it("starts managed Temporal as part of the hosted-local process model", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      temporal: {
        host: "127.0.0.1",
        mode: "managed",
        namespace: "hosted-local-test",
        port: 7243,
        taskQueue: "hosted-local-test-queue",
      },
      workerHost: "0.0.0.0",
    });
    const temporalServer = createBufferedChild({
      exitCode: null,
      name: "temporal-server",
      pid: 201,
    });
    const temporalWorker = createBufferedChild({
      exitCode: null,
      name: "temporal-worker",
      pid: 202,
    });
    startHostedLocalTemporalRuntime.mockResolvedValueOnce({
      address: "127.0.0.1:7243",
      namespace: "hosted-local-test",
      serverProcess: temporalServer,
      stop: vi.fn(async () => {}),
      taskQueue: "hosted-local-test-queue",
      workerProcess: temporalWorker,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 203 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 204 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR:
          "../murph-cloud/packages/hosted-orchestrator-temporal",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(startHostedLocalTemporalRuntime).toHaveBeenCalledWith(expect.objectContaining({
      cloudflareHostedControlBaseUrl: "http://127.0.0.1:8787",
      config: expect.objectContaining({
        temporal: expect.objectContaining({
          mode: "managed",
          port: 7243,
        }),
      }),
      env: expect.objectContaining({
        HOSTED_TEMPORAL_ADDRESS: "127.0.0.1:7243",
        HOSTED_TEMPORAL_NAMESPACE: "hosted-local-test",
        HOSTED_TEMPORAL_TASK_QUEUE: "hosted-local-test-queue",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "local-callback-private",
        TEMPORAL_ADDRESS: "127.0.0.1:7243",
        TEMPORAL_NAMESPACE: "hosted-local-test",
        TEMPORAL_TASK_QUEUE: "hosted-local-test-queue",
      }),
      hostedWebBaseUrl: "http://localhost:3000",
    }));
    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    const webEnv = webCall?.[3] as NodeJS.ProcessEnv;
    expect(webEnv.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();
    expect(stack.processes.temporalServer).toBe(temporalServer);
    expect(stack.processes.temporalWorker).toBe(temporalWorker);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledWith({
      host: "127.0.0.1",
      label: "cloudflare",
      path: "/health",
      port: 8787,
      protocol: "http",
    });
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(4);
    expect(spawnSync.mock.calls.filter(([command]) => command === "pkill")).toEqual([]);
  });

  it("rejects a missing external Temporal worker before stack side effects", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      temporal: {
        host: "127.0.0.1",
        mode: "managed",
        namespace: "hosted-local-test",
        port: 7243,
        taskQueue: "hosted-local-test-queue",
      },
    });
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {},
    })).rejects.toThrow(
      "Hosted-local Temporal requires an external worker package. Set MURPH_DEV_TEMPORAL_WORKER_PACKAGE_DIR or set MURPH_DEV_TEMPORAL=disabled.",
    );

    expect(requireHostedLocalTemporalWorkerPackageDir).toHaveBeenCalledWith({});
    expect(runCommand).not.toHaveBeenCalled();
    expect(spawnChildProcess).not.toHaveBeenCalled();
    expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
    expect(resolveHostedLocalLinqWebhookSetup).not.toHaveBeenCalled();
    expect(registerHostedLocalLinqWebhookSubscription).not.toHaveBeenCalled();
    expect(maybeStartHostedLocalMinio).not.toHaveBeenCalled();
    expect(startHostedLocalTemporalRuntime).not.toHaveBeenCalled();
  });

  it("rejects E2E isolation when a stack would overlap interactive dev defaults", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      },
    })).rejects.toThrow(/MURPH_DEV_WEB_PORT must not use the interactive default/u);

    expect(spawnChildProcess).not.toHaveBeenCalled();
  });

  it("rejects E2E isolation when asked to reuse an interactive worker", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_REUSE_EXISTING_WORKER: "1",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    })).rejects.toThrow(/MURPH_DEV_REUSE_EXISTING_WORKER must not be enabled/u);

    expect(spawnChildProcess).not.toHaveBeenCalled();
  });

  it("rejects an E2E Stripe listener without exact isolated ownership", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: false,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    })).rejects.toThrow(/isolated Stripe listener is explicitly owned/u);

    expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
    expect(spawnChildProcess).not.toHaveBeenCalled();
  });

  it("rejects worktree-scoped startup when asked to reuse an existing worker", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      webPort: 31001,
      workerPersistDir: "../.tmp/hosted-local-worktrees/feature-a/wrangler-state",
      workerPort: 32001,
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_DEV_WORKTREE_SCOPE: "feature-a",
        MURPH_DEV_REUSE_EXISTING_WORKER: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
    })).rejects.toThrow(/MURPH_DEV_REUSE_EXISTING_WORKER must not be enabled/u);

    expect(spawnChildProcess).not.toHaveBeenCalled();
  });

  it("allows E2E isolation when ports, persist dir, and web artifacts are isolated", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: false,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));
    spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
      child: createBufferedChild({ exitCode: null, name: "stripe", pid: 105 }),
      secret: "whsec_isolated_e2e",
    });
    vi.mocked(access).mockResolvedValueOnce(undefined);
    vi.mocked(readFile).mockImplementationOnce(async (filePath) => {
      if (/apps[/\\]web[/\\]\.next-smoke-e2e-fixture[/\\]BUILD_ID$/u.test(String(filePath))) {
        return "smoke-build-id\n";
      }

      const error = new Error("File not found") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        MURPH_HOSTED_LOCAL_E2E_STRIPE_LISTENER: "1",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
      webTemporalMailboxSignalFaultUserId: "member_production_start_target",
    });
    await stack.ready;
    await stack.stop();

    expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledTimes(1);

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      expect.any(String),
      expect.arrayContaining(["31001"]),
      expect.any(Object),
      expect.any(Object),
    );
    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    expect(webCall?.[2]).toEqual([
      "--dir",
      "apps/web",
      "exec",
      "next",
      "start",
      "--hostname",
      "localhost",
      "--port",
      "31001",
    ]);
    expect(webCall?.[3]).not.toHaveProperty("MURPH_HOSTED_WEB_DEV_OWNER_PID");
    expect(webCall?.[3]).toEqual(expect.objectContaining({
      MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID:
        "member_production_start_target",
    }));
    expect(webCall?.[3]).not.toHaveProperty(
      "MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD",
    );
    expect(webCall?.[3].NODE_OPTIONS).toMatch(
      /--require=".*[/\\]apps[/\\]web[/\\]\.test-dist[/\\]hosted-local-preloads[/\\][0-9a-f-]+[/\\]hosted-local-temporal-mailbox-signal-fault-preload\.js"/u,
    );
    const preloadCompileCall = runCommand.mock.calls.find(([, args]) =>
      args.includes("test/support/hosted-local-temporal-mailbox-signal-fault-preload.ts")
    );
    expect(preloadCompileCall).toEqual([
      "pnpm",
      [
        "--dir",
        "apps/web",
        "exec",
        "tsc",
        "test/support/hosted-local-temporal-mailbox-signal-fault-preload.ts",
        "--target",
        "ES2022",
        "--module",
        "CommonJS",
        "--moduleResolution",
        "Node",
        "--skipLibCheck",
        "--noEmitOnError",
        "--outDir",
        expect.stringMatching(
          /^\.test-dist[/\\]hosted-local-preloads[/\\][0-9a-f-]+$/u,
        ),
        "--rootDir",
        "test/support",
      ],
      expect.objectContaining({
        env: expect.not.objectContaining({
          MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID:
            expect.anything(),
        }),
        name: "setup",
      }),
    ]);
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      expect.any(String),
      expect.arrayContaining([
        "--persist-to",
        ".tmp/e2e/wrangler",
      ]),
      expect.objectContaining({
        DOCKER_BUILDKIT: "1",
        DOCKER_CONFIG: "/tmp/murph-dev-env-test/docker-config",
        DOCKER_DEFAULT_PLATFORM: "linux/amd64",
      }),
      expect.any(Object),
    );
    expect(stack.config.workerPersistDir).toBe(".tmp/e2e/wrangler");
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/docker-config/config.json",
      '{"auths":{}}\n',
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    expect(symlink).toHaveBeenCalledWith(
      expect.stringContaining(".docker/cli-plugins"),
      "/tmp/murph-dev-env-test/docker-config/cli-plugins",
      "dir",
    );
    expect(rm).toHaveBeenCalledWith(
      expect.stringContaining("apps/web/.next-smoke-e2e-fixture/dev/cache/fetch-cache"),
      { force: true, recursive: true },
    );
    expect(symlink).not.toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/cloudflare-worker.dev.vars",
      expect.stringContaining("apps/cloudflare/.dev.vars"),
    );
    expect(writeFile).not.toHaveBeenCalledWith(
      "/tmp/murph-dev-crypto-state.dev.vars",
      expect.any(String),
      expect.any(Object),
    );
    expect(cleanupHostedRunnerContainers).toHaveBeenNthCalledWith(1, expect.objectContaining({
      scope: "current-build",
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current-build",
    }));
    expect(maybeStartHostedLocalMinio).toHaveBeenCalledWith(expect.objectContaining({
      containerHost: expect.any(String),
      tempDir: "/tmp/murph-dev-env-test",
    }));
  });

  it("falls back to web dev for an E2E profile without a prebuilt smoke BUILD_ID", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 105 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 106 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
      webTemporalMailboxSignalFaultUserId: "member_source_dev_target",
    });
    await stack.ready;
    await stack.stop();

    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    expect(webCall?.[2]).toEqual([
      "--dir",
      ".",
      "exec",
      "node",
      "--import=tsx",
      "apps/web/scripts/dev-local.ts",
      "--",
      "--hostname",
      "localhost",
      "--port",
      "31001",
    ]);
    expect(webCall?.[3]).toEqual(expect.objectContaining({
      MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_USER_ID:
        "member_source_dev_target",
    }));
    expect(webCall?.[3]).not.toHaveProperty(
      "MURPH_HOSTED_LOCAL_TEMPORAL_MAILBOX_SIGNAL_FAULT_PRELOAD",
    );
    expect(webCall?.[3].NODE_OPTIONS).toMatch(
      /--require=".*[/\\]apps[/\\]web[/\\]\.test-dist[/\\]hosted-local-preloads[/\\][0-9a-f-]+[/\\]hosted-local-temporal-mailbox-signal-fault-preload\.js"/u,
    );
  });

  it("keeps production web start selection on harness env instead of merged app env files", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readOptionalSimpleEnvFile).mockResolvedValue({
      HOSTED_ASSISTANT_PROVIDER: "openai",
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
      OPENAI_API_KEY: "local-openai-key",
    });
    vi.mocked(readFile).mockImplementationOnce(async (filePath) => {
      if (/apps[/\\]web[/\\]\.next-smoke-e2e-fixture[/\\]BUILD_ID$/u.test(String(filePath))) {
        return "smoke-build-id\n";
      }

      const error = new Error("File not found") as Error & { code: string };
      error.code = "ENOENT";
      throw error;
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 107 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 108 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    });
    await stack.ready;
    await stack.stop();

    const resolveInput = vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0];
    expect(resolveInput?.overrides).toMatchObject({
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
    });
    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    expect(webCall?.[2]).toEqual([
      "--dir",
      ".",
      "exec",
      "node",
      "--import=tsx",
      "apps/web/scripts/dev-local.ts",
      "--",
      "--hostname",
      "localhost",
      "--port",
      "31001",
    ]);
  });

  it("isolates worktree runner cleanup and generated crypto state without E2E-only skips", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      webPort: 3101,
      workerPersistDir: "../.tmp/hosted-local-worktrees/feature-a/wrangler-state",
      workerPort: 8801,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_DEV_HOSTED_LOCAL_CRYPTO_STATE_PATH:
          ".tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
        MURPH_DEV_WEB_PORT: "3101",
        MURPH_DEV_WORKER_PORT: "8801",
        MURPH_DEV_WORKTREE_SCOPE: "feature-a",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "worktree-feature-a",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "feature-a",
      },
    });
    await stack.ready;
    await stack.stop();

    const worktreeCryptoStateWrite = vi.mocked(writeFile).mock.calls.find(([filePath]) =>
      String(filePath).startsWith(
        "/repo/.tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars.",
      )
      && String(filePath).endsWith(".tmp")
    );
    if (!worktreeCryptoStateWrite) {
      throw new Error("missing atomic worktree crypto state temp write");
    }
    const [
      worktreeCryptoStateTempPath,
      worktreeCryptoStateText,
      worktreeCryptoStateWriteOptions,
    ] = worktreeCryptoStateWrite;
    expect(worktreeCryptoStateText).toBe('HOSTED_CRYPTO_ENV="local"\n');
    expect(worktreeCryptoStateWriteOptions).toMatchObject({
      encoding: "utf8",
      mode: 0o600,
    });
    expect(rename).toHaveBeenCalledWith(
      worktreeCryptoStateTempPath,
      "/repo/.tmp/hosted-local-worktrees/feature-a/hosted-local-crypto-state.dev.vars",
    );
    expect(symlink).not.toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/cloudflare-worker.dev.vars",
      expect.stringContaining("apps/cloudflare/.dev.vars"),
    );
    expect(cleanupHostedRunnerContainers).toHaveBeenNthCalledWith(1, expect.objectContaining({
      scope: "current-build",
    }));
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current-build",
    }));
  });

  it("falls back to host Docker CLI plugins when inherited Docker config is already isolated", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));
    vi.mocked(access).mockResolvedValueOnce(undefined);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        DOCKER_CONFIG: "/tmp/murph-dev-env-test/docker-config",
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(access).toHaveBeenCalledWith(expect.stringContaining(".docker/cli-plugins"));
    expect(rm).toHaveBeenCalledWith(
      "/tmp/murph-dev-env-test/docker-config/cli-plugins",
      { force: true, recursive: true },
    );
    expect(symlink).toHaveBeenCalledWith(
      expect.stringContaining(".docker/cli-plugins"),
      "/tmp/murph-dev-env-test/docker-config/cli-plugins",
      "dir",
    );
  });

  it("wires hosted-local MinIO endpoints into the Worker env before Cloudflare starts", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const minioChild = createBufferedChild({ exitCode: null, name: "minio", pid: 102 });
    maybeStartHostedLocalMinio.mockResolvedValueOnce({
      containerName: "murph-hosted-local-r2-test",
      env: {
        HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "hosted-local-r2-access-key",
        HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
        HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
        HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "hosted-local-r2-secret-key",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      ensureReady: async () => null,
      process: minioChild,
      processes: () => [minioChild],
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(stack.processes.minio).toBe(minioChild);
    expect(waitForFirstChildExit.mock.calls[0]?.[0]).not.toContain(minioChild);
    expect(vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0].overrides)
      .toEqual(expect.objectContaining({
        HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "hosted-local-r2-access-key",
        HOSTED_R2_PRESIGN_ACCOUNT_ID: "hosted-local-r2-account",
        HOSTED_R2_PRESIGN_ALLOW_LOCAL_ENDPOINT: "1",
        HOSTED_R2_PRESIGN_BUCKET_NAME: "hosted-local-r2-bundles",
        HOSTED_R2_PRESIGN_CONTROL_ENDPOINT: "http://127.0.0.1:39000",
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
        HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "hosted-local-r2-secret-key",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      }));
  });

  it("monitors hosted-local MinIO and tracks restarted sidecar processes for shutdown", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const minioChild = createBufferedChild({
      exitCode: null,
      name: "minio",
      pid: 102,
      stderrText: "original minio stderr",
    });
    const restartedMinioChild = createBufferedChild({
      exitCode: null,
      name: "minio",
      pid: 105,
      stderrText: "restarted minio stderr",
    });
    const minioProcesses = [minioChild];
    const ensureReady = vi.fn(async () => {
      minioProcesses.push(restartedMinioChild);
      return restartedMinioChild;
    });
    maybeStartHostedLocalMinio.mockResolvedValueOnce({
      containerName: "murph-hosted-local-r2-test",
      env: {
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      },
      ensureReady,
      process: minioChild,
      processes: () => minioProcesses,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    });
    await stack.ready;
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    expect(stack.stderrTail()).toContain("original minio stderr");
    expect(stack.stderrTail()).toContain("restarted minio stderr");

    await stack.stop();

    expect(ensureReady).toHaveBeenCalled();
    expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
      minioChild.child,
      { signal: "SIGTERM" },
    );
    expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
      restartedMinioChild.child,
      { signal: "SIGTERM" },
    );
  });

  it("waits for an in-flight MinIO monitor restart before shutdown completes", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const minioChild = createBufferedChild({ exitCode: null, name: "minio", pid: 102 });
    const restartedMinioChild = createBufferedChild({ exitCode: null, name: "minio", pid: 105 });
    const minioProcesses = [minioChild];
    const restart = createDeferred<BufferedNamedChildProcess | null>();
    const ensureReady = vi.fn(async () => await restart.promise);
    maybeStartHostedLocalMinio.mockResolvedValueOnce({
      containerName: "murph-hosted-local-r2-test",
      env: {
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      },
      ensureReady,
      process: minioChild,
      processes: () => minioProcesses,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    });
    await stack.ready;
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(ensureReady).toHaveBeenCalled();

    const stopPromise = stack.stop();
    await Promise.resolve();
    expect(terminateChildProcessAndWait).not.toHaveBeenCalledWith(
      restartedMinioChild.child,
      { signal: "SIGTERM" },
    );

    minioProcesses.push(restartedMinioChild);
    restart.resolve(restartedMinioChild);
    await stopPromise;

    expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
      restartedMinioChild.child,
      { signal: "SIGTERM" },
    );
  });

  it("terminates hosted-local MinIO when startup fails after MinIO is ready", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "disabled",
      skipLinqWebhookRegister: true,
      skipStripeListen: true,
      webPort: 31001,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    const minioChild = createBufferedChild({ exitCode: null, name: "minio", pid: 102 });
    maybeStartHostedLocalMinio.mockResolvedValueOnce({
      containerName: "murph-hosted-local-r2-test",
      env: {
        HOSTED_R2_PRESIGN_ENDPOINT: "http://host.docker.internal:39000",
      },
      ensureReady: async () => null,
      process: minioChild,
      processes: () => [minioChild],
    });
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.resolveCloudflareLocalEnv).mockRejectedValueOnce(
      new Error("cloudflare env failed"),
    );

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
        MURPH_DEV_WEB_PORT: "31001",
        MURPH_DEV_WORKER_PORT: "32001",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
      },
    })).rejects.toThrow("cloudflare env failed");

    expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
      minioChild.child,
      { signal: "SIGTERM" },
    );
    expect(cleanupHostedLocalMinioContainerBestEffort).toHaveBeenCalledWith(
      expect.any(Object),
      "murph-hosted-local-r2-test",
    );
  });

  it("signals all child processes during stop before waiting for the first one to exit", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));
    let releaseFirstTermination = (): void => {
      throw new Error("first termination promise was not created");
    };
    terminateChildProcessAndWait
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirstTermination = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;

    const stopPromise = stack.stop();
    await Promise.resolve();

    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    releaseFirstTermination();
    await stopPromise;
  });

  it("runs stop cleanup once when stop is called repeatedly while termination is pending", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 102 }));
    let releaseFirstTermination = (): void => {
      throw new Error("first termination promise was not created");
    };
    terminateChildProcessAndWait
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        releaseFirstTermination = resolve;
      }))
      .mockResolvedValueOnce(undefined);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;

    const firstStop = stack.stop("SIGTERM");
    const secondStop = stack.stop("SIGKILL");
    await Promise.resolve();

    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    releaseFirstTermination();
    await Promise.all([firstStop, secondStop]);
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
  });

  it("treats Ctrl-C as child termination without scanning host processes", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const cloudflareChild = createBufferedChild({ exitCode: null, name: "cloudflare", pid: 101 });
    const webChild = createBufferedChild({ exitCode: null, name: "web", pid: 102 });
    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(webChild);

    try {
      const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

      const stack = await startHostedLocalDevStack({
        env: process.env,
      });
      await stack.ready;
      spawnSync.mockClear();

      await stack.stop("SIGINT");

      expect(terminateChildProcess).toHaveBeenCalledWith(cloudflareChild.child, "SIGTERM");
      expect(terminateChildProcess).toHaveBeenCalledWith(webChild.child, "SIGTERM");
      expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
        cloudflareChild.child,
        { signal: "SIGTERM" },
      );
      expect(terminateChildProcessAndWait).toHaveBeenCalledWith(
        webChild.child,
        { signal: "SIGTERM" },
      );

      expect(spawnSync.mock.calls.filter(([command]) => command === "pkill")).toEqual([]);
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("stops the retained Linq tunnel child without scanning host processes", async () => {
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      linqWebhookTunnelMode: "auto",
    });
    resolveHostedLocalLinqWebhookSetup.mockResolvedValueOnce({
      phoneNumbers: ["+15550100001"],
      publicBaseUrl: "https://tunnel.example.test",
      shouldRegister: false,
      shouldStartTunnel: true,
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      tunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
      tunnelName: "dev",
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 111 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "linq-tunnel", pid: 112 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 113 }));

    try {
      const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

      const stack = await startHostedLocalDevStack({
        env: process.env,
      });
      await stack.ready;
      await stack.stop();

      expect(spawnSync.mock.calls.filter(([command]) => command === "pkill")).toEqual([]);
      expect(spawnChildProcess).toHaveBeenCalledWith(
        "linq-tunnel",
        "cloudflared",
        expect.any(Array),
        expect.any(Object),
        expect.any(Object),
      );
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("includes the local E2E parser toolchain when preparing a parser-enabled runner bundle", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "runner:bundle:hosted-local"],
      expect.objectContaining({
        env: expect.objectContaining({
          HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN: "1",
          MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY: "1",
          MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN: "1",
        }),
      }),
    );
  });

  it("preserves test NODE_ENV for the local E2E Codex model provider base URL override", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 107 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 108 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:4222/v1",
        NODE_ENV: "test",
      },
    });
    await stack.ready;
    await stack.stop();

    const resolveInput = vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0];
    expect(resolveInput?.overrides).toMatchObject({
      HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL: "http://127.0.0.1:4222/v1",
      NODE_ENV: "test",
    });

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.NODE_ENV).toBe("test");
  });

  it("preserves test NODE_ENV for live E2E test routes without a Codex provider base URL override", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 109 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 110 }));

    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipLinqWebhookRegister: true,
      webPort: 31003,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32003,
    });
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_DEV_CF_PERSIST_DIR: ".tmp/e2e/wrangler",
        MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
        MURPH_DEV_WEB_PORT: "31003",
        MURPH_DEV_WORKER_PORT: "32003",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:live",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: "e2e-fixture",
        NODE_ENV: "test",
      },
    });
    await stack.ready;
    await stack.stop();

    const resolveInput = vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0];
    expect(resolveInput?.overrides).toMatchObject({
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:live",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      NODE_ENV: "test",
    });

    expect(environmentModule.buildWranglerLocalDevConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:live",
        MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
        NODE_ENV: "test",
      }),
      expect.any(Object),
    );
    const workerConfigWrite = vi.mocked(writeFile).mock.calls.find(
      ([filePath]) => filePath === "/tmp/murph-dev-env-test/cloudflare-worker.local-dev.generated.json",
    );
    expect(workerConfigWrite).toBeDefined();
    const generatedConfig = JSON.parse(String(workerConfigWrite?.[1])) as {
      ai?: unknown;
      main: string;
    };
    expect(generatedConfig).not.toHaveProperty("ai");
    expect(generatedConfig.main).toBe("../src/hosted-local-test-index.ts");

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.NODE_ENV).toBe("test");
  });

  it("scrubs pulled hosted crypto material unless remote hosted crypto keys are explicitly enabled", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 103 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 104 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_CRYPTO_ENV: "production",
        HOSTED_CRYPTO_GCP_ACCESS_TOKEN: "remote-token",
        HOSTED_CRYPTO_GCP_KMS_API_ROOT: "https://cloudkms.googleapis.com/v1",
        HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK: "{\"kty\":\"EC\",\"d\":\"remote\"}",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "remote-callback-private",
      },
    });
    await stack.ready;
    await stack.stop();

    const resolveInput = vi.mocked(environmentModule.resolveCloudflareLocalEnv).mock.calls.at(-1)?.[0];
    expect(resolveInput?.overrides).toMatchObject({
      HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "host.docker.internal",
    });
    expect(resolveInput?.overrides?.HOSTED_CRYPTO_ENV).toBeUndefined();
    expect(resolveInput?.overrides?.HOSTED_CRYPTO_GCP_ACCESS_TOKEN).toBeUndefined();
    expect(resolveInput?.overrides?.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBeUndefined();
    expect(resolveInput?.overrides?.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBeUndefined();
    expect(resolveInput?.overrides?.HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK).toBeUndefined();

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.HOSTED_CRYPTO_GCP_ACCESS_TOKEN).toBeUndefined();
    expect(cloudflareEnv.HOSTED_CRYPTO_GCP_KMS_API_ROOT).toBeUndefined();
    expect(cloudflareEnv.HOSTED_CRYPTO_LOCAL_AUTHORITY_SIGN_PRIVATE_JWK).toBeUndefined();
  });

  it("generates Health Commons once and starts the markdown watcher before web dev", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipHealthCommonsWatch: false,
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["health-commons:generate"],
      expect.objectContaining({
        cwd: expect.stringContaining("murph"),
        name: "setup",
      }),
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "health-commons",
      "pnpm",
      ["health-commons:generate:watch"],
      expect.objectContaining({
        MURPH_HEALTH_COMMONS_WATCH_SKIP_INITIAL: "1",
      }),
      expect.any(Object),
    );
    const healthCommonsCallIndex = spawnChildProcess.mock.calls.findIndex(
      ([name]) => name === "health-commons",
    );
    const webCallIndex = spawnChildProcess.mock.calls.findIndex(([name]) => name === "web");
    expect(healthCommonsCallIndex).toBeGreaterThanOrEqual(0);
    expect(webCallIndex).toBeGreaterThan(healthCommonsCallIndex);
    expect(stack.processes.healthCommons?.name).toBe("health-commons");
  });

  it("skips hosted web generated artifacts when the E2E aggregate already prepared them", async () => {
    const stderr = new CapturingWritable();
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HEALTH_COMMONS_GENERATED_PREPARED: "1",
        MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED: "1",
      },
      stderrTarget: stderr,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:generate"],
      expect.any(Object),
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      [
        "--dir",
        "apps/web",
        "exec",
        "prisma",
        "db",
        "push",
        "--accept-data-loss",
      ],
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["health-commons:generate"],
      expect.any(Object),
    );
    expect(rm).toHaveBeenCalledWith(
      expect.stringContaining("apps/web/.next-dev/dev/cache/fetch-cache"),
      { force: true, recursive: true },
    );
    expect(stderr.text()).toContain(
      "Skipping hosted web Prisma client generation; already prepared for this hosted-local E2E run.",
    );
    expect(stderr.text()).toContain(
      "Skipping Health Commons generated artifacts; already prepared for this hosted-local E2E run.",
    );
  });

  it("can skip the runner container smoke proof for focused debugging", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipRunnerSmoke: true,
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 131 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 132 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "deploy:smoke"],
      expect.any(Object),
    );
  });

  it("marks a successful aggregate E2E runner container smoke proof by build id", async () => {
    vi.stubEnv(hostedLocalE2eRunnerSmokeOnceEnv, "1");
    vi.stubEnv(hostedLocalE2eRunnerSmokeProvedBuildIdEnv, "");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipLinqWebhookRegister: true,
      skipWeb: true,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 133 }),
    );

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const expectedBuildId = environmentModule.buildHostedRunnerLocalBuildId(
      "aggregate-smoke-build",
    );
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_ARTIFACT_DIR: ".artifacts/hosted-local/test",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "aggregate-smoke-build",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "deploy:smoke"],
      expect.any(Object),
    );
    expect(process.env[hostedLocalE2eRunnerSmokeProvedBuildIdEnv])
      .toBe(expectedBuildId);
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(expect.objectContaining({
      scope: "current-build",
    }));
    expect(cleanupHostedRunnerImages).not.toHaveBeenCalled();
  });

  it("skips repeated aggregate E2E runner container smoke only for the proved build id", async () => {
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const expectedBuildId = environmentModule.buildHostedRunnerLocalBuildId(
      "aggregate-smoke-build",
    );
    vi.stubEnv(hostedLocalE2eRunnerSmokeOnceEnv, "1");
    vi.stubEnv(hostedLocalE2eRunnerSmokeProvedBuildIdEnv, "");
    vi.mocked(readFile).mockResolvedValueOnce(
      `${JSON.stringify({ buildId: expectedBuildId })}\n`,
    );
    const stderrTarget = new CapturingWritable();
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipLinqWebhookRegister: true,
      skipWeb: true,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 134 }),
    );

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_ARTIFACT_DIR: ".artifacts/hosted-local/test",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: "aggregate-smoke-build",
      },
      stderrTarget,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "deploy:smoke"],
      expect.any(Object),
    );
    expect(readFile).toHaveBeenCalledWith(
      expect.stringContaining("runner-smoke-proved.json"),
      "utf8",
    );
    expect(stderrTarget.text()).toContain(
      "Skipping runner container deploy-smoke; already proved for this hosted-local E2E run.",
    );
    expect(cleanupHostedRunnerImages).not.toHaveBeenCalled();
  });

  it("keeps interactive dev running when the runner container smoke proof fails", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    const stderrTarget = new CapturingWritable();
    const smokeError = new Error("fetch failed");
    runCommand.mockImplementation(async (_command, args) => {
      if (args.join(" ") === "--dir apps/cloudflare deploy:smoke") {
        throw smokeError;
      }
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 133 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 134 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
      },
      stderrTarget,
    });
    await stack.ready;

    expect(terminateChildProcessAndWait).not.toHaveBeenCalled();
    expect(stderrTarget.text()).toContain(
      "Runner container deploy-smoke failed after local web/worker health checks passed; keeping hosted-local dev running.",
    );
    expect(stderrTarget.text()).toContain("deploy-smoke failure: fetch failed");

    await stack.stop();
  });

  it("keeps the runner container smoke proof fatal for E2E profiles", async () => {
    vi.stubEnv("OPENAI_API_KEY", "local-openai-key");
    vi.stubEnv(hostedLocalE2eRunnerSmokeOnceEnv, "1");
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipLinqWebhookRegister: true,
      skipWeb: true,
      workerPersistDir: ".tmp/e2e/wrangler",
      workerPort: 32001,
    });
    runCommand.mockImplementation(async (_command, args) => {
      if (args.join(" ") === "--dir apps/cloudflare deploy:smoke") {
        throw new Error("fetch failed");
      }
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 135 }),
    );

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
      },
    });

    await expect(stack.ready).rejects.toThrow("fetch failed");
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    expect(cleanupHostedRunnerImages).not.toHaveBeenCalled();
  });

  it("starts a managed Linq cloudflared tunnel and registers the local webhook target", async () => {
    const tunnelConfigPath = path.join(process.cwd(), ".tmp", "cloudflared-linq-webhook.yml");
    resolveHostedLocalLinqWebhookSetup.mockResolvedValueOnce({
      phoneNumbers: ["+15550000001"],
      publicBaseUrl: "https://tunnel.example.test",
      shouldRegister: true,
      shouldStartTunnel: true,
      targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      tunnelConfigPath,
      tunnelName: "dev",
    });
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({
        exitCode: null,
        name: "cloudflare",
        pid: 141,
        stdoutText: [
          "#8 exporting manifest sha256:be00319900000000000000000000000000000000000000000000000000000000 done",
          "#8 naming to docker.io/cloudflare-dev/runnercontainer:be003199 done",
        ].join("\n"),
      }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "linq-tunnel", pid: 142 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 143 }));
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("Linq webhook target readiness GET should not run.");
    });
    vi.stubGlobal("fetch", fetchMock);
    registerHostedLocalLinqWebhookSubscription.mockResolvedValueOnce({
      webhookSecret: "linq-provider-secret",
      webhookSecretSource: "created",
    });

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(environmentModule.buildHostedLocalDevOverrides).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      {
        retellWebhookPublicBaseUrl: "https://tunnel.example.test",
      },
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "linq-tunnel",
      "cloudflared",
      [
        "tunnel",
        "--no-autoupdate",
        "--config",
        "packages/hosted-local-harness/.tmp/cloudflared-linq-webhook.yml",
        "run",
        "dev",
      ],
      expect.not.objectContaining({
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-webhook-secret",
      }),
      expect.any(Object),
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        LINQ_WEBHOOK_SECRET: "linq-provider-secret",
      }),
      expect.any(Object),
    );
    expect(registerHostedLocalLinqWebhookSubscription).toHaveBeenCalledWith({
      env: expect.objectContaining({
        LINQ_API_TOKEN: "linq-token",
        LINQ_WEBHOOK_SECRET: "linq-provider-secret",
      }),
      registrationCachePath: ".tmp/linq-webhook-registration.json",
      setup: expect.objectContaining({
        targetUrl: "https://tunnel.example.test/api/hosted-onboarding/linq/webhook",
      }),
      stderrTarget: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const runnerImageInspectCallIndex = spawnSync.mock.calls.findIndex(([command, args]) =>
      command === "docker" &&
      Array.isArray(args) &&
      args[0] === "image" &&
      args[1] === "inspect" &&
      args[2] === "cloudflare-dev/runnercontainer:be003199"
    );
    expect(runnerImageInspectCallIndex).toBeGreaterThanOrEqual(0);
    const webSpawnCallIndex = spawnChildProcess.mock.calls.findIndex(([name]) => name === "web");
    expect(webSpawnCallIndex).toBeGreaterThanOrEqual(0);
    expect(registerHostedLocalLinqWebhookSubscription.mock.invocationCallOrder[0])
      .toBeLessThan(spawnChildProcess.mock.invocationCallOrder[webSpawnCallIndex] ?? 0);
    expect(stack.processes.linqTunnel?.name).toBe("linq-tunnel");
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(3);
  });

  it("uses prisma migrate deploy for non-local databases instead of forcing db push", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 111 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 112 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.shouldSyncLocalDatabaseSchema).mockReturnValueOnce(false);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:migrate:deploy"],
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"],
      expect.any(Object),
    );
  });

  it("passes a stable local runner build id into the generated Wrangler config", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 121 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 122 }));
    vi.stubEnv("MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID", "stack-test-build-id");

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const expectedBuildId = environmentModule.buildHostedRunnerLocalBuildId(
      "stack-test-build-id",
    );
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(environmentModule.buildWranglerLocalDevConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        MURPH_HOSTED_LOCAL_DEPLOY_SMOKE_USE_BUILD_ID: "1",
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: expectedBuildId,
      }),
      expect.any(Object),
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: expectedBuildId,
      }),
      expect.any(Object),
    );
  });

  it("passes hosted provider credentials to the worker but strips host-only Codex env", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 125 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 126 }));
    spawnSync.mockImplementation((command, args) => {
      if (
        command === "codex" &&
        args[0] === "debug" &&
        args[1] === "models" &&
        args[2] === "--bundled"
      ) {
        return {
          error: undefined,
          status: 0,
          stdout: JSON.stringify({
            models: [
              {
                name: "GPT-5.5",
                service_tiers: [
                  {
                    id: "priority",
                    name: "Priority",
                  },
                ],
                slug: "gpt-5.6-terra",
              },
              {
                display_name: "GPT-5.4-Mini",
                priority: 4,
                service_tiers: [],
                slug: "gpt-5.4-mini",
              },
              {
                display_name: "Bundled Nano",
                service_tiers: [{ id: "auto", name: "Auto" }],
                slug: "gpt-5.4-nano",
                supports_parallel_tool_calls: true,
                supports_search_tool: true,
              },
            ],
          }),
        };
      }

      return defaultSpawnSyncImplementation(command, args);
    });

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        CODEX_HOME: "/tmp/local-codex-home",
        HOSTED_ASSISTANT_PROVIDER: "openai",
        MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON: "/tmp/spoofed-catalog.json",
        OPENAI_API_KEY: "local-openai-key",
        VENICE_API_KEY: "local-venice-key",
      },
    });
    await stack.ready;
    await stack.stop();

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    expect(cloudflareCall).toBeDefined();
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.CODEX_HOME).toBeUndefined();
    expect(cloudflareEnv.OPENAI_API_KEY).toBe("local-openai-key");
    expect(cloudflareEnv.VENICE_API_KEY).toBe("local-venice-key");
    expect(cloudflareEnv.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
    expect(cloudflareEnv.MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON).toBe(
      "/tmp/murph-dev-env-test/codex-model-catalog.openai-flex.json",
    );
    expect(cloudflareEnv.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBeUndefined();
    expect(cloudflareEnv.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBeUndefined();
    for (const [, , options] of runCommand.mock.calls) {
      expect(options.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBeUndefined();
      expect(options.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBeUndefined();
    }
    for (const [cleanupInput] of cleanupHostedRunnerContainers.mock.calls) {
      expect(cleanupInput.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBeUndefined();
      expect(cleanupInput.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBeUndefined();
    }
    for (const [cleanupInput] of cleanupHostedRunnerImages.mock.calls) {
      expect(cleanupInput.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_TOKEN).toBeUndefined();
      expect(cleanupInput.env.MURPH_DEV_CODEX_APP_SERVER_PROXY_URL).toBeUndefined();
    }

    const envFileSource = vi.mocked(environmentModule.buildWranglerEnvFileText)
      .mock.calls.at(-1)?.[0] as NodeJS.ProcessEnv;
    expect(envFileSource.CODEX_HOME).toBeUndefined();
    expect(envFileSource.OPENAI_API_KEY).toBe("local-openai-key");
    expect(envFileSource.VENICE_API_KEY).toBe("local-venice-key");
    expect(envFileSource.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
    expect(envFileSource.MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON).toBe(
      "/tmp/murph-dev-env-test/codex-model-catalog.openai-flex.json",
    );
    const catalogWrite = vi.mocked(writeFile).mock.calls.find(([filePath]) =>
      filePath === "/tmp/murph-dev-env-test/codex-model-catalog.openai-flex.json"
    );
    expect(catalogWrite).toBeDefined();
    expect(JSON.parse(String(catalogWrite?.[1]))).toMatchObject({
      models: [
        {
          service_tiers: expect.arrayContaining([
            expect.objectContaining({ id: "flex" }),
          ]),
          slug: "gpt-5.6-terra",
        },
        {
          display_name: "GPT-5.4-Mini",
          slug: "gpt-5.4-mini",
        },
        {
          display_name: "GPT-5.4-Nano",
          service_tiers: [],
          slug: "gpt-5.4-nano",
          supports_parallel_tool_calls: false,
          supports_search_tool: false,
          use_responses_lite: false,
        },
      ],
    });
    expect(spawnSync).toHaveBeenCalledWith(
      "codex",
      ["debug", "models", "--bundled"],
      expect.objectContaining({
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it.each([
    {
      expectedMessage: "Hosted local dev received an invalid Codex model catalog.",
      stdout: "{not-json",
    },
    {
      expectedMessage: "Hosted local dev Codex model catalog is missing gpt-5.6-terra.",
      stdout: JSON.stringify({ models: [] }),
    },
    {
      expectedMessage: "Hosted local dev Codex model catalog is missing gpt-5.4-mini.",
      stdout: JSON.stringify({ models: [{ slug: "gpt-5.6-terra" }] }),
    },
  ])(
    "fails closed when Codex bundled model catalog prep fails: $expectedMessage",
    async ({ expectedMessage, stdout }) => {
      spawnSync.mockImplementation((command, args) => {
        if (
          command === "codex" &&
          args[0] === "debug" &&
          args[1] === "models" &&
          args[2] === "--bundled"
        ) {
          return {
            error: undefined,
            status: 0,
            stdout,
          };
        }

        return defaultSpawnSyncImplementation(command, args);
      });

      const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

      await expect(startHostedLocalDevStack({
        env: {
          ...process.env,
          HOSTED_ASSISTANT_PROVIDER: "openai",
          OPENAI_API_KEY: "local-openai-key",
        },
      })).rejects.toThrow(expectedMessage);
      expect(spawnChildProcess).not.toHaveBeenCalledWith(
        "cloudflare",
        expect.any(String),
        expect.any(Array),
        expect.any(Object),
        expect.any(Object),
      );
    },
  );

  it("defaults the hosted assistant provider to OpenAI when only the key is configured", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 127 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 128 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readOptionalSimpleEnvFile).mockResolvedValue({});
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_ASSISTANT_PROVIDER: undefined,
        OPENAI_API_KEY: "local-openai-key",
      },
    });
    await stack.ready;
    await stack.stop();

    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    expect(cloudflareCall).toBeDefined();
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.HOSTED_ASSISTANT_PROVIDER).toBe("openai");
    expect(cloudflareEnv.OPENAI_API_KEY).toBe("local-openai-key");
  });

  it("seeds dev worker env with ChatGPT subscription Codex auth", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 141 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 142 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        NODE_ENV: "development",
        OPENAI_API_KEY: "local-openai-key",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(resolveHostedLocalCodexSubscriptionAuthEnvValue).toHaveBeenCalledOnce();
    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBe(
      STUB_CODEX_SUBSCRIPTION_AUTH_JSON,
    );
    // The API key stays configured for image generation.
    expect(cloudflareEnv.OPENAI_API_KEY).toBe("local-openai-key");

    const envFileSource = vi.mocked(environmentModule.buildWranglerEnvFileText)
      .mock.calls.at(-1)?.[0] as NodeJS.ProcessEnv;
    expect(envFileSource.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBe(
      STUB_CODEX_SUBSCRIPTION_AUTH_JSON,
    );

    // Token material stays out of the non-worker child processes.
    const webCall = spawnChildProcess.mock.calls.find(([name]) => name === "web");
    const webEnv = webCall?.[3] as NodeJS.ProcessEnv;
    expect(webEnv.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBeUndefined();
  });

  it("does not read the host Codex home for NODE_ENV=test stacks", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 143 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 144 }));

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");
    const stack = await startHostedLocalDevStack({
      // Vitest and the e2e profiles run with NODE_ENV=test.
      env: {
        ...process.env,
        // Inherited shell values are host-only and must never reach the worker.
        HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON: "inherited-shell-value",
        NODE_ENV: "test",
        OPENAI_API_KEY: "local-openai-key",
      },
    });
    await stack.ready;
    await stack.stop();

    expect(resolveHostedLocalCodexSubscriptionAuthEnvValue).not.toHaveBeenCalled();
    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    expect(cloudflareEnv.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBeUndefined();
  });

  it("bypasses the subscription seed and logs a dev banner when MURPH_DEV_USE_OPENAI_API_KEY=1", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 145 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 146 }));
    // The opt-out is intended for `pnpm dev`, so the integration must hold on
    // the same NODE_ENV=development baseline that would otherwise seed.
    const stderrWriteSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");
    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        // Inherited shell values are host-only and must never reach the worker
        // even on the opt-out path.
        HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON: "inherited-shell-value",
        MURPH_DEV_USE_OPENAI_API_KEY: "1",
        NODE_ENV: "development",
        OPENAI_API_KEY: "local-openai-key",
      },
    });
    await stack.ready;
    await stack.stop();

    // The opt-out must short-circuit before the host Codex home is read.
    expect(resolveHostedLocalCodexSubscriptionAuthEnvValue).not.toHaveBeenCalled();
    const cloudflareCall = spawnChildProcess.mock.calls.find(([name]) => name === "cloudflare");
    const cloudflareEnv = cloudflareCall?.[3] as NodeJS.ProcessEnv;
    // No ChatGPT auth env, and no inherited shell leak into the worker.
    expect(cloudflareEnv.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBeUndefined();
    // The API key stays configured so the runner can bill assistant turns.
    expect(cloudflareEnv.OPENAI_API_KEY).toBe("local-openai-key");

    // The dev banner names both the env var and the billing consequence so an
    // operator noticing the line in pnpm dev output understands the override.
    // Phrasing is value-agnostic ("is set:") because the parser accepts "1"
    // and "true"; the value the operator picked is not echoed back.
    const stderrText = stderrWriteSpy.mock.calls
      .map(([chunk]) => (typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString("utf8")))
      .join("");
    expect(stderrText).toContain("MURPH_DEV_USE_OPENAI_API_KEY is set");
    expect(stderrText).toContain("OPENAI_API_KEY");

    stderrWriteSpy.mockRestore();
  });

  it("generates a unique non-default local runner build id for each stack", async () => {
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");
    const env = {
      ...process.env,
      MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID: undefined,
    };

    const firstStack = await startHostedLocalDevStack({ env });
    await firstStack.ready;
    await firstStack.stop();
    const firstCall = vi.mocked(environmentModule.buildWranglerLocalDevConfig)
      .mock.calls.at(-1);
    const firstBuildId = firstCall?.[0].MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID;

    const secondStack = await startHostedLocalDevStack({ env });
    await secondStack.ready;
    await secondStack.stop();
    const secondCall = vi.mocked(environmentModule.buildWranglerLocalDevConfig)
      .mock.calls.at(-1);
    const secondBuildId = secondCall?.[0].MURPH_HOSTED_RUNNER_LOCAL_BUILD_ID;

    expect(firstBuildId).toMatch(/^sha256-[a-f0-9]{24}$/u);
    expect(secondBuildId).toMatch(/^sha256-[a-f0-9]{24}$/u);
    expect(firstBuildId).not.toBe("local");
    expect(secondBuildId).not.toBe("local");
    expect(secondBuildId).not.toBe(firstBuildId);
  });

  it("can force-reset the local Postgres target before db push when explicitly requested", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 113 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 114 }));

    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      forceResetLocalDatabase: true,
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(runCommand).toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--force-reset"],
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "exec", "prisma", "db", "push", "--accept-data-loss"],
      expect.any(Object),
    );
  });

  it("uses the Docker bridge gateway as the worker bridge host on Linux", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 151 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 152 }));
    spawnSync.mockReturnValueOnce({
      error: undefined,
      status: 0,
      stdout: "172.17.0.1\n",
    });
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: undefined,
      },
    });
    await stack.ready;
    await stack.stop();

    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      [
        "network",
        "inspect",
        "bridge",
        "--format",
        "{{range .IPAM.Config}}{{.Gateway}}{{end}}",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: "172.17.0.1",
      }),
      expect.any(Object),
    );
    platformSpy.mockRestore();
  });

  it("retags a split smoke container image when Wrangler omits the live runner tag", async () => {
    const imageBuildOutput = [
      "#8 writing image sha256:e144c487891e1111111111111111111111111111111111111111111111111111 done",
      "#8 naming to docker.io/cloudflare-dev/runnercontainer:4e19cead done",
      "#9 writing image sha256:e144c487891e2222222222222222222222222222222222222222222222222 done",
      "#9 naming to docker.io/cloudflare-dev/deploysmokerunnercontainer:4e19cead done",
    ].join("\n");
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({
        exitCode: null,
        name: "cloudflare",
        pid: 153,
        stderrText: imageBuildOutput,
      }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 154 }));
    spawnSync.mockImplementation((command, args) => {
      if (command === "docker" && args[0] === "image" && args[1] === "inspect") {
        return {
          error: undefined,
          status: args[2] === "cloudflare-dev/runnercontainer:4e19cead" ? 1 : 0,
          stdout: "",
        };
      }
      if (command === "docker" && args[0] === "images") {
        return {
          error: undefined,
          status: 0,
          stdout: "cloudflare-dev/deploysmokerunnercontainer:4e19cead e144c487891e\n",
        };
      }
      if (command === "codex" && args[0] === "debug") {
        return {
          error: undefined,
          status: 0,
          stdout: DEFAULT_CODEX_MODEL_CATALOG_TEXT,
        };
      }
      return {
        error: undefined,
        status: 0,
        stdout: "",
      };
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnSync).toHaveBeenCalledWith(
      "docker",
      [
        "tag",
        "cloudflare-dev/deploysmokerunnercontainer:4e19cead",
        "cloudflare-dev/runnercontainer:4e19cead",
      ],
      { stdio: "pipe" },
    );
  });

  it("fails closed on Linux when the worker bridge host cannot be resolved", async () => {
    spawnSync.mockReturnValueOnce({
      error: undefined,
      status: 1,
      stdout: "",
    });
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: {
        ...process.env,
        HOSTED_EXECUTION_RUNNER_HOST_ALIAS: undefined,
      },
    })).rejects.toThrow(
      "Hosted local dev on Linux could not resolve a container-reachable worker host.",
    );
    expect(spawnChildProcess).not.toHaveBeenCalled();
    platformSpy.mockRestore();
  });

  it("can start only the worker lane for focused hosted runtime debugging", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 401 }),
    );

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledTimes(1);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(1);
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(1);
    expect(stack.webBaseUrl).toBeNull();
  });

  it("reuses an already-running local worker when its health banner matches Murph", async () => {
    resolveHostedLocalWorkerPortMode.mockResolvedValueOnce("reuse-existing");
    const stderrTarget = new CapturingWritable();
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "web", pid: 460 }),
    );

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        MURPH_DEV_REUSE_EXISTING_WORKER: "1",
      },
      pipeOutput: false,
      stderrTarget,
    });
    await stack.ready;
    await stack.stop();

    expect(stack.processes.cloudflare).toBeNull();
    expect(stderrTarget.text()).toContain(
      "Reusing existing local Cloudflare worker at http://127.0.0.1:8787",
    );
    expect(resolveHostedLocalCodexSubscriptionAuthEnvValue).not.toHaveBeenCalled();
    expect(maybeStartHostedLocalMinio).not.toHaveBeenCalled();
    expect(spawnChildProcess).toHaveBeenCalledTimes(1);
    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "runner:bundle"],
      expect.any(Object),
    );
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/cloudflare", "deploy:smoke"],
      expect.any(Object),
    );
    expect(cleanupHostedRunnerContainers).not.toHaveBeenCalled();
    expect(cleanupHostedRunnerImages).not.toHaveBeenCalled();
    expect(vi.mocked(writeFile)).not.toHaveBeenCalled();
    expect(vi.mocked(rename)).not.toHaveBeenCalled();
    expect(vi.mocked(symlink)).not.toHaveBeenCalled();
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(1);
    expect(waitForHealthyHttpEndpoint).toHaveBeenCalledTimes(2);
  });

  it("streams docker-events forensics only for isolated or opted-in stacks", async () => {
    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        MURPH_HOSTED_LOCAL_DOCKER_EVENTS_FORENSICS: "",
        MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "",
        MURPH_HOSTED_LOCAL_PROFILE: "",
      },
    });

    // An ordinary dev stack must not observe the whole Docker daemon.
    expect(spawnHostedLocalDockerEventsForensics).not.toHaveBeenCalled();
    await stack.stop("SIGTERM");
  });

  it("includes docker-events output in startup-failure diagnostics", async () => {
    const cloudflareChild = createBufferedChild({
      exitCode: 1,
      name: "cloudflare",
      pid: 511,
    });
    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 512 }));
    spawnHostedLocalDockerEventsForensics.mockReturnValueOnce(
      createBufferedChild({
        exitCode: null,
        name: "docker-events",
        pid: 513,
        stdoutText: '{"Action":"kill","Actor":{"Attributes":{"signal":"9"}}}',
      }),
    );
    waitForHealthyHttpEndpoint.mockImplementationOnce(() => new Promise(() => {}));
    waitForFirstChildExit.mockResolvedValueOnce(cloudflareChild);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: {
        ...process.env,
        // The opt-in flag streams forensics without requiring full E2E
        // isolation, which keeps this unit test independent of isolation
        // preconditions.
        MURPH_HOSTED_LOCAL_DOCKER_EVENTS_FORENSICS: "1",
      },
    });

    // Startup failures (image untags, cold-start kills) are exactly what the
    // forensics exist to explain, so the rejection itself must carry them.
    await expect(stack.ready).rejects.toThrow(/\[docker-events:stdout\][\s\S]*"signal":"9"/u);
  });

  it("fails fast and cleans up when a dev child exits before readiness", async () => {
    const cloudflareChild = createBufferedChild({
      exitCode: 1,
      name: "cloudflare",
      pid: 501,
    });
    spawnChildProcess
      .mockReturnValueOnce(cloudflareChild)
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 502 }));
    waitForHealthyHttpEndpoint.mockImplementationOnce(() => new Promise(() => {}));
    waitForFirstChildExit.mockResolvedValueOnce(cloudflareChild);

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });

    await expect(stack.ready).rejects.toThrow(
      "cloudflare dev process exited before the hosted local stack became healthy.",
    );
    expect(terminateChildProcessAndWait).toHaveBeenCalledTimes(2);
    expect(cleanupHostedRunnerContainers).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreErrors: true,
        scope: "current-build",
      }),
    );
    expect(cleanupHostedRunnerImages).toHaveBeenCalledWith(
      expect.objectContaining({
        ignoreErrors: true,
        scope: "current-build",
      }),
    );
  });

  it("skips Vercel link and env pull when the caller already provides a Vercel OIDC token", async () => {
    const configModule = await import("../../src/dev-hosted-local/config.ts");
    const vercelModule = await import("../../src/dev-hosted-local/vercel.ts");
    vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
      ...defaultConfig,
      skipPrismaMigrate: true,
      skipWeb: true,
    });
    spawnChildProcess.mockReturnValueOnce(
      createBufferedChild({ exitCode: null, name: "cloudflare", pid: 451 }),
    );
    vi.stubEnv("VERCEL_OIDC_TOKEN", "provided-oidc-token");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(vi.mocked(vercelModule.ensureVercelLinkExists)).not.toHaveBeenCalled();
    const sawVercelSetup = runCommand.mock.calls
      .some(([command]) => command === "vercel");
    expect(sawVercelSetup).toBe(false);
  });

  it("reuses a caller-provided temp dir for generated local worker inputs", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 201 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 202 }));
    vi.stubEnv("MURPH_DEV_TEMP_DIR", ".tmp/local-dev-debug");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--env-file",
        expect.stringContaining(".tmp/local-dev-debug/cloudflare-worker.env"),
      ]),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("rejects temp dir overrides outside the repo-local .tmp subtree", async () => {
    vi.stubEnv("MURPH_DEV_TEMP_DIR", "../unsafe-temp-dir");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow(
      "MURPH_DEV_TEMP_DIR must resolve inside the repo-local .tmp directory.",
    );
  });

  it("rejects temp dir overrides inside hosted-local worktree state", async () => {
    vi.stubEnv("MURPH_DEV_TEMP_DIR", ".tmp/hosted-local-worktrees/feature-a");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow(
      "MURPH_DEV_TEMP_DIR must not resolve inside the hosted-local worktree state directory.",
    );
  });

  it("fails closed when local hosted dev is configured with a non-hosted assistant provider", async () => {
    vi.stubEnv("HOSTED_ASSISTANT_PROVIDER", "vercel-ai-gateway");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow(
      "HOSTED_ASSISTANT_PROVIDER=openai is required for local hosted dev.",
    );
    expect(spawnChildProcess).not.toHaveBeenCalled();
  });

  it("lets explicit shell model env override pulled Vercel env on the hosted provider path", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 301 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 302 }));

    vi.stubEnv("HOSTED_ASSISTANT_PROVIDER", "openai");
    vi.stubEnv("HOSTED_ASSISTANT_MODEL", "gpt-5.6-terra");

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");

    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ASSISTANT_MODEL: "stale-pulled-model",
      HOSTED_ASSISTANT_PROVIDER: "venice",
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ASSISTANT_MODEL: "gpt-5.6-terra",
        HOSTED_ASSISTANT_PROVIDER: "openai",
      }),
      expect.any(Object),
    );
  });

  it("loads local Stripe env without mixing pulled Vercel plan prices", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 351 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 352 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_vercel_edge",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_vercel_family",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_vercel_monthly",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD: "price_vercel_usage_5",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD: "price_vercel_usage_10",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD: "price_vercel_usage_20",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD: "price_vercel_usage_25",
      STRIPE_SECRET_KEY: "sk_test_vercel",
    });
    vi.mocked(environmentModule.readHostedLocalStripeEnvFile).mockResolvedValueOnce({
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_local_monthly",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD: "price_local_usage_10",
      STRIPE_SECRET_KEY: "sk_test_local",
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_local_monthly",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_5_USD: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_10_USD: "price_local_usage_10",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_20_USD: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_USAGE_CREDIT_25_USD: undefined,
        STRIPE_SECRET_KEY: "sk_test_local",
      }),
      expect.any(Object),
    );
  });

  it("isolates pulled Stripe plan prices when apps web local env supplies the Stripe key", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 361 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 362 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readOptionalSimpleEnvFile)
      .mockResolvedValueOnce({
        HOSTED_ASSISTANT_PROVIDER: "openai",
        OPENAI_API_KEY: "local-openai-key",
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        STRIPE_SECRET_KEY: "sk_test_web_local",
      });
    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_vercel_edge",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_vercel_family",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_vercel_monthly",
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: undefined,
        STRIPE_SECRET_KEY: "sk_test_web_local",
      }),
      expect.any(Object),
    );
  });

  it("isolates a pulled Stripe key when local env supplies only plan prices", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 371 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 372 }));

    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readOptionalSimpleEnvFile)
      .mockResolvedValueOnce({
        HOSTED_ASSISTANT_PROVIDER: "openai",
        OPENAI_API_KEY: "local-openai-key",
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_local_edge",
      });
    vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: "price_vercel_family",
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_vercel_monthly",
      STRIPE_SECRET_KEY: "sk_test_vercel",
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "web",
      "pnpm",
      expect.any(Array),
      expect.objectContaining({
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_EDGE_MONTHLY: "price_local_edge",
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_FAMILY_SEAT_MONTHLY: undefined,
        HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: undefined,
        STRIPE_SECRET_KEY: undefined,
      }),
      expect.any(Object),
    );
  });

  it("refuses live Stripe keys in local hosted dev unless explicitly allowed", async () => {
    const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
    vi.mocked(environmentModule.readHostedLocalStripeEnvFile).mockResolvedValueOnce({
      HOSTED_ONBOARDING_STRIPE_PRICE_ID_LAUNCH_MONTHLY: "price_live_like_monthly",
      STRIPE_SECRET_KEY: "sk_live_not_for_local_dev",
    });

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    await expect(startHostedLocalDevStack({
      env: process.env,
    })).rejects.toThrow("refuses to start with a live Stripe secret key");
    expect(runCommand).not.toHaveBeenCalledWith(
      "pnpm",
      ["--dir", "apps/web", "prisma:generate"],
      expect.any(Object),
    );
  });

  it("passes optional Wrangler debug flags through to the Cloudflare dev worker", async () => {
    spawnChildProcess
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "cloudflare", pid: 401 }))
      .mockReturnValueOnce(createBufferedChild({ exitCode: null, name: "web", pid: 402 }));
    vi.stubEnv("MURPH_DEV_CF_WRANGLER_LOG_LEVEL", "debug");

    const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

    const stack = await startHostedLocalDevStack({
      env: process.env,
    });
    await stack.ready;
    await stack.stop();

    expect(spawnChildProcess).toHaveBeenCalledWith(
      "cloudflare",
      "pnpm",
      expect.arrayContaining([
        "--log-level",
        "debug",
        "--show-interactive-dev-session=false",
      ]),
      expect.any(Object),
      expect.any(Object),
    );
  });

  describe("stripe webhook listener", () => {
    async function withListenerConfig(
      overrides: Partial<HostedLocalDevConfig>,
      run: () => Promise<void>,
    ): Promise<void> {
      const configModule = await import("../../src/dev-hosted-local/config.ts");
      vi.mocked(configModule.resolveHostedLocalDevConfig).mockReturnValueOnce({
        ...defaultConfig,
        skipStripeListen: false,
        ...overrides,
      });
      await run();
    }

    it("warns and continues without the listener when the Stripe CLI is missing", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockRejectedValueOnce(
        new StripeCliMissingError(),
      );

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledTimes(1);
        const writes = stderrTarget.text();
        expect(writes).toContain("Stripe CLI not found on PATH");
        expect(writes).toContain("brew install stripe/stripe-cli/stripe");
        expect(writes).toContain("MURPH_DEV_SKIP_STRIPE_LISTEN=1");
        expect(stack.processes.stripe).toBeNull();
      });
    });

    it("captures the listener's whsec and injects it into the web child env", async () => {
      const stderrTarget = new CapturingWritable();
      const listenerChild = createBufferedChild({
        exitCode: null,
        name: "stripe",
        pid: 911,
      });
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: listenerChild,
        secret: "whsec_captured_abc123",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            args: [
              "listen",
              "--forward-to",
              "http://localhost:3000/api/hosted-onboarding/stripe/webhook",
            ],
            command: "stripe",
            timeoutMs: 15_000,
          }),
        );
        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_captured_abc123",
          }),
          expect.any(Object),
        );
        expect(stack.processes.stripe).toBe(listenerChild);
      });
    });

    it("scopes STRIPE_API_KEY to the harness-owned listener child", async () => {
      const stripeCliApiKey = "sk_test_listener_child_only";
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: createBufferedChild({ exitCode: null, name: "stripe", pid: 915 }),
        secret: "whsec_captured_scoped",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: {
            ...process.env,
            STRIPE_API_KEY: stripeCliApiKey,
          },
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).toHaveBeenCalledWith(
          expect.objectContaining({
            env: expect.objectContaining({
              STRIPE_API_KEY: stripeCliApiKey,
            }),
          }),
        );
        expect(stack.runtimeEnv.STRIPE_API_KEY).toBeUndefined();
        expect(stack.workerRuntimeEnv?.STRIPE_API_KEY).toBeUndefined();
        for (const [, , , env] of spawnChildProcess.mock.calls) {
          expect(env.STRIPE_API_KEY).toBeUndefined();
        }
        for (const [, , options] of runCommand.mock.calls) {
          expect(options.env.STRIPE_API_KEY).toBeUndefined();
        }
        for (const [input] of startHostedLocalTemporalRuntime.mock.calls) {
          expect(input.env.STRIPE_API_KEY).toBeUndefined();
        }
      });
    });

    it("preserves a shell-provided STRIPE_WEBHOOK_SECRET over the captured value", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: createBufferedChild({ exitCode: null, name: "stripe", pid: 912 }),
        secret: "whsec_captured_zzz",
      });
      vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_shell_override");

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_shell_override",
          }),
          expect.any(Object),
        );
        expect(stderrTarget.text()).toContain("does not match the listener");
      });
    });

    it("discards a pulled-only STRIPE_WEBHOOK_SECRET in favor of the captured value", async () => {
      const stderrTarget = new CapturingWritable();
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: createBufferedChild({ exitCode: null, name: "stripe", pid: 913 }),
        secret: "whsec_captured_fresh",
      });
      const environmentModule = await import("../../src/dev-hosted-local/environment.ts");
      vi.mocked(environmentModule.readSimpleEnvFile).mockResolvedValueOnce({
        STRIPE_WEBHOOK_SECRET: "whsec_stale_from_vercel",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnChildProcess).toHaveBeenCalledWith(
          "web",
          "pnpm",
          expect.any(Array),
          expect.objectContaining({
            STRIPE_WEBHOOK_SECRET: "whsec_captured_fresh",
          }),
          expect.any(Object),
        );
      });
    });

    it("skips the listener when MURPH_DEV_SKIP_WEB=1 is set", async () => {
      await withListenerConfig({ skipWeb: true }, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
        });
        await stack.ready;
        await stack.stop();

        expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
        expect(stack.processes.stripe).toBeNull();
      });
    });

    it("skips the listener when MURPH_DEV_SKIP_STRIPE_LISTEN=1 is set", async () => {
      // default config already has skipStripeListen: true
      const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

      const stack = await startHostedLocalDevStack({
        env: process.env,
      });
      await stack.ready;
      await stack.stop();

      expect(spawnStripeListenerWithSecretCapture).not.toHaveBeenCalled();
      expect(stack.processes.stripe).toBeNull();
    });

    it("does not participate in waitForFirstChildExit when the listener dies after ready", async () => {
      const stderrTarget = new CapturingWritable();
      const listenerChild = createBufferedChild({
        exitCode: null,
        name: "stripe",
        pid: 914,
      });
      let recordedExitHandler:
        | ((code: number | null, signal: NodeJS.Signals | null) => void)
        | null = null;
      const onceMock = vi.mocked(listenerChild.child.once);
      onceMock.mockImplementation(
        function (this: typeof listenerChild.child, event, handler) {
          if (event === "exit") {
            recordedExitHandler = handler;
          }
          return this;
        },
      );
      spawnStripeListenerWithSecretCapture.mockResolvedValueOnce({
        child: listenerChild,
        secret: "whsec_captured_post_ready",
      });

      await withListenerConfig({}, async () => {
        const { startHostedLocalDevStack } = await import("../../src/dev-hosted-local/stack.ts");

        const stack = await startHostedLocalDevStack({
          env: process.env,
          stderrTarget,
        });
        await stack.ready;

        expect(waitForFirstChildExit).toHaveBeenCalledTimes(1);
        const firstCallArgs = waitForFirstChildExit.mock.calls[0];
        const watchedChildren = firstCallArgs?.[0] ?? [];
        expect(
          watchedChildren.some(
            (entry: BufferedNamedChildProcess) => entry.name === "stripe",
          ),
        ).toBe(false);

        // Simulate post-ready listener exit
        recordedExitHandler?.(1, "SIGTERM");
        const writes = stderrTarget.text();
        expect(writes).toContain("listener exited");
        expect(writes).toContain("Restart `pnpm dev`");

        await stack.stop();
      });
    });
  });
});

function buildFakeJwtPayload(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return [
    encode({ alg: "none", typ: "JWT" }),
    encode(payload),
    "signature",
  ].join(".");
}
