import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import {
  HOSTED_EXECUTION_USER_ID_HEADER,
} from "@murphai/hosted-execution/contracts";
import type { HostedRunnerStatusResponse } from "@murphai/hosted-execution/runtime-control";

import type { HostedLocalDevConfig } from "@murphai/hosted-local-harness/dev-hosted-local/types";
import {
  TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
} from "../hosted-execution-fixtures.ts";
import { repoRoot } from "../../vitest.shared.js";

const hostedLocalDevConfig: HostedLocalDevConfig = {
  databaseUrlOverride: null,
  forceResetLocalDatabase: false,
  linqWebhookPublicUrl: null,
  linqWebhookRegistrationCachePath: ".tmp/linq-webhook-registration.json",
  linqWebhookTunnelConfigPath: ".tmp/cloudflared-linq-webhook.yml",
  linqWebhookTunnelMode: "disabled",
  linqWebhookTunnelName: "dev",
  skipHealthCommonsWatch: false,
  skipLinqWebhookRegister: false,
  skipPrismaMigrate: true,
  skipRunnerSmoke: false,
  skipStripeListen: true,
  skipWeb: false,
  skipVercelPull: true,
  temporal: {
    host: "127.0.0.1",
    mode: "disabled",
    namespace: "default",
    port: 7233,
    taskQueue: "murph-hosted-runtime",
  },
  useVercelDatabaseUrl: false,
  webHost: "127.0.0.1",
  webPort: 3000,
  workerHost: "127.0.0.1",
  workerPersistDir: ".wrangler/state/dev-root",
  workerPort: 8787,
  workerProtocol: "http",
};

const stopHostedLocalDevStack = vi.fn(async () => {});
const startHostedLocalDevStack = vi.fn(async () => ({
  config: hostedLocalDevConfig,
  oidcIdentity: {
    environment: "development" as const,
    projectName: "murph",
    teamSlug: "local",
  },
  oidcToken: "oidc-token",
  runtimeEnv: {
    HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: TEST_HOSTED_WEB_CALLBACK_PRIVATE_JWK_JSON,
  },
  processes: {
    cloudflare: null,
    healthCommons: null,
    linqTunnel: null,
    minio: null,
    stripe: null,
    temporalServer: null,
    temporalWorker: null,
    web: null,
  },
  linqWebhookTargetUrl: null,
  ready: Promise.resolve(),
  stop: stopHostedLocalDevStack,
  stderrTail: () => "",
  stdoutTail: () => "",
  waitForExit: vi.fn(),
  webBaseUrl: "http://127.0.0.1:3000",
  workerBaseUrl: "http://127.0.0.1:8787",
  workerRuntimeEnv: null,
}));

vi.mock("@murphai/hosted-local-harness/dev-hosted-local/config", () => ({
  resolveHostedLocalDevConfig: vi.fn(() => hostedLocalDevConfig),
}));

vi.mock("@murphai/hosted-local-harness/dev-hosted-local/stack", () => ({
  startHostedLocalDevStack,
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("passes host-only web overrides with the harness process pid", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    webProcessEnvOverrides: {
      LINQ_API_BASE_URL: "http://127.0.0.1:4011",
    },
  });

  await harness.stop();

  expect(harness.webUsesProductionArtifact).toBe(false);
  expect(startHostedLocalDevStack).toHaveBeenCalledWith({
    env: expect.objectContaining({
      MURPH_HOSTED_WEB_DEV_OWNER_PID: String(process.pid),
      NEXT_DIST_DIR_MODE: "smoke",
      NEXT_DIST_DIR_SUFFIX: expect.stringMatching(/^e2e-[a-f0-9-]+$/),
    }),
    pipeOutput: false,
    webProcessEnvOverrides: {
      LINQ_API_BASE_URL: "http://127.0.0.1:4011",
    },
  });
});

