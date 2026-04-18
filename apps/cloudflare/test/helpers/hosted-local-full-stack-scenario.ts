import type { Server as HttpServer } from "node:http";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
  type HostedExecutionUserStatus,
  type HostedExecutionWake,
  type HostedWakeAppendResponse,
} from "@murphai/hosted-execution/contracts";

import {
  DEFAULT_DATABASE_URL,
} from "../../../../scripts/dev-hosted-local/constants.ts";
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
  resolveHostedLocalSmokeWebEnv,
  shouldUseAssistantProviderStub,
  startAssistantProviderStubServer,
  stopHttpStubServer,
} from "./hosted-local-e2e-support.js";
import {
  appendHostedWake,
  appendHostedWakeAndWakeWorker,
  wakeHostedWorkerForLatestPendingWake,
} from "./hosted-local-dispatch.js";
import {
  startHostedLocalDevHarness,
  type HostedLocalDevHarness,
} from "./hosted-local-dev-harness.js";

interface HostedActiveMemberSeedArgs {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}

interface HostedActiveLinqMemberSeedArgs extends HostedActiveMemberSeedArgs {
  homePhone: string;
  memberPhone: string;
}

export interface HostedLocalFullStackScenario {
  assistantProviderBodies: string[];
  dispatchWake(
    wake: HostedExecutionWake,
    userId: string,
  ): Promise<{
    append: HostedWakeAppendResponse;
    wakeStatus: HostedExecutionUserStatus;
  }>;
  enqueueWake(wake: HostedExecutionWake, userId: string): Promise<HostedWakeAppendResponse>;
  harness: HostedLocalDevHarness;
  stop(): Promise<void>;
  waitForHostedCompletion(
    userId: string,
    input?: {
      pollIntervalMs?: number;
      timeoutMs?: number;
    },
  ): Promise<HostedExecutionUserStatus>;
  waitForLatestPendingWake(userId: string): Promise<HostedExecutionUserStatus>;
  buildFailureMessage(userId: string, summaryLines: readonly string[]): Promise<string>;
  seedActiveHostedLinqMember(input: HostedActiveLinqMemberSeedArgs): Promise<void>;
  seedActiveHostedMember(input: HostedActiveMemberSeedArgs): Promise<void>;
}

export async function startHostedLocalFullStackScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  localDatabaseUrl?: string;
  persistDirOverride?: string | null;
  persistDirPrefix: string;
  requiredRunnerEnvProfile: string;
  resolveAssistantReplyText?: (body: string) => string;
  scenarioLabel: string;
  seedEnvironment?: NodeJS.ProcessEnv;
  streamLogs?: boolean;
}): Promise<HostedLocalFullStackScenario> {
  const assistantProviderBodies: string[] = [];
  const localDatabaseUrl = input.localDatabaseUrl?.trim() || DEFAULT_DATABASE_URL;
  const seedEnvironment = input.seedEnvironment ?? process.env;
  const useAssistantProviderStub = shouldUseAssistantProviderStub(process.env);

  let assistantProviderServer: HttpServer | null = null;
  let assistantProviderBaseUrl: string | null = null;
  let oidcFixture: HostedLocalOidcFixture | null = null;
  let harness: HostedLocalDevHarness | null = null;

  try {
    if (useAssistantProviderStub) {
      assistantProviderServer = await startAssistantProviderStubServer({
        onRequestBody: (body) => {
          assistantProviderBodies.push(body);
        },
        resolveMessageText: input.resolveAssistantReplyText,
      });
      assistantProviderBaseUrl =
        `${buildHostLoopbackStubBaseUrl(assistantProviderServer, "assistant provider stub")}/v1`;
    }

    oidcFixture = await startHostedLocalOidcFixture();
    const hostedAssistantDevEnv = resolveHostedAssistantLocalDevEnv(
      process.env,
      assistantProviderBaseUrl,
      input.scenarioLabel,
    );
    const webPort = await reserveLocalTcpPort();
    const workerPort = await reserveLocalTcpPort();
    const runtimeEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...hostedAssistantDevEnv,
      ...resolveHostedLocalSmokeWebEnv(process.env),
      ...(input.additionalEnv ?? {}),
      DATABASE_URL: localDatabaseUrl,
      HOSTED_EXECUTION_RUNNER_ENV_PROFILES: mergeRequiredEnvProfile(
        process.env.HOSTED_EXECUTION_RUNNER_ENV_PROFILES,
        input.requiredRunnerEnvProfile,
      ),
      HOSTED_EXECUTION_VERCEL_OIDC_JWKS_URL: oidcFixture.jwksUrl,
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
      HOSTED_WEB_CALLBACK_SIGNING_PUBLIC_JWK: TEST_HOSTED_WEB_CALLBACK_PUBLIC_JWK_JSON,
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
      assistantProviderBodies,
      buildFailureMessage: async (
        userId: string,
        summaryLines: readonly string[],
      ): Promise<string> => {
        const status = await scenarioHarness.readUserStatus(userId).catch(() => null);
        return [
          ...summaryLines,
          ...(status ? [`hosted status: ${JSON.stringify(status)}`] : []),
          `stdout tail: ${scenarioHarness.stdoutTail()}`,
          `stderr tail: ${scenarioHarness.stderrTail()}`,
        ].join("\n");
      },
      dispatchWake: async (wake, userId) =>
        await appendHostedWakeAndWakeWorker({
          harness: scenarioHarness,
          userId,
          wake,
        }),
      enqueueWake: async (wake, userId) =>
        await appendHostedWake({
          harness: scenarioHarness,
          userId,
          wake,
        }),
      harness: scenarioHarness,
      seedActiveHostedLinqMember: async (seedInput) => {
        const { seedHostedActiveLinqMember } = await import(
          "../../../web/src/lib/hosted-onboarding/hosted-member-test-seed.ts"
        );
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
        const { seedHostedActiveMember } = await import(
          "../../../web/src/lib/hosted-onboarding/hosted-member-test-seed.ts"
        );
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
