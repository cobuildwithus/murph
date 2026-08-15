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
import { shouldUseHostedWebProductionStart } from "@murphai/hosted-local-harness/dev-hosted-local/web-production-start";
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
  scopeHostedLocalAssistantProviderResponse,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  type HostedLocalAssistantProviderMode,
  type HostedLocalAssistantProviderResponseScopeOptions,
  type HostedLocalAssistantProviderScriptedResponse,
  type HostedLocalAssistantProviderStubRequest,
  type HostedLocalAssistantProviderStubState,
  type HostedLocalAssistantProviderStubUsageMode,
} from "./hosted-local-e2e-support.js";
import {
  appendHostedWake,
  appendHostedWakeAndWakeWorker,
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
  ensureHostedRuntimeLogDatabaseForTest,
  issueHostedAppSessionForTest,
  listHostedRuntimeLogsForTest,
  readHostedDeviceSyncConnectionForTest,
  readHostedLinqWorkspaceIsolationStateForTest,
  readHostedThreadRouteForTest,
  readHostedJunctionDeviceSyncReplayDrainStatus,
  seedHostedJunctionDeviceSyncConnection,
  seedHostedJunctionDeviceSyncReplay,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
  type HostedAppSessionForTest,
  type HostedDeviceSyncConnectionForTest,
  type HostedJunctionDeviceSyncConnectionSeedInput,
  type HostedJunctionDeviceSyncConnectionSeedResult,
  type HostedJunctionDeviceSyncReplayDrainStatus,
  type HostedJunctionDeviceSyncReplaySeedInput,
  type HostedJunctionDeviceSyncReplaySeedResult,
  type HostedMailboxAppendForTestResponse,
  type HostedLinqWorkspaceIsolationStateForTest,
  type HostedRuntimeLogForTestRow,
  type HostedThreadRouteForTest,
} from "#hosted-web-testing";

const execFileAsync = promisify(execFile);
const reuseExplicitDatabaseUrlEnv = "MURPH_HOSTED_LOCAL_E2E_REUSE_DATABASE_URL";
const maxHostedLocalFullStackStartupAttempts = 3;
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
  recentInboundAt?: Date | string | null;
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
    participantPhone?: string;
    recentInboundAt?: Date | string | null;
    recipientPhone: string;
  }): Promise<void>;
  bindActiveHostedTelegramMember(input: {
    memberId: string;
    telegramThreadId?: string | null;
    telegramUserId: string;
  }): Promise<void>;
  queueAssistantResponses(
    responses: readonly HostedLocalAssistantProviderScriptedResponse[],
    scope?: HostedLocalAssistantProviderResponseScopeOptions,
  ): void;
  readHostedLinqWorkspaceIsolationState(input: {
    chatId: string;
    memberId: string;
  }): Promise<HostedLinqWorkspaceIsolationStateForTest>;
  readHostedThreadRoute(input: {
    channel: "linq" | "telegram";
    threadId: string;
  }): Promise<HostedThreadRouteForTest | null>;
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
  /** Passively observes new hosted work; it never triggers runtime processing. */
  waitForLatestPendingWake(userId: string): Promise<HostedRunnerStatusResponse>;
  buildFailureMessage(userId: string, summaryLines: readonly string[]): Promise<string>;
  /**
   * Mints a real hosted app session cookie for a seeded member using the same
   * HMAC key the hosted web process runs with.
   */
  issueHostedAppSession(input: {
    memberId: string;
    privyUserId: string;
  }): Promise<HostedAppSessionForTest>;
  readHostedDeviceSyncConnection(input: {
    memberId: string;
    provider?: string;
  }): Promise<HostedDeviceSyncConnectionForTest>;
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