it("preserves a prebuilt production web dist across E2E prod stack stops", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const distSuffix = "preserve-prod-dist-test";
  const distDir = path.join(repoRoot, "apps/web", `.next-smoke-${distSuffix}`);

  await rm(distDir, { force: true, recursive: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "BUILD_ID"), "hosted-e2e-build\n", "utf8");

  try {
    const harness = await startHostedLocalDevHarness({
      env: {
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
        MURPH_HOSTED_LOCAL_PROFILE: "e2e:stub",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: distSuffix,
      },
      persistDirPrefix: "murph-hosted-local-test-",
    });

    expect(harness.webUsesProductionArtifact).toBe(true);
    await harness.stop();

    expect(existsSync(path.join(distDir, "BUILD_ID"))).toBe(true);
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});

it("removes disposable hosted web smoke artifacts outside the E2E prod profile", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const distSuffix = "remove-dev-dist-test";
  const distDir = path.join(repoRoot, "apps/web", `.next-smoke-${distSuffix}`);

  await rm(distDir, { force: true, recursive: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, "BUILD_ID"), "dev-smoke-build\n", "utf8");

  try {
    const harness = await startHostedLocalDevHarness({
      env: {
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
        MURPH_HOSTED_LOCAL_PROFILE: "dev",
        NEXT_DIST_DIR_MODE: "smoke",
        NEXT_DIST_DIR_SUFFIX: distSuffix,
      },
      persistDirPrefix: "murph-hosted-local-test-",
    });

    await harness.stop();

    expect(existsSync(distDir)).toBe(false);
  } finally {
    await rm(distDir, { force: true, recursive: true });
  }
});

it("fails fast when hosted completion reaches a terminal runner error", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const status = {
    inFlight: false,
    lastErrorCode: "configuration_error",
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "1",
        lane: "system",
        maxSeq: "1",
      },
    ],
    recentLogs: [{
      at: "2026-05-08T00:00:01.000Z",
      component: "mailbox",
      eventCode: "mailbox.imported",
      level: "info",
      phase: "import",
      redactedJson: {
        webhookDataJson: "{\"objectKey\":\"raw-provider-payload\"}",
      },
    }],
    userId: "member_terminal_error",
    workspace: {
      browserVaultReplicaRef: {
        byteLength: 128,
        dataVersion: "browser-vault-version",
        generatedAt: "2026-05-08T00:00:02.000Z",
        keyId: "browser-vault-key",
        objectKey: "browser-vault/object-key",
        replicaSchema: "murph.browser-vault-replica",
        runtimeRootKeyId: "runtime-root-key",
        schema: "murph.hosted-browser-vault-replica-ref.v1",
        sourceBundleHash: "a".repeat(64),
      },
      checkpointedAt: "2026-05-08T00:00:04.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: {
        hash: "b".repeat(64),
        key: "snapshot/object-key",
        size: 128,
        updatedAt: "2026-05-08T00:00:03.000Z",
      },
      updatedAt: "2026-05-08T00:00:04.000Z",
      userId: "member_terminal_error",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const fetch = vi.fn(async () => Response.json(status));
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    let failureMessage = "";
    await expect(harness.waitForHostedCompletion("member_terminal_error", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).rejects.toThrow(/terminal error[\s\S]*configuration_error/u);
    try {
      await harness.waitForHostedCompletion("member_terminal_error", {
        pollIntervalMs: 1,
        timeoutMs: 5_000,
      });
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : String(error);
    }

    expect(failureMessage).toContain("snapshotRefPresent");
    expect(failureMessage).toContain("browserVaultReplicaRefPresent");
    expect(failureMessage).toContain("recentLogsPresent");
    expect(failureMessage).not.toContain("snapshot/object-key");
    expect(failureMessage).not.toContain("browser-vault/object-key");
    expect(failureMessage).not.toContain("runtime-root-key");
    expect(failureMessage).not.toContain("browser-vault-key");
    expect(failureMessage).not.toContain("webhookDataJson");
    expect(failureMessage).not.toContain("raw-provider-payload");

    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await harness.stop();
  }
});

it("keeps polling hosted completion after a transient status read abort", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const completedStatus = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "0",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
    recentLogs: [],
    userId: "member_transient_status_abort",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:04.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:04.000Z",
      userId: "member_transient_status_abort",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  let statusReads = 0;
  const fetch = vi.fn(async () => {
    statusReads += 1;
    if (statusReads === 1) {
      throw new Error("The operation was aborted due to timeout");
    }
    return Response.json(completedStatus);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_transient_status_abort", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      userId: "member_transient_status_abort",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    await harness.stop();
  }
});

