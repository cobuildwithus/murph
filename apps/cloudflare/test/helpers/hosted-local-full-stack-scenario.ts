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
  type HostedLocalAssistantProviderScriptedResponse,
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
  bindHostedActiveTelegramMember,
  listHostedRuntimeLogsForTest,
  readHostedJunctionDeviceSyncReplayDrainStatus,
  seedHostedJunctionDeviceSyncConnection,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
  type HostedJunctionDeviceSyncConnectionSeedInput,
  type HostedJunctionDeviceSyncConnectionSeedResult,
  type HostedJunctionDeviceSyncReplayDrainStatus,
  type HostedJunctionDeviceSyncReplaySeedInput,
  type HostedJunctionDeviceSyncReplaySeedResult,
  type HostedMailboxAppendForTestResponse,
  type HostedRuntimeLogForTestRow,
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

type HostedJunctionDeviceSyncConnectionSeedArgs =
  Omit<HostedJunctionDeviceSyncConnectionSeedInput, "environment">;

export interface HostedLocalFullStackScenario {
  assistantProviderRequests: HostedLocalAssistantProviderStubRequest[];
  assertHealthyHostedRun(
    userId: string,
    input?: {
      expectAssistantProviderRequest?: boolean;
    },
  ): Promise<void>;
  bindActiveHostedLinqHomeChat(input: {
    chatId: string;
    memberId: string;
    recipientPhone: string;
  }): Promise<void>;
  bindActiveHostedTelegramMember(input: {
    memberId: string;
    telegramThreadId?: string | null;
    telegramUserId: string;
  }): Promise<void>;
  queueAssistantResponses(
    responses: readonly HostedLocalAssistantProviderScriptedResponse[],
  ): void;
  runWake(
    wake: HostedExecutionWake,
    userId: string,
    input?: {
      timeoutMs?: number;
    },
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
  readJunctionDeviceSyncReplayDrainStatus(input: {
    connectionId: string;
    memberId: string;
  }): Promise<HostedJunctionDeviceSyncReplayDrainStatus>;
  seedJunctionDeviceSyncConnection(
    input: HostedJunctionDeviceSyncConnectionSeedArgs,
  ): Promise<HostedJunctionDeviceSyncConnectionSeedResult>;
  seedJunctionDeviceSyncReplay(
    input: HostedJunctionDeviceSyncReplaySeedArgs,
  ): Promise<HostedJunctionDeviceSyncReplaySeedResult>;
}

export async function startHostedLocalFullStackScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  assistantProviderMode?: HostedLocalAssistantProviderMode;
  assistantProviderMaxResponsesApiRequestBodies?: number;
  assistantProviderRecorder?: boolean;
  assistantProviderResponses?: readonly HostedLocalAssistantProviderScriptedResponse[];
  assistantProviderStubModelId?: string;
  assistantProviderStubUsageMode?: HostedLocalAssistantProviderStubUsageMode;
  enableWorkersAiBinding?: boolean;
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
  testControls?: boolean;
}): Promise<HostedLocalFullStackScenario> {
  const assistantProviderRequests: HostedLocalAssistantProviderStubRequest[] = [];
  const providerRequestBodyFingerprintSecret = randomUUID();
  const assistantProviderStubState: HostedLocalAssistantProviderStubState = {
    queuedResponses: [...(input.assistantProviderResponses ?? [])],
  };
  const localDatabase = await resolveHostedLocalScenarioDatabase({
    databaseUrl: input.localDatabaseUrl,
    reuseDatabase: input.reuseLocalDatabase === true,
    scenarioPrefix: input.persistDirPrefix,
  });
  const localDatabaseUrl = localDatabase.url;
  const testControls = resolveHostedLocalScenarioTestControls(input);
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
      // Automated hosted E2E fakes external vendors, not Murph internals. Keep
      // Workers AI off by default so the production Worker graph starts without
      // a remote dev binding; transcription/fault scenarios can opt in.
      MURPH_DEV_SKIP_WORKERS_AI: input.enableWorkersAiBinding === true ? "0" : "1",
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
      MURPH_HOSTED_LOCAL_TEST_ROUTES: testControls ? "1" : "0",
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
      testControls,
    });
    preparedRunnerBundleCacheKeys.add(runnerBundleCacheKey);
    const scenarioHarness = harness;
    const scenarioRuntimeEnv = scenarioHarness.runtimeEnv;
    const seedEnvironment = input.seedEnvironment ?? scenarioRuntimeEnv;
    const buildScenarioSeedEnvironment = (
      overrides: NodeJS.ProcessEnv = {},
    ): NodeJS.ProcessEnv => ({
      ...seedEnvironment,
      DATABASE_URL: localDatabaseUrl,
      NODE_ENV: "test",
      VITEST: "1",
      ...overrides,
    });

    return {
      assistantProviderRequests,
      bindActiveHostedLinqHomeChat: async (bindingInput) => {
        await bindHostedActiveLinqHomeChat({
          chatId: bindingInput.chatId,
          environment: buildScenarioSeedEnvironment(),
          memberId: bindingInput.memberId,
          recipientPhone: bindingInput.recipientPhone,
        });
      },
      bindActiveHostedTelegramMember: async (bindingInput) => {
        await bindHostedActiveTelegramMember({
          environment: buildScenarioSeedEnvironment(),
          memberId: bindingInput.memberId,
          telegramThreadId: bindingInput.telegramThreadId,
          telegramUserId: bindingInput.telegramUserId,
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
        const recentLogs = status ? summarizeHostedRecentLogsForFailure(status) : [];
        return [
          ...summaryLines,
          ...(status
            ? [`hosted status: ${JSON.stringify(sanitizeHostedStatusForFailureLog(status))}`]
            : []),
          ...(recentLogs.length > 0
            ? [`hosted recent logs: ${JSON.stringify(recentLogs)}`]
            : []),
          `assistant provider requests: ${JSON.stringify(assistantProviderRequestLog)}`,
          `stdout tail: ${sanitizeHostedFailureText(scenarioHarness.stdoutTail())}`,
          `stderr tail: ${sanitizeHostedFailureText(scenarioHarness.stderrTail())}`,
        ].join("\n");
      },
      assertHealthyHostedRun: async (userId, assertInput = {}) =>
        await assertHostedRunNoProviderEgressAuthFailures({
          assistantProviderRequests,
          environment: scenarioRuntimeEnv,
          expectAssistantProviderRequest:
            assertInput.expectAssistantProviderRequest === true,
          userId,
        }),
      runtimeEnv: scenarioRuntimeEnv,
      queueAssistantResponses: (responses) => {
        for (const response of responses) {
          if (typeof response !== "string") {
            assistantProviderStubState.queuedResponses.push(response);
            continue;
          }

          const trimmed = response.trim();
          if (!trimmed) {
            throw new Error("Hosted local assistant stub responses must be non-empty.");
          }

          assistantProviderStubState.queuedResponses.push(trimmed);
        }
      },
      runWake: async (wake, userId, runInput) =>
        await appendHostedWakeAndWakeWorker({
          environment: buildScenarioSeedEnvironment(),
          harness: scenarioHarness,
          timeoutMs: runInput?.timeoutMs,
          userId,
          wake,
        }),
      enqueueWake: async (wake, userId) =>
        await appendHostedWake({
          environment: buildScenarioSeedEnvironment(),
          harness: scenarioHarness,
          userId,
          wake,
        }),
      harness: scenarioHarness,
      seedActiveHostedLinqMember: async (seedInput) => {
        await seedHostedActiveLinqMember({
          billingPlanCode: seedInput.billingPlanCode,
          environment: buildScenarioSeedEnvironment(seedInput.environment),
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
          environment: buildScenarioSeedEnvironment(seedInput.environment),
          memberId: seedInput.memberId,
          stripeCustomerId: seedInput.stripeCustomerId,
          stripeSubscriptionId: seedInput.stripeSubscriptionId,
        });
      },
      readJunctionDeviceSyncReplayDrainStatus: async (drainInput) =>
        await readHostedJunctionDeviceSyncReplayDrainStatus({
          connectionId: drainInput.connectionId,
          environment: buildScenarioSeedEnvironment(),
          memberId: drainInput.memberId,
        }),
      seedJunctionDeviceSyncConnection: async (seedInput) =>
        await seedHostedJunctionDeviceSyncConnection({
          connectedAt: seedInput.connectedAt,
          displayName: seedInput.displayName,
          environment: buildScenarioSeedEnvironment(),
          externalAccountId: seedInput.externalAccountId,
          memberId: seedInput.memberId,
          sources: seedInput.sources,
        }),
      seedJunctionDeviceSyncReplay: async (seedInput) =>
        await seedHostedJunctionDeviceSyncReplay({
          connectedAt: seedInput.connectedAt,
          dirtyAt: seedInput.dirtyAt,
          dirtyResources: seedInput.dirtyResources,
          displayName: seedInput.displayName,
          environment: buildScenarioSeedEnvironment(),
          externalAccountId: seedInput.externalAccountId,
          memberId: seedInput.memberId,
          sources: seedInput.sources,
        }),
      stop: async () => {
        const cleanupResults = await Promise.allSettled([
          harness?.stop() ?? Promise.resolve(),
          oidcFixture?.stop() ?? Promise.resolve(),
          stopHttpStubServer(assistantProviderServer),
          localDatabase.cleanup(),
        ]);
        harness = null;
        oidcFixture = null;
        assistantProviderServer = null;

        const failures = cleanupResults.flatMap((result) =>
          result.status === "rejected" ? [result.reason] : []
        );
        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, "Hosted local scenario cleanup failed.");
        }
      },
      waitForHostedCompletion: async (userId, waitInput) => {
        const status = await scenarioHarness.waitForHostedCompletion(userId, waitInput);
        await assertHostedRunNoProviderEgressAuthFailures({
          assistantProviderRequests,
          environment: scenarioRuntimeEnv,
          expectAssistantProviderRequest: false,
          userId,
        });
        return status;
      },
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

function resolveHostedLocalScenarioTestControls(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  testControls?: boolean;
}): boolean {
  if (input.testControls !== undefined) {
    return input.testControls;
  }
  return input.additionalEnv?.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS === "1"
    || process.env.MURPH_HOSTED_LOCAL_E2E_TEST_CONTROLS === "1";
}

