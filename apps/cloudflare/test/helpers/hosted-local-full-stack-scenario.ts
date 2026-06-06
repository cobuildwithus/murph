import { execFile } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { promisify } from "node:util";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type { HostedRuntimeEnsureProcessingResponse } from "@murphai/hosted-execution/orchestration-control";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";
import {
  HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV,
} from "@murphai/assistant-runtime/hosted-runtime-contracts";

import {
  DEFAULT_DATABASE_URL,
} from "@murphai/hosted-local-harness/dev-hosted-local/constants";
import { loadHostedLocalBaseEnvironment } from "@murphai/hosted-local-harness/dev-hosted-local/environment";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
} from "../hosted-execution-fixtures.js";
import {
  startHostedLocalOidcFixture,
  type HostedLocalOidcFixture,
} from "./hosted-local-oidc-support.js";
import {
  buildHostLoopbackStubBaseUrl,
  buildHostedLocalDeviceSyncProviderEnvClearances,
  mergeRequiredEnvProfile,
  reserveLocalTemporalTcpPort,
  reserveLocalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  resolveHostedAssistantProviderMode,
  resolveHostedLocalSmokeWebEnv,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  type HostedLocalAssistantProviderMode,
  type HostedLocalAssistantProviderStubRequest,
  type HostedLocalAssistantProviderStubState,
  type HostedLocalAssistantProviderStubUsageMode,
} from "./hosted-local-e2e-support.js";
import {
  appendHostedWake,
  appendHostedWakeAndWakeWorker,
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.js";
import {
  sanitizeHostedFailureText,
  sanitizeHostedStatusForFailureLog,
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./hosted-local-dev-harness.js";
import {
  bindHostedActiveLinqHomeChat,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
  type HostedJunctionDeviceSyncReplaySeedInput,
  type HostedJunctionDeviceSyncReplaySeedResult,
  type HostedMailboxAppendForTestResponse,
} from "#hosted-web-testing";

const execFileAsync = promisify(execFile);
const reuseExplicitDatabaseUrlEnv = "MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL";
const preparedRunnerBundleCacheKeys = new Set<string>();

interface HostedActiveMemberSeedArgs {
  billingPlanCode?: "launch_monthly" | "launch_edge_monthly";
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

interface HostedActiveLinqMemberSeedArgs extends HostedActiveMemberSeedArgs {
  homePhone: string;
  memberPhone: string;
  privyUserId?: string | null;
  walletAddress?: string | null;
}

type HostedJunctionDeviceSyncReplaySeedArgs =
  Omit<HostedJunctionDeviceSyncReplaySeedInput, "environment">;

export interface HostedLocalFullStackScenario {
  assistantProviderRequests: HostedLocalAssistantProviderStubRequest[];
  bindActiveHostedLinqHomeChat(input: {
    chatId: string;
    memberId: string;
    recipientPhone: string;
  }): Promise<void>;
  queueAssistantResponses(responseTexts: readonly string[]): void;
  runWake(
    wake: HostedExecutionWake,
    userId: string,
  ): Promise<{
    append: HostedMailboxAppendForTestResponse;
    wakeResult: HostedRuntimeEnsureProcessingResponse;
  }>;
  enqueueWake(
    wake: HostedExecutionWake,
    userId: string,
  ): Promise<HostedMailboxAppendForTestResponse>;
  harness: HostedLocalDevHarness;
  runtimeEnv: NodeJS.ProcessEnv;
  stop(): Promise<void>;
  waitForHostedCompletion(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  waitForHostedIdle(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  waitForLatestPendingWake(userId: string): Promise<HostedRuntimeEnsureProcessingResponse>;
  buildFailureMessage(userId: string, summaryLines: readonly string[]): Promise<string>;
  seedActiveHostedLinqMember(input: HostedActiveLinqMemberSeedArgs): Promise<void>;
  seedActiveHostedMember(input: HostedActiveMemberSeedArgs): Promise<void>;
  seedJunctionDeviceSyncReplay(
    input: HostedJunctionDeviceSyncReplaySeedArgs,
  ): Promise<HostedJunctionDeviceSyncReplaySeedResult>;
}

export async function startHostedLocalFullStackScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  assistantProviderMode?: HostedLocalAssistantProviderMode;
  assistantProviderMaxResponsesApiRequestBodies?: number;
  assistantProviderRecorder?: boolean;
  assistantProviderResponses?: readonly string[];
  assistantProviderStubModelId?: string;
  assistantProviderStubUsageMode?: HostedLocalAssistantProviderStubUsageMode;
  localDatabaseUrl?: string;
  persistDirOverride?: string | null;
  persistDirPrefix: string;
  resetLocalDatabase?: boolean;
  resetPersistDir?: boolean;
  requiredRunnerEnvProfile: string;
  reuseLocalDatabase?: boolean;
  scenarioLabel: string;
  seedEnvironment?: NodeJS.ProcessEnv;
  streamLogs?: boolean;
}): Promise<HostedLocalFullStackScenario> {
  const assistantProviderRequests: HostedLocalAssistantProviderStubRequest[] = [];
  const providerRequestBodyFingerprintSecret = randomUUID();
  const assistantProviderStubState: HostedLocalAssistantProviderStubState = {
    queuedResponseTexts: [...(input.assistantProviderResponses ?? [])],
  };
  const localDatabase = await resolveHostedLocalScenarioDatabase({
    databaseUrl: input.localDatabaseUrl,
    reuseDatabase: input.reuseLocalDatabase === true,
    scenarioPrefix: input.persistDirPrefix,
  });
  const localDatabaseUrl = localDatabase.url;
  const baseEnvironment = await loadHostedLocalBaseEnvironment();
  const assistantProviderMode =
    input.assistantProviderMode ?? resolveHostedAssistantProviderMode(baseEnvironment);

  let assistantProviderServer: HttpServer | null = null;
  let assistantProviderBaseUrl: string | null = null;
  let oidcFixture: HostedLocalOidcFixture | null = null;
  let harness: HostedLocalDevHarness | null = null;

  try {
    if (assistantProviderMode === "stub" || input.assistantProviderRecorder === true) {
      assistantProviderServer = await startAssistantProviderStubServer({
        fallbackResponseText: input.assistantProviderRecorder === true
          ? "Local recorder fallback response."
          : null,
        maxResponsesApiRequestBodies: input.assistantProviderMaxResponsesApiRequestBodies,
        modelId: input.assistantProviderStubModelId,
        onRequest: (request) => {
          assistantProviderRequests.push(request);
        },
        responseState: assistantProviderStubState,
        usageMode: input.assistantProviderStubUsageMode,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
    }

    oidcFixture = await startHostedLocalOidcFixture();
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      {
        ...baseEnvironment,
        ...(input.additionalEnv ?? {}),
      },
      assistantProviderMode,
      assistantProviderBaseUrl,
      input.scenarioLabel,
    );
    const assistantProviderRecorderEnv =
      assistantProviderMode === "live" && assistantProviderBaseUrl
        ? {
            [HOSTED_RUNTIME_CODEX_MODEL_PROVIDER_BASE_URL_ENV]: assistantProviderBaseUrl,
            NODE_ENV: "test",
          }
        : {};
    const webPort = await reserveLocalTcpPort();
    const workerPort = await reserveLocalTcpPort();
    const temporalPort = await reserveLocalTemporalTcpPort({
      excludedPorts: [webPort, workerPort],
    });
    const runnerBundleCacheKey = buildHostedLocalRunnerBundleCacheKey({
      ...baseEnvironment,
      ...(input.additionalEnv ?? {}),
    });
    const usePreparedRunnerBundle =
      baseEnvironment.MURPH_DEV_SKIP_RUNNER_BUNDLE === "1"
      || preparedRunnerBundleCacheKeys.has(runnerBundleCacheKey);
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...baseEnvironment,
      ...hostedAssistantDevEnv,
      ...buildHostedLocalDeviceSyncProviderEnvClearances(),
      ...resolveHostedLocalSmokeWebEnv(baseEnvironment),
      HOSTED_EXECUTION_IDLE_CHECKPOINT_DELAY_MS: "1000",
      HOSTED_EXECUTION_RUNNER_IDLE_TTL_MS: "300000",
      HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS: "120000",
      MURPH_DEV_LINQ_WEBHOOK_TUNNEL: "0",
      MURPH_DEV_SKIP_LINQ_WEBHOOK_REGISTER: "1",
      MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
      MURPH_DEV_TEMPORAL: "managed",
      MURPH_DEV_TEMPORAL_PORT: String(temporalPort),
      ...(input.additionalEnv ?? {}),
      ...assistantProviderRecorderEnv,
      DATABASE_URL: localDatabaseUrl,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: mergeRequiredEnvProfile(
        baseEnvironment.HOSTED_EXECUTION_RUNNER_ENV_PROFILES,
        input.requiredRunnerEnvProfile,
      ),
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: oidcFixture.jwksUrl,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
      MURPH_DEV_REUSE_EXISTING_WORKER: "0",
      MURPH_HOSTED_LOCAL_E2E_ISOLATION_REQUIRED: "1",
      MURPH_HOSTED_LOCAL_TEST_ROUTES: "1",
      MURPH_HOSTED_LOCAL_PROFILE: assistantProviderMode === "live" ? "e2e:live" : "e2e:stub",
      MURPH_DEV_FORCE_RESET_LOCAL_DB: input.resetLocalDatabase === false ? "0" : "1",
      MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
      ...(usePreparedRunnerBundle ? { MURPH_DEV_SKIP_RUNNER_BUNDLE: "1" } : {}),
      MURPH_DEV_WEB_PORT: String(webPort),
      MURPH_DEV_WORKER_HOST: "0.0.0.0",
      MURPH_DEV_WORKER_PORT: String(workerPort),
      NEXT_DIST_DIR_MODE: "smoke",
      VERCEL_OIDC_TOKEN: oidcFixture.token,
    };

    harness = await startHostedLocalDevHarness({
      env: runtimeEnv,
      persistDirOverride: input.persistDirOverride,
      persistDirPrefix: input.persistDirPrefix,
      resetPersistDir: input.resetPersistDir,
      statusHeaders: (userId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      }),
      statusPath: (userId: string) => `/internal/users/${encodeURIComponent(userId)}/status`,
      streamLogs: input.streamLogs,
    });
    preparedRunnerBundleCacheKeys.add(runnerBundleCacheKey);
    const scenarioHarness = harness;
    const scenarioRuntimeEnv = scenarioHarness.runtimeEnv;
    const seedEnvironment = input.seedEnvironment ?? scenarioRuntimeEnv;

    return {
      assistantProviderRequests,
      bindActiveHostedLinqHomeChat: async (bindingInput) => {
        await bindHostedActiveLinqHomeChat({
          chatId: bindingInput.chatId,
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
          },
          memberId: bindingInput.memberId,
          recipientPhone: bindingInput.recipientPhone,
        });
      },
      buildFailureMessage: async (
        userId: string,
        summaryLines: readonly string[],
      ): Promise<string> => {
        const status = await scenarioHarness.readUserStatus(userId).catch(() => null);
        const assistantProviderRequestLog = assistantProviderRequests.map((request) => ({
          bodyBytes: Buffer.byteLength(request.body, "utf8"),
          bodyFingerprint: fingerprintProviderRequestBody(
            request.body,
            providerRequestBodyFingerprintSecret,
          ),
          method: request.method,
          url: request.url,
        }));
        return [
          ...summaryLines,
          ...(status
            ? [`hosted status: ${JSON.stringify(sanitizeHostedStatusForFailureLog(status))}`]
            : []),
          `assistant provider requests: ${JSON.stringify(assistantProviderRequestLog)}`,
          `stdout tail: ${sanitizeHostedFailureText(scenarioHarness.stdoutTail())}`,
          `stderr tail: ${sanitizeHostedFailureText(scenarioHarness.stderrTail())}`,
        ].join("\n");
      },
      runtimeEnv: scenarioRuntimeEnv,
      queueAssistantResponses: (responseTexts) => {
        for (const responseText of responseTexts) {
          const trimmed = responseText.trim();
          if (!trimmed) {
            throw new Error("Hosted local assistant stub responses must be non-empty.");
          }

          assistantProviderStubState.queuedResponseTexts.push(trimmed);
        }
      },
      runWake: async (wake, userId) =>
        await appendHostedWakeAndWakeWorker({
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
          },
          harness: scenarioHarness,
          userId,
          wake,
        }),
      enqueueWake: async (wake, userId) =>
        await appendHostedWake({
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
          },
          harness: scenarioHarness,
          userId,
          wake,
        }),
      harness: scenarioHarness,
      seedActiveHostedLinqMember: async (seedInput) => {
        await seedHostedActiveLinqMember({
          billingPlanCode: seedInput.billingPlanCode,
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
            ...(seedInput.environment ?? {}),
          },
          homePhone: seedInput.homePhone,
          memberId: seedInput.memberId,
          memberPhone: seedInput.memberPhone,
          privyUserId: seedInput.privyUserId,
          stripeCustomerId: seedInput.stripeCustomerId,
          stripeSubscriptionId: seedInput.stripeSubscriptionId,
          walletAddress: seedInput.walletAddress,
        });
      },
      seedActiveHostedMember: async (seedInput) => {
        await seedHostedActiveMember({
          billingPlanCode: seedInput.billingPlanCode,
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
            ...(seedInput.environment ?? {}),
          },
          memberId: seedInput.memberId,
          stripeCustomerId: seedInput.stripeCustomerId,
          stripeSubscriptionId: seedInput.stripeSubscriptionId,
        });
      },
      seedJunctionDeviceSyncReplay: async (seedInput) =>
        await seedHostedJunctionDeviceSyncReplay({
          connectedAt: seedInput.connectedAt,
          dirtyAt: seedInput.dirtyAt,
          dirtyResources: seedInput.dirtyResources,
          displayName: seedInput.displayName,
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
          },
          externalAccountId: seedInput.externalAccountId,
          memberId: seedInput.memberId,
          sources: seedInput.sources,
        }),
      stop: async () => {
        await harness?.stop();
        harness = null;
        await oidcFixture?.stop();
        oidcFixture = null;
        await stopHttpStubServer(assistantProviderServer);
        assistantProviderServer = null;
        await localDatabase.cleanup();
      },
      waitForHostedCompletion: async (userId, waitInput) =>
        await scenarioHarness.waitForHostedCompletion(userId, waitInput),
      waitForHostedIdle: async (userId, waitInput) =>
        await scenarioHarness.waitForHostedIdle(userId, waitInput),
      waitForLatestPendingWake: async (userId) =>
        await wakeHostedWorkerForLatestPendingWake({
          harness: scenarioHarness,
          userId,
        }),
    };
  } catch (error) {
    await harness?.stop().catch(() => {});
    await oidcFixture?.stop().catch(() => {});
    await stopHttpStubServer(assistantProviderServer).catch(() => {});
    await localDatabase.cleanup().catch(() => {});
    throw error;
  }
}