it("waits passively for fresh mailbox lag to clear", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const laggedStatus = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: "1",
        lane: "system",
        maxSeq: "1",
      },
    ],
    recentLogs: [],
    userId: "member_fresh_lag",
    workspace: null,
  } satisfies HostedRunnerStatusResponse;
  const completedStatus = {
    ...laggedStatus,
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "0",
        lane: "system",
        maxSeq: "1",
      },
    ],
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:04.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: {
        hostedMailboxSystemImportedSeq: "1",
      },
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:04.000Z",
      userId: "member_fresh_lag",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const statuses = [laggedStatus, completedStatus];
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    if (String(input).includes("/runtime/ensure-processing")) {
      return Response.json({ accepted: true });
    }
    return Response.json(statuses.shift() ?? completedStatus);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_fresh_lag", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      userId: "member_fresh_lag",
    });

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_fresh_lag/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("observes hosted production-path progress with status reads only", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const baselineStatus = {
    inFlight: false,
    lastErrorCode: null,
    lastInvocationAt: "2026-05-08T00:00:00.000Z",
    mailboxLag: [{
      importedSeq: "1",
      lag: "0",
      lane: "conversation",
      maxSeq: "1",
    }],
    recentLogs: [],
    userId: "member_passive_progress",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:01.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:01.000Z",
      userId: "member_passive_progress",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const progressedStatus = {
    ...baselineStatus,
    lastInvocationAt: "2026-05-08T00:00:02.000Z",
    workspace: {
      ...baselineStatus.workspace,
      checkpointedAt: "2026-05-08T00:00:02.000Z",
      updatedAt: "2026-05-08T00:00:02.000Z",
      version: "2",
    },
  } satisfies HostedRunnerStatusResponse;
  const statuses = [baselineStatus, progressedStatus];
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(statuses.shift() ?? progressedStatus)
  );
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedProgress("member_passive_progress", {
      afterStatus: baselineStatus,
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      lastInvocationAt: "2026-05-08T00:00:02.000Z",
      workspace: { version: "2" },
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([, init]) => init?.method === undefined)).toBe(true);
    expect(harness.interventionCount).toBe(0);
    expect(() => harness.assertNoInterventions()).not.toThrow();
  } finally {
    await harness.stop();
  }
});

