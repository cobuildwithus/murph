import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";

const mocks = vi.hoisted(() => ({
  issueHostedAppSessionForTest: vi.fn(async (input: { secureCookieMode: boolean }) => ({
    cookieName: input.secureCookieMode ? "__Host-murph-session" : "murph-session",
    cookieValue: "session-token",
    secureCookieMode: input.secureCookieMode,
    sessionId: "session-id",
  })),
  ensureHostedRuntimeLogDatabaseForTest: vi.fn(async () => {}),
  listHostedRuntimeLogsForTest: vi.fn(async () => [{
    at: "2026-08-07T12:00:00.000Z",
    attemptId: "attempt_test",
    component: "runner",
    eventCode: "runner.lifecycle",
    level: "info",
    phase: "completed",
    redactedJson: null,
  }]),
  startHostedLocalDevHarness: vi.fn(),
  startHostedLocalOidcFixture: vi.fn(async () => ({
    jwksUrl: "http://127.0.0.1:4100/.well-known/jwks.json",
    stop: vi.fn(async () => {}),
    token: "local-oidc-token",
  })),
  stopHttpStubServer: vi.fn(async () => {}),
}));

vi.mock("#hosted-web-testing", () => ({
  bindHostedActiveLinqHomeChat: vi.fn(async () => {}),
  bindHostedActiveTelegramMember: vi.fn(async () => {}),
  ensureHostedRuntimeLogDatabaseForTest: mocks.ensureHostedRuntimeLogDatabaseForTest,
  issueHostedAppSessionForTest: mocks.issueHostedAppSessionForTest,
  listHostedRuntimeLogsForTest: mocks.listHostedRuntimeLogsForTest,
  readHostedJunctionDeviceSyncReplayDrainStatus: vi.fn(async () => ({})),
  seedHostedActiveLinqMember: vi.fn(async () => {}),
  seedHostedActiveMember: vi.fn(async () => {}),
  seedHostedJunctionDeviceSyncConnection: vi.fn(async () => ({})),
  seedHostedJunctionDeviceSyncReplay: vi.fn(async () => ({})),
}));

vi.mock("@murphai/hosted-local-harness/dev-hosted-local/environment", () => ({
  loadHostedLocalBaseEnvironment: vi.fn(async () => ({})),
}));

vi.mock("./hosted-local-e2e-support.js", () => ({
  buildHostLoopbackStubBaseUrl: vi.fn(() => "http://127.0.0.1:4200"),
  buildHostedLocalDeviceSyncProviderEnvClearances: vi.fn(() => ({})),
  mergeRequiredEnvProfile: vi.fn((_current, required) => required),
  reserveLocalTemporalTcpPort: vi.fn(async () => 7233),
  reserveLocalTcpPort: vi.fn(async () => 4300),
  resolveHostedAssistantLocalDevEnv: vi.fn(() => ({})),
  resolveHostedAssistantProviderMode: vi.fn(() => "live"),
  resolveHostedLocalSmokeWebEnv: vi.fn(() => ({})),
  scopeHostedLocalAssistantProviderResponse: vi.fn((response) => response),
  startAssistantProviderStubServer: vi.fn(),
  stopHttpStubServer: mocks.stopHttpStubServer,
}));

vi.mock("./hosted-local-oidc-support.js", () => ({
  startHostedLocalOidcFixture: mocks.startHostedLocalOidcFixture,
}));

vi.mock("./hosted-local-dev-harness.js", () => ({
  sanitizeHostedFailureText: vi.fn((value) => value),
  sanitizeHostedStatusForFailureLog: vi.fn((value) => value),
  startHostedLocalDevHarness: mocks.startHostedLocalDevHarness,
}));

vi.mock("./hosted-local-wake.js", () => ({
  appendHostedWake: vi.fn(),
  appendHostedWakeAndWakeWorker: vi.fn(),
}));

import {
  assertHostedRunNoProviderEgressAuthFailures,
  buildHostedLocalRuntimeLogDatabaseNameForTest,
  buildHostedLocalFullStackWebProcessEnvOverrides,
} from "./hosted-local-full-stack-scenario.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("hosted local full-stack web process environment", () => {
  it("gives the host web process loopback access to the shared Linq stub", () => {
    expect(buildHostedLocalFullStackWebProcessEnvOverrides({
      LINQ_API_BASE_URL: "http://host.docker.internal:4011/api/partner/v3",
    })).toEqual({
      LINQ_API_BASE_URL: "http://127.0.0.1:4011/api/partner/v3",
    });
  });

  it("does not replace a non-stub Linq origin", () => {
    expect(buildHostedLocalFullStackWebProcessEnvOverrides({
      LINQ_API_BASE_URL: "https://api.linqapp.com/api/partner/v3",
    })).toEqual({});
  });

  it("passes the dedicated runtime-log database to the web process", () => {
    expect(buildHostedLocalFullStackWebProcessEnvOverrides({
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://127.0.0.1:5432/murph_e2e_runtime_logs",
    })).toEqual({
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://127.0.0.1:5432/murph_e2e_runtime_logs",
    });
  });
});