export async function assertHostedRunNoProviderEgressAuthFailures(input: {
  assistantProviderRequests?: readonly HostedLocalAssistantProviderStubRequest[];
  environment: NodeJS.ProcessEnv;
  expectAssistantProviderRequest?: boolean;
  userId: string;
}): Promise<void> {
  if (
    input.expectAssistantProviderRequest === true
    && (input.assistantProviderRequests?.length ?? 0) === 0
  ) {
    throw new Error(`Hosted run for ${input.userId} completed without any assistant provider request.`);
  }

  const logs = await listHostedRuntimeLogsForTest({
    environment: input.environment,
    limit: 1_500,
    userId: input.userId,
  });
  const failures = logs.filter(isHostedRuntimeEgressAuthFailureLog);
  if (failures.length === 0) {
    return;
  }

  throw new Error([
    `Hosted run for ${input.userId} recorded provider-egress/auth failures.`,
    `failures: ${JSON.stringify(failures.map(summarizeHostedRuntimeAuthFailureLog))}`,
  ].join("\n"));
}

function isHostedRuntimeEgressAuthFailureLog(log: HostedRuntimeLogForTestRow): boolean {
  const serialized = JSON.stringify(log.redactedJson ?? {});
  if (log.eventCode === "ASSISTANT_CODEX_FAILED") {
    return serialized.includes("401 Unauthorized");
  }
  if (log.eventCode !== "runner.provider_egress_diagnostic") {
    return serialized.includes("missing_identity");
  }
  const details = log.redactedJson ?? {};
  const providerKind = readHostedRuntimeLogString(details, "providerKind");
  if (providerKind !== "openai") {
    return false;
  }
  return readHostedRuntimeLogString(details, "writeFenceValidationMode") === "missing_identity"
    || details.responseStatus === 401
    || serialized.includes("401 Unauthorized");
}

function summarizeHostedRuntimeAuthFailureLog(log: HostedRuntimeLogForTestRow): Record<string, unknown> {
  return {
    at: log.at,
    component: log.component,
    eventCode: log.eventCode,
    phase: log.phase,
    providerKind: log.redactedJson?.providerKind ?? null,
    responseStatus: log.redactedJson?.responseStatus ?? null,
    writeFenceValidationMode: log.redactedJson?.writeFenceValidationMode ?? null,
    writeFenceValidationRejectReason: log.redactedJson?.writeFenceValidationRejectReason ?? null,
  };
}

function readHostedRuntimeLogString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function fingerprintProviderRequestBody(value: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

function summarizeHostedRecentLogsForFailure(
  status: HostedRunnerStatusResponse,
): Array<Record<string, string>> {
  return (status.recentLogs ?? []).slice(-12).map((entry) => {
    const summary: Record<string, string> = {
      at: entry.at,
      component: entry.component,
      eventCode: entry.eventCode,
      level: entry.level,
      phase: entry.phase,
    };

    if (entry.errorCode) {
      summary.errorCode = entry.errorCode;
    }

    return summary;
  });
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