it("keeps polling hosted completion while a workspace wake is due", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const dueWakeStatus = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "0",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
    recentLogs: [],
    userId: "member_due_wake_completion",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:02.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: "2026-05-08T00:00:01.000Z",
      nextWakeReason: "assistant",
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:02.000Z",
      userId: "member_due_wake_completion",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const completedStatus = {
    ...dueWakeStatus,
    workspace: {
      ...dueWakeStatus.workspace,
      checkpointedAt: "2026-05-08T00:00:04.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      updatedAt: "2026-05-08T00:00:04.000Z",
      version: "2",
    },
  } satisfies HostedRunnerStatusResponse;
  const statuses = [dueWakeStatus, completedStatus];
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    if (String(request).includes("/runtime/ensure-processing")) {
      return Response.json({ accepted: true });
    }
    return Response.json(statuses.shift() ?? completedStatus);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_due_wake_completion", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      userId: "member_due_wake_completion",
      workspace: {
        nextWakeAt: null,
      },
    });

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_due_wake_completion/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("does not treat recent foreground conversation imports as completion while durable lag remains", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const status = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: "1",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
    recentLogs: [
      {
        at: "2026-05-08T00:00:01.000Z",
        component: "assistant",
        eventCode: "assistant.pass_finished",
        level: "info",
        phase: "invoke",
        redactedJson: {},
      },
      {
        at: "2026-05-08T00:00:00.000Z",
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
        redactedJson: {
          conversationSeqEnd: "1",
        },
      },
    ],
    userId: "member_local_import",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:02.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:02.000Z",
      userId: "member_local_import",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    if (String(request).includes("/__test/users/member_local_import/run-until-idle")) {
      return Response.json({ status: "idle" });
    }

    return Response.json(status);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_local_import", {
      pollIntervalMs: 1,
      timeoutMs: 50,
    })).rejects.toThrow(/Timed out waiting for hosted completion/u);

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_local_import/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
    expect(fetch.mock.calls.some(([request]) =>
      String(request).includes("/__test/users/member_local_import/")
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("waits for durable conversation lag to clear after local import evidence", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const importOnlyStatus = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: "1",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
    recentLogs: [
      {
        at: "2026-05-08T00:00:00.000Z",
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
        redactedJson: {
          conversationSeqEnd: "1",
        },
      },
    ],
    userId: "member_local_import_wait",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:02.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:02.000Z",
      userId: "member_local_import_wait",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const completedStatus = {
    ...importOnlyStatus,
    recentLogs: [
      {
        at: "2026-05-08T00:00:01.000Z",
        component: "assistant",
        eventCode: "assistant.pass_finished",
        level: "info",
        phase: "invoke",
        redactedJson: {},
      },
      ...importOnlyStatus.recentLogs,
    ],
  } satisfies HostedRunnerStatusResponse;
  const durableCompletedStatus = {
    ...completedStatus,
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "0",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
  } satisfies HostedRunnerStatusResponse;
  let statusRequests = 0;
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    if (String(request).includes("/runtime/ensure-processing")) {
      return Response.json({ accepted: true });
    }
    if (String(request).includes("/__test/users/member_local_import_wait/run-until-idle")) {
      return Response.json({ status: "idle" });
    }

    statusRequests += 1;
    return Response.json(
      statusRequests === 1
        ? importOnlyStatus
        : statusRequests === 2
          ? completedStatus
          : durableCompletedStatus,
    );
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_local_import_wait", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      mailboxLag: [{
        importedSeq: "1",
        lag: "0",
        lane: "conversation",
        maxSeq: "1",
      }],
      userId: "member_local_import_wait",
    });

    expect(statusRequests).toBe(3);
    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_local_import_wait/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
    expect(fetch.mock.calls.some(([request]) =>
      String(request).includes("/__test/users/member_local_import_wait/")
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("waits passively for stale in-flight hosted completion to clear", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const staleInFlightStatus = {
    heartbeatAt: null,
    inFlight: true,
    lastErrorCode: null,
    lastInvocationAt: new Date(Date.now() - 120_000).toISOString(),
    mailboxLag: [
      {
        importedSeq: "1",
        lag: "0",
        lane: "conversation",
        maxSeq: "1",
      },
    ],
    recentLogs: [],
    userId: "member_stale_in_flight_completion",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:04.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:04.000Z",
      userId: "member_stale_in_flight_completion",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const completedStatus = {
    ...staleInFlightStatus,
    inFlight: false,
  } satisfies HostedRunnerStatusResponse;
  let statusRequests = 0;
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(request);
    if (url.includes("/runtime/ensure-processing")) {
      return Response.json({ accepted: true });
    }
    if (url.includes("/container-activity-expired")) {
      return Response.json({ ok: true });
    }
    if (url.includes("/run-until-idle")) {
      return Response.json({ status: "idle" });
    }

    statusRequests += 1;
    return Response.json(statusRequests === 1 ? staleInFlightStatus : completedStatus);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_stale_in_flight_completion", {
      pollIntervalMs: 1,
      timeoutMs: 5_000,
    })).resolves.toMatchObject({
      inFlight: false,
      userId: "member_stale_in_flight_completion",
    });

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_stale_in_flight_completion/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
    expect(fetch.mock.calls.some(([request]) =>
      String(request).includes("/__test/users/member_stale_in_flight_completion/")
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("does not treat processed foreground system imports as completion while durable lag remains", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const status = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: "1",
        lane: "system",
        maxSeq: "1",
      },
    ],
    recentLogs: [
      {
        at: "2026-05-08T00:00:01.000Z",
        component: "mailbox",
        eventCode: "mailbox.system_processed",
        level: "info",
        phase: "checkpoint",
        redactedJson: {
          status: "processed",
        },
      },
      {
        at: "2026-05-08T00:00:00.000Z",
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
        redactedJson: {
          systemSeqEnd: "1",
        },
      },
    ],
    userId: "member_local_system_import",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: "2026-05-08T00:00:02.000Z",
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:02.000Z",
      userId: "member_local_system_import",
      version: "1",
    },
  } satisfies HostedRunnerStatusResponse;
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    if (String(request).includes("/__test/users/member_local_system_import/run-until-idle")) {
      return Response.json({ status: "idle" });
    }

    return Response.json(status);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_local_system_import", {
      pollIntervalMs: 1,
      timeoutMs: 50,
    })).rejects.toThrow(/Timed out waiting for hosted completion/u);

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_local_system_import/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
    expect(fetch.mock.calls.some(([request]) =>
      String(request).includes("/__test/users/member_local_system_import/")
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("does not treat foreground system imports as completion without a durable checkpoint", async () => {
  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const status = {
    inFlight: false,
    lastErrorCode: null,
    mailboxLag: [
      {
        importedSeq: "0",
        lag: "1",
        lane: "system",
        maxSeq: "1",
      },
    ],
    recentLogs: [
      {
        at: "2026-05-08T00:00:00.000Z",
        component: "mailbox",
        eventCode: "mailbox.imported",
        level: "info",
        phase: "import",
        redactedJson: {
          systemSeqEnd: "1",
        },
      },
    ],
    userId: "member_local_import_checkpoint",
    workspace: {
      browserVaultReplicaRef: null,
      checkpointedAt: null,
      createdAt: "2026-05-08T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: null,
      updatedAt: "2026-05-08T00:00:00.000Z",
      userId: "member_local_import_checkpoint",
      version: "0",
    },
  } satisfies HostedRunnerStatusResponse;
  const fetch = vi.fn(async (request: RequestInfo | URL, _init?: RequestInit) => {
    if (String(request).includes("/__test/users/member_local_import_checkpoint/run-until-idle")) {
      return Response.json({ status: "idle" });
    }

    return Response.json(status);
  });
  vi.stubGlobal("fetch", fetch);

  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusPath: (userId) => `/status/${userId}`,
  });

  try {
    await expect(harness.waitForHostedCompletion("member_local_import_checkpoint", {
      pollIntervalMs: 1,
      timeoutMs: 50,
    })).rejects.toThrow(/Timed out waiting for hosted completion/u);

    expect(fetch.mock.calls.some(([request, init]) =>
      String(request) === "http://127.0.0.1:8787/internal/users/member_local_import_checkpoint/runtime/ensure-processing"
      && init?.method === "POST"
    )).toBe(false);
    expect(fetch.mock.calls.some(([request]) =>
      String(request).includes("/__test/users/member_local_import_checkpoint/")
    )).toBe(false);
  } finally {
    await harness.stop();
  }
});