it("bounds the derived runtime-log database name to PostgreSQL's identifier limit", () => {
  const runtimeLogDatabaseName = buildHostedLocalRuntimeLogDatabaseNameForTest("p".repeat(63));

  expect(runtimeLogDatabaseName).toBe(`${"p".repeat(50)}_runtime_logs`);
  expect(runtimeLogDatabaseName).toHaveLength(63);
});

it("fails the negative runtime-log oracle when no evidence was persisted", async () => {
  mocks.listHostedRuntimeLogsForTest.mockResolvedValueOnce([]);

  await expect(assertHostedRunNoProviderEgressAuthFailures({
    environment: {
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://127.0.0.1:5432/murph_test_runtime_logs",
    },
    userId: "member_missing_runtime_log_evidence",
  })).rejects.toThrow("completed without runtime-log evidence");
});

it("derives and authoritatively injects a stable runtime-log database for explicit database reuse", async () => {
  const harness = createScenarioHarness();
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario({
    webProcessEnvOverrides: {
      HOSTED_RUNTIME_LOG_DATABASE_URL:
        "postgresql://127.0.0.1:5432/incorrect_runtime_logs",
    },
  });
  try {
    const runtimeLogDatabaseUrl =
      "postgresql://127.0.0.1:5432/murph_test_runtime_logs";
    expect(mocks.ensureHostedRuntimeLogDatabaseForTest).toHaveBeenCalledWith({
      databaseUrl: runtimeLogDatabaseUrl,
    });
    expect(mocks.startHostedLocalDevHarness).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          DATABASE_URL: "postgresql://127.0.0.1:5432/murph_test",
          HOSTED_RUNTIME_LOG_DATABASE_URL: runtimeLogDatabaseUrl,
        }),
        webProcessEnvOverrides: expect.objectContaining({
          HOSTED_RUNTIME_LOG_DATABASE_URL: runtimeLogDatabaseUrl,
        }),
      }),
    );
  } finally {
    await scenario.stop();
  }
});

it.each([false, true])(
  "mints an app-session cookie for the selected Web process mode (%s)",
  async (webUsesProductionArtifact) => {
    const harness = createScenarioHarness({ webUsesProductionArtifact });
    mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

    const scenario = await startScenario();
    try {
      await scenario.issueHostedAppSession({
        memberId: "member_cookie_mode",
        privyUserId: "did:privy:cookie_mode",
      });

      expect(mocks.issueHostedAppSessionForTest).toHaveBeenCalledWith(
        expect.objectContaining({
          memberId: "member_cookie_mode",
          privyUserId: "did:privy:cookie_mode",
          secureCookieMode: webUsesProductionArtifact,
        }),
      );
    } finally {
      await scenario.stop();
    }
  },
);

it("requires progress from the prior completed status before a later completion", async () => {
  const baselineStatus = createCompletedStatus("1", "2026-07-10T12:00:00.000Z");
  const progressedStatus = createCompletedStatus("2", "2026-07-10T12:00:01.000Z");
  const harness = createScenarioHarness({
    completionStatuses: [baselineStatus, progressedStatus],
    progressStatus: progressedStatus,
  });
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario();
  try {
    await expect(scenario.waitForHostedCompletion(baselineStatus.userId))
      .resolves.toBe(baselineStatus);
    expect(harness.waitForHostedProgress).not.toHaveBeenCalled();

    await expect(scenario.waitForHostedCompletion(baselineStatus.userId, {
      pollIntervalMs: 17,
      timeoutMs: 1_000,
    })).resolves.toBe(progressedStatus);
    expect(harness.waitForHostedProgress).toHaveBeenCalledOnce();
    expect(harness.waitForHostedProgress).toHaveBeenCalledWith(
      baselineStatus.userId,
      {
        afterStatus: baselineStatus,
        pollIntervalMs: 17,
        timeoutMs: 1_000,
      },
    );
  } finally {
    await scenario.stop();
  }
});

it("uses the prior completion as the signed-ingress progress baseline", async () => {
  const baselineStatus = createCompletedStatus("1", "2026-07-10T12:00:00.000Z");
  const progressedStatus = createCompletedStatus("2", "2026-07-10T12:00:01.000Z");
  const harness = createScenarioHarness({
    completionStatuses: [baselineStatus, progressedStatus],
    progressStatus: progressedStatus,
  });
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario();
  try {
    await scenario.waitForHostedCompletion(baselineStatus.userId);
    await expect(scenario.waitForLatestPendingWake(baselineStatus.userId))
      .resolves.toBe(progressedStatus);
    expect(harness.waitForHostedProgress).toHaveBeenCalledWith(
      baselineStatus.userId,
      { afterStatus: baselineStatus },
    );

    await scenario.waitForHostedCompletion(baselineStatus.userId);
    expect(harness.waitForHostedProgress).toHaveBeenCalledOnce();
  } finally {
    await scenario.stop();
  }
});