function fingerprintProviderRequestBody(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

interface HostedLocalScenarioDatabaseLease {
  cleanup(): Promise<void>;
  url: string;
}

async function resolveHostedLocalScenarioDatabase(input: {
  databaseUrl?: string;
  reuseDatabase?: boolean;
  scenarioPrefix: string;
}): Promise<HostedLocalScenarioDatabaseLease> {
  const explicitDatabaseUrl = input.databaseUrl?.trim();
  if (
    explicitDatabaseUrl
    && (input.reuseDatabase === true || shouldReuseExplicitHostedLocalScenarioDatabaseUrl())
  ) {
    return {
      cleanup: async () => {},
      url: explicitDatabaseUrl,
    };
  }

  return await createEphemeralHostedLocalDatabase(input.scenarioPrefix);
}

function shouldReuseExplicitHostedLocalScenarioDatabaseUrl(): boolean {
  return process.env.CI === "true" || process.env[reuseExplicitDatabaseUrlEnv] === "1";
}

function buildHostedLocalRunnerBundleCacheKey(env: NodeJS.ProcessEnv): string {
  return env.HOSTED_LOCAL_E2E_PARSER_TOOLCHAIN === "1"
    ? "parser-toolchain"
    : "default";
}

async function createEphemeralHostedLocalDatabase(
  scenarioPrefix: string,
): Promise<HostedLocalScenarioDatabaseLease> {
  const adminUrl = new URL(DEFAULT_DATABASE_URL);
  const databaseName = buildEphemeralHostedLocalDatabaseName(scenarioPrefix);
  const commandArgs = buildPostgresDatabaseCommandArgs(adminUrl, databaseName);
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);

  await execFileAsync("createdb", commandArgs, { env: commandEnv });

  const targetUrl = new URL(DEFAULT_DATABASE_URL);
  targetUrl.pathname = `/${databaseName}`;

  return {
    cleanup: async () => {
      await execFileAsync("dropdb", ["--if-exists", "--force", ...commandArgs], {
        env: commandEnv,
      });
    },
    url: targetUrl.toString(),
  };
}

function buildEphemeralHostedLocalDatabaseName(scenarioPrefix: string): string {
  const scenarioSlug = scenarioPrefix
    .replace(/^murph-hosted-local-/u, "")
    .replace(/[^a-zA-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .toLowerCase()
    .slice(0, 24);
  const randomSuffix = randomUUID().replace(/-/gu, "").slice(0, 12);
  const databaseName = `murph_e2e_${scenarioSlug || "hosted"}_${randomSuffix}`;

  return databaseName.slice(0, 63);
}

function buildPostgresDatabaseCommandArgs(url: URL, databaseName: string): string[] {
  const args: string[] = [];

  if (url.hostname) {
    args.push("--host", url.hostname);
  }

  if (url.port) {
    args.push("--port", url.port);
  }

  if (url.username) {
    args.push("--username", decodeURIComponent(url.username));
  }

  args.push(databaseName);
  return args;
}

function buildPostgresDatabaseCommandEnv(url: URL): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  if (url.password) {
    env.PGPASSWORD = decodeURIComponent(url.password);
  }

  return env;
}