it("calls the hosted-local alarm test route with the bound user headers", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    statusHeaders: (userId) => ({
      [HOSTED_EXECUTION_USER_ID_HEADER]: userId,
    }),
    testControls: true,
  });

  try {
    await expect(harness.runHostedAlarmForTest("member_alarm")).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = fetch.mock.calls[0]!;
    expect(String(request)).toBe("http://127.0.0.1:8787/__test/users/member_alarm/alarm");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer oidc-token");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_alarm");
    expect(init).toMatchObject({
      method: "POST",
    });
    expect(harness.interventionCount).toBe(1);
    expect(() => harness.assertNoInterventions()).toThrow(/1 mutating intervention request/u);
  } finally {
    await harness.stop();
  }
});

it("calls the hosted-local activity-expiry route with bound user headers and a timeout", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    testControls: true,
  });

  try {
    await expect(harness.expireRunnerActivityForTest("member_expire")).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = fetch.mock.calls[0]!;
    expect(String(request)).toBe("http://127.0.0.1:8787/__test/users/member_expire/container-activity-expired");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer oidc-token");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_expire");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init).toMatchObject({
      method: "POST",
    });
  } finally {
    await harness.stop();
  }
});

it("calls the hosted-local active-operation and completion-result loss route with bound user headers and a timeout", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    testControls: true,
  });

  try {
    await expect(harness.dropRunnerActiveOperationForTest("member_drop", {
      loseCompletedInvocationResult: true,
    })).resolves.toEqual({ ok: true });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = fetch.mock.calls[0]!;
    expect(String(request)).toBe("http://127.0.0.1:8787/__test/users/member_drop/container-active-operation-drop?loseCompletedInvocationResult=1");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer oidc-token");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_drop");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init).toMatchObject({
      method: "POST",
    });
  } finally {
    await harness.stop();
  }
});