it("fails ordinary scenario cleanup when the harness recorded an intervention", async () => {
  const harness = createScenarioHarness({
    assertNoInterventions: () => {
      throw new Error("recorded mutating intervention");
    },
  });
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario();

  await expect(scenario.stop()).rejects.toThrow("recorded mutating intervention");
  expect(harness.stop).toHaveBeenCalledOnce();
  expect(harness.assertNoInterventions).toHaveBeenCalledOnce();
});

it("allows an explicitly named fault-injection scenario to use interventions", async () => {
  const harness = createScenarioHarness({
    assertNoInterventions: () => {
      throw new Error("recorded mutating intervention");
    },
  });
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario({ faultInjection: true });

  await expect(scenario.stop()).resolves.toBeUndefined();
  expect(harness.stop).toHaveBeenCalledOnce();
  expect(harness.assertNoInterventions).not.toHaveBeenCalled();
});

it("keeps Wrangler inspector traffic out of streamed hosted E2E logs", async () => {
  const harness = createScenarioHarness();
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario();
  try {
    expect(mocks.startHostedLocalDevHarness).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          MURPH_DEV_CF_WRANGLER_LOG_LEVEL: "info",
        }),
      }),
    );
  } finally {
    await scenario.stop();
  }
});

it("forwards explicitly supplied provider credentials to the worker harness", async () => {
  const harness = createScenarioHarness();
  mocks.startHostedLocalDevHarness.mockResolvedValue(harness);

  const scenario = await startScenario({
    additionalEnv: {
      VENICE_API_KEY: "synthetic-local-venice-key",
    },
  });
  try {
    expect(mocks.startHostedLocalDevHarness).toHaveBeenCalledWith(
      expect.objectContaining({
        env: expect.objectContaining({
          VENICE_API_KEY: "synthetic-local-venice-key",
        }),
      }),
    );
  } finally {
    await scenario.stop();
  }
});

function createScenarioHarness(input: {
  assertNoInterventions?: () => void;
  completionStatuses?: HostedRunnerStatusResponse[];
  progressStatus?: HostedRunnerStatusResponse;
  webUsesProductionArtifact?: boolean;
} = {}) {
  const completionStatuses = [...(input.completionStatuses ?? [])];
  const fallbackStatus = input.progressStatus
    ?? createCompletedStatus("1", "2026-07-10T12:00:00.000Z");

  return {
    assertNoInterventions: vi.fn(input.assertNoInterventions ?? (() => {})),
    readUserStatus: vi.fn(async () => fallbackStatus),
    runtimeEnv: {},
    stderrTail: vi.fn(() => ""),
    stdoutTail: vi.fn(() => ""),
    stop: vi.fn(async () => {}),
    waitForHostedCompletion: vi.fn(async () => completionStatuses.shift() ?? fallbackStatus),
    waitForHostedIdle: vi.fn(async () => fallbackStatus),
    waitForHostedProgress: vi.fn(async () => input.progressStatus ?? fallbackStatus),
    webUsesProductionArtifact: input.webUsesProductionArtifact ?? false,
    workerRuntimeEnv: null,
  };
}

async function startScenario(input: {
  additionalEnv?: NodeJS.ProcessEnv;
  faultInjection?: boolean;
  webProcessEnvOverrides?: NodeJS.ProcessEnv;
} = {}) {
  const { startHostedLocalFullStackScenario } = await import(
    "./hosted-local-full-stack-scenario.js"
  );

  return await startHostedLocalFullStackScenario({
    additionalEnv: input.additionalEnv,
    assistantProviderMode: "live",
    faultInjection: input.faultInjection,
    localDatabaseUrl: "postgresql://127.0.0.1:5432/murph_test",
    persistDirPrefix: "murph-hosted-local-oracle-test-",
    requiredRunnerEnvProfile: "default",
    reuseLocalDatabase: true,
    scenarioLabel: "Hosted local passive oracle helper test",
    webProcessEnvOverrides: input.webProcessEnvOverrides,
  });
}

function createCompletedStatus(
  version: string,
  lastInvocationAt: string,
): HostedRunnerStatusResponse {
  const userId = "member_passive_oracle";
  return {
    inFlight: false,
    lastErrorCode: null,
    lastInvocationAt,
    mailboxLag: [{
      importedSeq: version,
      lag: "0",
      lane: "conversation",
      maxSeq: version,
    }],
    recentLogs: [],
    userId,
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: lastInvocationAt,
      createdAt: "2026-07-10T11:59:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: lastInvocationAt,
      userId,
      version,
    },
  };
}