interface HostedLocalFullStackScenarioInput {
  additionalEnv?: NodeJS.ProcessEnv;
  assistantProviderMode?: HostedLocalAssistantProviderMode;
  assistantProviderMaxResponsesApiRequestBodies?: number;
  assistantProviderRecorder?: boolean;
  assistantProviderResponses?: readonly HostedLocalAssistantProviderScriptedResponse[];
  assistantProviderStubModelId?: string;
  assistantProviderStubUsageMode?: HostedLocalAssistantProviderStubUsageMode;
  enableWorkersAiBinding?: boolean;
  /**
   * Allows explicit mutating test controls without weakening their existing
   * route gate.
   */
  faultInjection?: boolean;
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
  webProcessEnvOverrides?: NodeJS.ProcessEnv;
  webTemporalMailboxSignalFaultUserId?: string;
}

export async function startHostedLocalFullStackScenario(
  input: HostedLocalFullStackScenarioInput,
): Promise<HostedLocalFullStackScenario> {
  for (let attempt = 1; attempt <= maxHostedLocalFullStackStartupAttempts; attempt += 1) {
    try {
      return await startHostedLocalFullStackScenarioAttempt(input);
    } catch (error) {
      if (
        attempt === maxHostedLocalFullStackStartupAttempts
        || !isHostedLocalPortBindCollision(error)
      ) {
        throw error;
      }
    }
  }

  throw new Error("Hosted local full-stack startup exhausted its bounded attempts.");
}