it("controls the hosted-local shutdown checkpoint publication barrier", async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const action = new URL(String(input)).searchParams.get("action");
    return Response.json(
      action === "status"
        ? { state: "entered" }
        : action === "release"
          ? { ok: true, released: true }
          : { ok: true },
    );
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    testControls: true,
  });

  try {
    await expect(harness.armShutdownCheckpointPublicationBarrierForTest("member_barrier"))
      .resolves.toEqual({ ok: true });
    await expect(harness.readShutdownCheckpointPublicationBarrierForTest("member_barrier"))
      .resolves.toEqual({ state: "entered" });
    await expect(harness.beginShutdownCheckpointGracefulStopForTest("member_barrier"))
      .resolves.toEqual({ ok: true });
    await expect(harness.releaseShutdownCheckpointPublicationBarrierForTest("member_barrier"))
      .resolves.toEqual({ ok: true, released: true });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([request]) => String(request))).toEqual([
      "http://127.0.0.1:8787/__test/users/member_barrier"
        + "/shutdown-checkpoint-publication-barrier?action=arm",
      "http://127.0.0.1:8787/__test/users/member_barrier"
        + "/shutdown-checkpoint-publication-barrier?action=status",
      "http://127.0.0.1:8787/__test/users/member_barrier"
        + "/shutdown-checkpoint-publication-barrier?action=shutdown",
      "http://127.0.0.1:8787/__test/users/member_barrier"
        + "/shutdown-checkpoint-publication-barrier?action=release",
    ]);
    for (const [, init] of fetch.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer oidc-token");
      expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_barrier");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init).toMatchObject({ method: "POST" });
    }
  } finally {
    await harness.stop();
  }
});

it("calls the hosted-local run-until-idle route without an idle checkpoint reason", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Response.json({ status: "idle" });
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    testControls: true,
  });

  try {
    await expect(harness.runHostedManualInvocationForTest("member_manual_invocation"))
      .resolves.toEqual({ status: "idle" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = fetch.mock.calls[0]!;
    expect(String(request)).toBe(
      "http://127.0.0.1:8787/__test/users/member_manual_invocation/run-until-idle",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer oidc-token");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_manual_invocation");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init).toMatchObject({
      method: "POST",
    });
  } finally {
    await harness.stop();
  }
});

it("calls the hosted-local run-until-idle route without an alarm reason", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return Response.json({ nextWakeAt: null, status: "idle" });
  });
  vi.stubGlobal("fetch", fetch);

  const { startHostedLocalDevHarness } = await import("./hosted-local-dev-harness.js");
  const harness = await startHostedLocalDevHarness({
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/murph_test",
      NEXT_DIST_DIR_MODE: "smoke",
    },
    persistDirPrefix: "murph-hosted-local-test-",
    testControls: true,
  });

  try {
    await expect(harness.runHostedAlarmInvocationForTest("member_alarm_invocation"))
      .resolves.toEqual({ nextWakeAt: null, status: "idle" });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [request, init] = fetch.mock.calls[0]!;
    expect(String(request)).toBe(
      "http://127.0.0.1:8787/__test/users/member_alarm_invocation/run-until-idle",
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer oidc-token");
    expect(headers.get(HOSTED_EXECUTION_USER_ID_HEADER)).toBe("member_alarm_invocation");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init).toMatchObject({
      method: "POST",
    });
  } finally {
    await harness.stop();
  }
});
