import type { Server as HttpServer } from "node:http";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionWake,
} from "@murphai/hosted-execution/contracts";
import type { HostedRunnerNudgeResult } from "@murphai/hosted-execution/runtime-control";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution";

import {
  DEFAULT_DATABASE_URL,
} from "../../../../scripts/dev-hosted-local/constants.ts";
import { loadHostedLocalBaseEnvironment } from "../../../../scripts/dev-hosted-local/environment.ts";
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
  mergeRequiredEnvProfile,
  reserveLocalTcpPort,
  resolveHostedAssistantLocalDevEnv,
  resolveHostedAssistantProviderMode,
  resolveHostedLocalSmokeWebEnv,
  startAssistantProviderStubServer,
  stopHttpStubServer,
  type HostedLocalAssistantProviderMode,
  type HostedLocalAssistantProviderStubRequest,
  type HostedLocalAssistantProviderStubState,
} from "./hosted-local-e2e-support.js";
import {
  appendHostedWake,
  appendHostedWakeAndWakeWorker,
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-wake.js";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./hosted-local-dev-harness.js";
import {
  bindHostedActiveLinqHomeChat,
  seedHostedActiveLinqMember,
  seedHostedActiveMember,
  type HostedMailboxAppendForTestResponse,
} from "#hosted-web-testing";

interface HostedActiveMemberSeedArgs {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}

interface HostedActiveLinqMemberSeedArgs extends HostedActiveMemberSeedArgs {
  homePhone: string;
  memberPhone: string;
}

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
    wakeResult: HostedRunnerNudgeResult;
  }>;
  enqueueWake(
    wake: HostedExecutionWake,
    userId: string,
  ): Promise<HostedMailboxAppendForTestResponse>;
  harness: HostedLocalDevHarness;
  stop(): Promise<void>;
  waitForHostedCompletion(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedRunnerStatusResponse>;
  waitForLatestPendingWake(userId: string): Promise<HostedRunnerNudgeResult>;
  buildFailureMessage(userId: string, summaryLines: readonly string[]): Promise<string>;
  seedActiveHostedLinqMember(input: HostedActiveLinqMemberSeedArgs): Promise<void>;
  seedActiveHostedMember(input: HostedActiveMemberSeedArgs): Promise<void>;
}

export async function startHostedLocalFullStackScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  assistantProviderMode?: HostedLocalAssistantProviderMode;
  assistantProviderResponses?: readonly string[];
  localDatabaseUrl?: string;
  persistDirOverride?: string | null;
  persistDirPrefix: string;
  requiredRunnerEnvProfile: string;
  scenarioLabel: string;
  seedEnvironment?: NodeJS.ProcessEnv;
  streamLogs?: boolean;
}): Promise<HostedLocalFullStackScenario> {
  const assistantProviderRequests: HostedLocalAssistantProviderStubRequest[] = [];
  const assistantProviderStubState: HostedLocalAssistantProviderStubState = {
    queuedResponseTexts: [...(input.assistantProviderResponses ?? [])],
  };
  const localDatabaseUrl = input.localDatabaseUrl?.trim() || DEFAULT_DATABASE_URL;
  const baseEnvironment = await loadHostedLocalBaseEnvironment();
  const seedEnvironment = input.seedEnvironment ?? baseEnvironment;
  const assistantProviderMode =
    input.assistantProviderMode ?? resolveHostedAssistantProviderMode(baseEnvironment);

  let assistantProviderServer: HttpServer | null = null;
  let assistantProviderBaseUrl: string | null = null;
  let oidcFixture: HostedLocalOidcFixture | null = null;
  let harness: HostedLocalDevHarness | null = null;

  try {
    if (assistantProviderMode === "stub") {
      assistantProviderServer = await startAssistantProviderStubServer({
        fallbackResponseText: null,
        onRequest: (request) => {
          assistantProviderRequests.push(request);
        },
        responseState: assistantProviderStubState,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
    }

    oidcFixture = await startHostedLocalOidcFixture();
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      baseEnvironment,
      assistantProviderMode,
      assistantProviderBaseUrl,
      input.scenarioLabel,
    );
    const webPort = await reserveLocalTcpPort();
    const workerPort = await reserveLocalTcpPort();
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...baseEnvironment,
      ...hostedAssistantDevEnv,
      ...resolveHostedLocalSmokeWebEnv(baseEnvironment),
      MURPH_DEV_SKIP_STRIPE_LISTEN: "1",
      ...(input.additionalEnv ?? {}),
      DATABASE_URL: localDatabaseUrl,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: mergeRequiredEnvProfile(
        baseEnvironment.HOSTED_EXECUTION_RUNNER_ENV_PROFILES,
        input.requiredRunnerEnvProfile,
      ),
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: oidcFixture.jwksUrl,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
      MURPH_DEV_FORCE_RESET_LOCAL_DB: "1",
      MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "debug",
      MURPH_DEV_SKIP_RUNNER_BUNDLE: "1",
      MURPH_DEV_WEB_PORT: String(webPort),
      MURPH_DEV_WORKER_PORT: String(workerPort),
      NEXT_DIST_DIR_MODE: "smoke",
      VERCEL_OIDC_TOKEN: oidcFixture.token,
    };

    harness = await startHostedLocalDevHarness({
      env: runtimeEnv,
      persistDirOverride: input.persistDirOverride,
      persistDirPrefix: input.persistDirPrefix,
      statusHeaders: (userId: string) => ({
        [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
      }),
      statusPath: (userId: string) => `/internal/users/${encodeURIComponent(userId)}/status`,
      streamLogs: input.streamLogs,
    });
    const scenarioHarness = harness;

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
          body: request.body,
          method: request.method,
          url: request.url,
        }));
        return [
          ...summaryLines,
          ...(status ? [`hosted status: ${JSON.stringify(status)}`] : []),
          `assistant provider requests: ${JSON.stringify(assistantProviderRequestLog)}`,
          `stdout tail: ${scenarioHarness.stdoutTail()}`,
          `stderr tail: ${scenarioHarness.stderrTail()}`,
        ].join("\n");
      },
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
        });
      },
      seedActiveHostedMember: async (seedInput) => {
        await seedHostedActiveMember({
          environment: {
            ...seedEnvironment,
            DATABASE_URL: localDatabaseUrl,
            NODE_ENV: "test",
            VITEST: "1",
            ...(seedInput.environment ?? {}),
          },
          memberId: seedInput.memberId,
        });
      },
      stop: async () => {
        await harness?.stop();
        harness = null;
        await oidcFixture?.stop();
        oidcFixture = null;
        await stopHttpStubServer(assistantProviderServer);
        assistantProviderServer = null;
      },
      waitForHostedCompletion: async (userId, waitInput) =>
        await scenarioHarness.waitForHostedCompletion(userId, waitInput),
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
    throw error;
  }
}