async function startHostedLocalFullStackScenarioAttempt(
  input: HostedLocalFullStackScenarioInput,
): Promise<HostedLocalFullStackScenario> {
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
  const runtimeLogDatabaseUrl = localDatabase.runtimeLogUrl;
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
      HOSTED_EXECUTION_RUNNER_COMMIT_TIMEOUT_MS: "125000",
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
      HOSTED_RUNTIME_LOG_DATABASE_URL: runtimeLogDatabaseUrl,
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
      // CI streams child-process output. Wrangler debug includes every
      // inspector-protocol message, which can backpressure request-heavy E2E
      // scenarios; info retains the structured runtime diagnostics.
      MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "info",
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
      webProcessEnvOverrides: {
        ...buildHostedLocalFullStackWebProcessEnvOverrides(runtimeEnv),
        ...(input.webProcessEnvOverrides ?? {}),
        HOSTED_RUNTIME_LOG_DATABASE_URL: runtimeLogDatabaseUrl,
      },
      webTemporalMailboxSignalFaultUserId:
        input.webTemporalMailboxSignalFaultUserId,
    });
    preparedRunnerBundleCacheKeys.add(runnerBundleCacheKey);
    const scenarioHarness = harness;
    const scenarioRuntimeEnv = scenarioHarness.runtimeEnv;
    const lastCompletedStatusByUser = new Map<string, HostedRunnerStatusResponse>();
    const observedProgressUsers = new Set<string>();
    const seedEnvironment = input.seedEnvironment ?? scenarioRuntimeEnv;
    const buildScenarioSeedEnvironment = (
      overrides: NodeJS.ProcessEnv = {},
    ): NodeJS.ProcessEnv => ({
      ...seedEnvironment,
      DATABASE_URL: localDatabaseUrl,
      HOSTED_RUNTIME_LOG_DATABASE_URL: runtimeLogDatabaseUrl,
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
          participantPhone: bindingInput.participantPhone,
          recentInboundAt: bindingInput.recentInboundAt,
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
      queueAssistantResponses: (responses, scope) => {
        for (const response of responses) {
          assistantProviderStubState.queuedResponses.push(
            scopeHostedLocalAssistantProviderResponse(response, scope),
          );
        }
      },
      readHostedLinqWorkspaceIsolationState: async (stateInput) =>
        await readHostedLinqWorkspaceIsolationStateForTest({
          chatId: stateInput.chatId,
          environment: buildScenarioSeedEnvironment(),
          memberId: stateInput.memberId,
        }),
      readHostedThreadRoute: async (routeInput) =>
        await readHostedThreadRouteForTest({
          ...routeInput,
          environment: buildScenarioSeedEnvironment(),
        }),
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
      issueHostedAppSession: async (sessionInput) =>
        await issueHostedAppSessionForTest({
          environment: buildScenarioSeedEnvironment({
            HOSTED_APP_SESSION_HMAC_KEY: scenarioHarness.hostedAppSessionHmacKey,
            NODE_ENV: await shouldUseHostedWebProductionStart({
              env: scenarioRuntimeEnv,
            }) ? "production" : "test",
          }),
          memberId: sessionInput.memberId,
          privyUserId: sessionInput.privyUserId,
          secureCookieMode: scenarioHarness.webUsesProductionArtifact,
        }),
      readHostedDeviceSyncConnection: async (connectionInput) =>
        await readHostedDeviceSyncConnectionForTest({
          environment: buildScenarioSeedEnvironment(),
          memberId: connectionInput.memberId,
          provider: connectionInput.provider,
        }),
      seedActiveHostedLinqMember: async (seedInput) => {
        await seedHostedActiveLinqMember({
          billingPlanCode: seedInput.billingPlanCode,
          environment: buildScenarioSeedEnvironment(seedInput.environment),
          homePhone: seedInput.homePhone,
          memberId: seedInput.memberId,
          memberPhone: seedInput.memberPhone,
          privyUserId: seedInput.privyUserId,
          recentInboundAt: seedInput.recentInboundAt === undefined
            ? new Date().toISOString()
            : seedInput.recentInboundAt,
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
        if (input.faultInjection !== true) {
          try {
            scenarioHarness.assertNoInterventions();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length === 1) {
          throw failures[0];
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, "Hosted local scenario cleanup failed.");
        }
      },
      waitForHostedCompletion: async (userId, waitInput) => {
        const progressWasAlreadyObserved = observedProgressUsers.delete(userId);
        const previousCompletion = lastCompletedStatusByUser.get(userId);
        if (!progressWasAlreadyObserved && previousCompletion !== undefined) {
          await scenarioHarness.waitForHostedProgress(userId, {
            afterStatus: previousCompletion,
            pollIntervalMs: waitInput?.pollIntervalMs,
            timeoutMs: waitInput?.timeoutMs,
          });
        }
        const status = await scenarioHarness.waitForHostedCompletion(userId, waitInput);
        lastCompletedStatusByUser.set(userId, status);
        await assertHostedRunNoProviderEgressAuthFailures({
          assistantProviderRequests,
          environment: scenarioRuntimeEnv,
          expectAssistantProviderRequest: false,
          userId,
        });
        return status;
      },
      waitForHostedIdle: async (userId, waitInput) => {
        const status = await scenarioHarness.waitForHostedIdle(userId, waitInput);
        lastCompletedStatusByUser.set(userId, status);
        observedProgressUsers.delete(userId);
        return status;
      },
      waitForLatestPendingWake: async (userId) => {
        const status = await scenarioHarness.waitForHostedProgress(userId, {
          afterStatus: lastCompletedStatusByUser.get(userId),
        });
        observedProgressUsers.add(userId);
        return status;
      },
    };
  } catch (error) {
    await harness?.stop().catch(() => {});
    await oidcFixture?.stop().catch(() => {});
    await stopHttpStubServer(assistantProviderServer).catch(() => {});
    await localDatabase.cleanup().catch(() => {});
    throw error;
  }
}

function isHostedLocalPortBindCollision(error: unknown): boolean {
  if (error instanceof AggregateError) {
    return error.errors.some(isHostedLocalPortBindCollision);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return ("code" in error && error.code === "EADDRINUSE")
    || /\baddress already in use\b/ui.test(error.message)
    || /\bport \d+ is already in use\b/ui.test(error.message);
}

export function buildHostedLocalFullStackWebProcessEnvOverrides(
  source: Readonly<NodeJS.ProcessEnv>,
): NodeJS.ProcessEnv {
  const overrides: NodeJS.ProcessEnv = {};
  const runtimeLogDatabaseUrl = source.HOSTED_RUNTIME_LOG_DATABASE_URL?.trim();
  if (runtimeLogDatabaseUrl) {
    overrides.HOSTED_RUNTIME_LOG_DATABASE_URL = runtimeLogDatabaseUrl;
  }

  const configuredLinqBaseUrl = source.LINQ_API_BASE_URL?.trim();
  if (!configuredLinqBaseUrl) {
    return overrides;
  }

  let linqBaseUrl: URL;
  try {
    linqBaseUrl = new URL(configuredLinqBaseUrl);
  } catch {
    return overrides;
  }

  // The Linq E2E stub listens on one host port. Runner containers reach that
  // port through Docker's host alias, while the host web process must use
  // loopback on Linux. Keep the runner URL authoritative everywhere else.
  if (linqBaseUrl.protocol !== "http:" || linqBaseUrl.hostname !== "host.docker.internal") {
    return overrides;
  }

  linqBaseUrl.hostname = "127.0.0.1";
  return {
    ...overrides,
    LINQ_API_BASE_URL: linqBaseUrl.toString().replace(/\/$/u, ""),
  };
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
  if (logs.length === 0) {
    throw new Error(`Hosted run for ${input.userId} completed without runtime-log evidence.`);
  }
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
  runtimeLogUrl: string;
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
    const runtimeLogUrl = buildHostedLocalRuntimeLogDatabaseUrl(explicitDatabaseUrl);
    await ensureHostedRuntimeLogDatabaseForTest({ databaseUrl: runtimeLogUrl });
    return {
      cleanup: async () => {},
      runtimeLogUrl,
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
  const runtimeLogDatabaseName = buildHostedLocalRuntimeLogDatabaseNameForTest(databaseName);
  const commandArgs = buildPostgresDatabaseCommandArgs(adminUrl, databaseName);
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);
  const createdDatabaseNames: string[] = [];

  try {
    await execFileAsync("createdb", commandArgs, { env: commandEnv });
    createdDatabaseNames.push(databaseName);
    createdDatabaseNames.push(runtimeLogDatabaseName);
  } catch (error) {
    await dropHostedLocalDatabases(adminUrl, createdDatabaseNames).catch(() => {});
    throw error;
  }

  const targetUrl = new URL(DEFAULT_DATABASE_URL);
  targetUrl.pathname = `/${databaseName}`;
  const runtimeLogTargetUrl = new URL(DEFAULT_DATABASE_URL);
  runtimeLogTargetUrl.pathname = `/${runtimeLogDatabaseName}`;

  try {
    await ensureHostedRuntimeLogDatabaseForTest({
      databaseUrl: runtimeLogTargetUrl.toString(),
    });
  } catch (error) {
    try {
      await dropHostedLocalDatabases(adminUrl, createdDatabaseNames);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Hosted local runtime-log database setup and cleanup failed.",
      );
    }
    throw error;
  }

  return {
    cleanup: async () => await dropHostedLocalDatabases(adminUrl, createdDatabaseNames),
    runtimeLogUrl: runtimeLogTargetUrl.toString(),
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

export function buildHostedLocalRuntimeLogDatabaseNameForTest(
  primaryDatabaseName: string,
): string {
  const suffix = "_runtime_logs";
  return `${primaryDatabaseName.slice(0, 63 - suffix.length)}${suffix}`;
}

function buildHostedLocalRuntimeLogDatabaseUrl(primaryDatabaseUrl: string): string {
  const primaryUrl = new URL(primaryDatabaseUrl);
  const primaryDatabaseName = decodeURIComponent(primaryUrl.pathname.replace(/^\/+/, ""));
  if (!primaryDatabaseName) {
    throw new Error("Hosted local reusable DATABASE_URL must name a database.");
  }

  const runtimeLogDatabaseName = buildHostedLocalRuntimeLogDatabaseNameForTest(primaryDatabaseName);
  const runtimeLogUrl = new URL(primaryUrl);
  runtimeLogUrl.pathname = `/${runtimeLogDatabaseName}`;
  return runtimeLogUrl.toString();
}

async function dropHostedLocalDatabases(
  adminUrl: URL,
  databaseNames: readonly string[],
): Promise<void> {
  const commandEnv = buildPostgresDatabaseCommandEnv(adminUrl);
  const results = await Promise.allSettled(databaseNames.map(async (databaseName) =>
    await execFileAsync("dropdb", [
      "--if-exists",
      "--force",
      ...buildPostgresDatabaseCommandArgs(adminUrl, databaseName),
    ], { env: commandEnv })
  ));
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : []
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, "Hosted local database cleanup failed.");
  }
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
