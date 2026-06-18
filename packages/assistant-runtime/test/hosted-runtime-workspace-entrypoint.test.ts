import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
  initializeVault,
  runCanonicalWrite,
} from "@murphai/core";
import {
  readAssistantInputEvent,
  upsertAssistantInputEvent,
} from "@murphai/assistant-engine/assistant-automation";
import {
  resolveAssistantStatePaths,
  sha256HostedBundleHex,
  createHostedPortableWorkspaceManifestFromBundle,
  listPendingAssistantRuntimeIssueRecords,
  snapshotHostedPortableWorkspaceDelta,
  snapshotHostedAssistantRuntimeHotState,
  snapshotHostedBundleRoots,
  writePendingAssistantRuntimeIssueRecord,
  writeHostedBundleTextFile,
} from "@murphai/runtime-state/node";
import {
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedMailboxConsumeRequest,
  type HostedMailboxConsumeResponse,
  type HostedMailboxFetchRequest,
  type HostedMailboxFetchResponse,
  type HostedMailboxItem,
  type HostedMailboxPayloadFetchRequest,
  type HostedMailboxPayloadFetchResponse,
  type HostedRuntimeLatencyTraceRequest,
  type HostedRuntimeLogRequest,
  type HostedWorkspaceCheckpointRequest,
  type HostedWorkspaceCheckpointResponse,
  type HostedWorkspaceReadResponse,
  type HostedWorkspaceInvocationRequest,
  type HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedExecutionBundleRef,
} from "@murphai/hosted-execution/contracts";
import {
  buildHostedExecutionLayeredSnapshotRef,
  buildHostedExecutionWorkingSnapshotRef,
  readHostedExecutionSnapshotBaseRef,
} from "@murphai/hosted-execution/parsers";
import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHostedWorkspaceSnapshotCheckpointRequestBuilder: vi.fn(),
  ensureHostedInboxSidecarReady: vi.fn(),
  refreshHostedBrowserVaultReplicaFromRuntime: vi.fn(),
  snapshotHostedPortableWorkspaceDelta: vi.fn(),
}));

vi.mock("@murphai/runtime-state/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@murphai/runtime-state/node")>();

  return {
    ...actual,
    snapshotHostedPortableWorkspaceDelta:
      mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(
        actual.snapshotHostedPortableWorkspaceDelta,
      ),
  };
});

vi.mock("../src/hosted-runtime/context.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/context.ts")>();

  return {
    ...actual,
    ensureHostedInboxSidecarReady: mocks.ensureHostedInboxSidecarReady.mockImplementation(
      actual.ensureHostedInboxSidecarReady,
    ),
  };
});

vi.mock("../src/hosted-runtime/browser-vault-replica.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/browser-vault-replica.ts")>();

  return {
    ...actual,
    refreshHostedBrowserVaultReplicaFromRuntime:
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockImplementation(
        actual.refreshHostedBrowserVaultReplicaFromRuntime,
      ),
  };
});

vi.mock("../src/hosted-runtime/workspace-runner.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/hosted-runtime/workspace-runner.ts")>();

  return {
    ...actual,
    createHostedWorkspaceSnapshotCheckpointRequestBuilder:
      mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(
        actual.createHostedWorkspaceSnapshotCheckpointRequestBuilder,
      ),
  };
});

import {
  createCoalescingRuntimeWakeSignal,
  HostedRuntimeCheckpointInterruptedByWakeError,
  HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError,
  HostedWorkspaceRunnerUserMismatchError,
  parseHostedAssistantWorkspaceRuntimeJobInput,
  runHostedWorkspaceRuntimeJobInProcess,
  type HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
} from "../src/hosted-runtime.ts";
import {
  ensureHostedInboxSidecarReady,
} from "../src/hosted-runtime/context.ts";
import {
  markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort,
} from "../src/hosted-runtime/workspace-restore.ts";
import {
  createEmptyHostedMailboxImportState,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
  HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
  HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
  readHostedMailboxImportState,
  type HostedMailboxImportState,
} from "../src/hosted-runtime/mailbox-state.ts";
import type {
  HostedRuntimeDeviceSyncPort,
  HostedRuntimeMailboxPort,
  HostedRuntimePlatform,
  RuntimeLivenessPort,
  HostedRuntimeWorkspacePort,
} from "../src/hosted-runtime-contracts.ts";
import type {
  HostedAssistantRuntimeResolvedConfig,
  HostedAssistantWorkspaceRuntimeJobInput,
} from "../src/hosted-runtime/models.ts";

const TEST_NOW = "2026-04-27T00:00:00.000Z";
const TEST_USER_ID = "member_synthetic_workspace_entrypoint";
const TEST_HOSTED_CODEX_FORWARDED_ENV = {
  HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
  HOSTED_ASSISTANT_PROVIDER: "openai",
  OPENAI_API_KEY: "test-vercel-key",
} as const;
const HOSTED_CONTAINER_CA_ENV_KEYS = [
  "CODEX_CA_CERTIFICATE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_FILE",
] as const;
const HOSTED_UNSTABLE_PROCESS_ENV_KEYS = [
  "TEMP",
  "TMP",
  "TMPDIR",
] as const;
const execFileAsync = promisify(execFile);

process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS ??= "0";

function continueRuntimeLiveness(): Awaited<ReturnType<RuntimeLivenessPort["touch"]>> {
  return {
    instruction: { kind: "continue" },
    ok: true,
  };
}

async function readCheckpointConversationWatermark(
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  vaultRoot: string,
): Promise<string> {
  if ("state" in input) {
    return input.state.watermarks.conversation;
  }

  return (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation;
}

async function describeCheckpointConversationWatermarkTransition(
  input: HostedWorkspaceSnapshotCheckpointRequestBuilderInput,
  vaultRoot: string,
): Promise<string> {
  if ("state" in input && "previousState" in input) {
    return `${input.previousState.watermarks.conversation}->${input.state.watermarks.conversation}`;
  }

  return `idle->${await readCheckpointConversationWatermark(input, vaultRoot)}`;
}

interface CapturedHostedExecutionLog {
  component?: unknown;
  details?: Record<string, unknown>;
  message?: unknown;
  userId?: unknown;
}

function readCapturedHostedExecutionLogs(spy: {
  mock: { calls: unknown[][] };
}): CapturedHostedExecutionLog[] {
  return spy.mock.calls.flatMap(([payload]) => {
    if (typeof payload !== "string") {
      return [];
    }

    try {
      return [JSON.parse(payload) as CapturedHostedExecutionLog];
    } catch {
      return [];
    }
  });
}

function readCapturedRuntimePhaseLogs(input: {
  attemptId: string;
  spy: { mock: { calls: unknown[][] } };
}): Array<CapturedHostedExecutionLog & {
  component: "runtime";
  details: Record<string, unknown>;
  message: string;
  userId: null;
}> {
  return readCapturedHostedExecutionLogs(input.spy)
    .filter((entry): entry is CapturedHostedExecutionLog & {
      component: "runtime";
      details: Record<string, unknown>;
      message: string;
      userId: null;
    } =>
      entry.component === "runtime"
      && entry.message === "Hosted workspace runtime phase boundary."
      && entry.userId === null
      && entry.details?.attemptId === input.attemptId
    );
}

describe("hosted workspace runtime entrypoint", () => {
  test("rejects a blocked runtime when the host signal aborts", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("host request aborted");
    const workspaceReadStarted = createDeferred<void>();
    const workspaceReadRelease = createDeferred<HostedWorkspaceReadResponse>();
    const resultPromise = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
      request: {
        attemptId: "attempt_synthetic_host_abort",
        leaseGeneration: "7",
        userId: TEST_USER_ID,
        workspaceVersion: "0",
      },
    }), {
      async createCheckpointSnapshot() {
        throw new Error("Host abort test should not checkpoint.");
      },
      async importItem() {
        throw new Error("Host abort test should not import mailbox items.");
      },
      platform: createPlatform({
        mailboxPort: createMailboxPort({ events: [], items: [] }),
        workspacePort: {
          async read() {
            workspaceReadStarted.resolve();
            return await workspaceReadRelease.promise;
          },
          async checkpoint() {
            throw new Error("Host abort test should not checkpoint workspace.");
          },
        },
      }),
      signal: hostAbortController.signal,
      vaultRoot,
    }).catch((error: unknown) => error);

    try {
      await workspaceReadStarted.promise;
      hostAbortController.abort(hostAbortReason);

      const timeout = new Error("Timed out waiting for host abort propagation.");
      const outcome = await Promise.race([
        resultPromise,
        new Promise<unknown>((resolve) => setTimeout(() => resolve(timeout), 250)),
      ]);
      assert.equal(outcome, hostAbortReason);
    } finally {
      workspaceReadRelease.resolve({
        fetchedAt: TEST_NOW,
        workspace: createWorkspaceState({ version: "0" }),
      });
      await resultPromise.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("emits metadata-only phase boundary logs for runtime startup", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const latencyTraceRequests: HostedRuntimeLatencyTraceRequest[] = [];

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_boundaries",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          throw new Error("Phase-boundary test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Phase-boundary test should not import mailbox items.");
        },
        platform: createPlatform({
          latencyTraceRequests,
          mailboxPort: createMailboxPort({ events: [], fetchRequests, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_boundaries",
        spy: consoleInfo,
      });

      assert.deepEqual(phaseLogs.map((entry) => [
        entry.details.runtimePhase,
        entry.details.runtimePhaseStatus,
      ]), [
        ["workspace.read", "start"],
        ["workspace.read", "done"],
        ["workspace.restore", "start"],
        ["workspace.restore", "done"],
        ["cli.bridge", "start"],
        ["cli.bridge", "done"],
        ["codex.prepare", "start"],
        ["codex.prepare", "done"],
        ["mailbox.import.initial", "start"],
        ["mailbox.import.initial", "done"],
        ["inbox.sidecar", "start"],
        ["inbox.sidecar", "done"],
        ["foreground.pass", "start"],
        ["foreground.pass", "done"],
        ["runtime.return", "done"],
      ]);
      expect(phaseLogs.map((entry) => entry.details.runtimePhaseOrdinal)).toEqual(
        Array.from({ length: phaseLogs.length }, (_value, index) => index + 1),
      );
      expect(phaseLogs.every((entry) =>
        typeof entry.details.runtimeElapsedMs === "number"
      )).toBe(true);
      expect(phaseLogs[1]?.details.runtimePhaseDurationMs).toEqual(expect.any(Number));
      assert.equal(phaseLogs.every((entry) => entry.userId === null), true);
      assert.equal(
        phaseLogs.some((entry) => JSON.stringify(entry).includes(TEST_USER_ID)),
        false,
      );
      expect(phaseLogs[1]?.details).toEqual(expect.objectContaining({
        actualWorkspaceVersion: "0",
        workspacePresent: true,
      }));
      expect(phaseLogs.find((entry) =>
        entry.details.runtimePhase === "mailbox.import.initial"
        && entry.details.runtimePhaseStatus === "done"
      )?.details).toEqual(expect.objectContaining({
        fetchedCount: 0,
        importedCount: 0,
      }));
      expect(latencyTraceRequests.map((request) => request.event)).toEqual([
        expect.objectContaining({
          milestone: "mailbox_import_done",
          runtimeAttemptId: "attempt_synthetic_phase_boundaries",
          source: "linq",
          type: "runtime_milestone",
        }),
      ]);
      assert.deepEqual(fetchRequests.map((request) => request.lanes), [
        [
          { importedSeq: "0", lane: "system" },
          { importedSeq: "0", lane: "conversation" },
        ],
        [
          { importedSeq: "0", lane: "system" },
        ],
      ]);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("passes stable container CA env into hosted Codex runtime env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const containerCaPath = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
    const previousEnv = new Map([
      ...HOSTED_CONTAINER_CA_ENV_KEYS,
      ...HOSTED_UNSTABLE_PROCESS_ENV_KEYS,
    ].map((key) => [key, process.env[key]]));
    const runtimeEnvs: Readonly<Record<string, string>>[] = [];

    try {
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        process.env[key] = containerCaPath;
      }
      for (const key of HOSTED_UNSTABLE_PROCESS_ENV_KEYS) {
        process.env[key] = `/tmp/synthetic-runtime-${key.toLowerCase()}-churn`;
      }
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_container_ca_env",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "3".repeat(64) : "4".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-ca-env.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_container_ca_env",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            runtimeEnvs.push(input.runtimeEnv);
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(runtimeEnvs.length, 1);
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        assert.equal(runtimeEnvs[0]?.[key], containerCaPath);
      }
      for (const key of HOSTED_UNSTABLE_PROCESS_ENV_KEYS) {
        assert.equal(runtimeEnvs[0]?.[key], undefined);
      }
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("uses hosted Codex runtime CA env for intercepted OpenAI HTTPS requests", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const certRoot = await mkdtemp(path.join(tmpdir(), "murph-openai-ca-probe-"));
    const certFiles = await createOpenAiProbeCertificateFiles(certRoot);
    const previousEnv = new Map(HOSTED_CONTAINER_CA_ENV_KEYS.map((key) => [
      key,
      process.env[key],
    ]));
    const probeResults: OpenAiHttpsProbeResult[] = [];
    let openAiServer: Awaited<ReturnType<typeof startOpenAiProbeServer>> | null = null;

    try {
      for (const key of HOSTED_CONTAINER_CA_ENV_KEYS) {
        process.env[key] = certFiles.caCertPath;
      }
      const server = await startOpenAiProbeServer(certFiles);
      openAiServer = server;
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          forwardedEnv: {
            OPENAI_API_KEY: "__cloudflare_injected__",
          },
          request: {
            attemptId: "attempt_synthetic_openai_https_ca_probe",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "5".repeat(64) : "6".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}-openai-ca-probe.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_openai_https_ca_probe",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            probeResults.push(await runOpenAiHttpsProbe({
              runtimeEnv: input.runtimeEnv,
              url: `https://api.openai.com:${server.port}/v1/responses`,
            }));
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(probeResults, [
        {
          body: "ok",
          caConfigured: true,
          ok: true,
          status: 200,
        },
      ]);
    } finally {
      for (const [key, value] of previousEnv) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      await openAiServer?.close();
      await removeTempRoot(certRoot);
      await removeTempRoot(vaultRoot);
    }
  });

  test("uses invocation workspace state without a startup workspace-port read", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const suppliedWorkspace = createWorkspaceState({ version: "0" });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_invocation_workspace",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: suppliedWorkspace,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Invocation workspace state test should not checkpoint.");
          },
          async importItem() {
            throw new Error("Invocation workspace state test should not import mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events: [], items: [] }),
            workspacePort: {
              async read() {
                throw new Error("Invocation workspace state should avoid startup workspace read.");
              },
              async checkpoint() {
                throw new Error("Invocation workspace state test should not checkpoint.");
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs deferred durable checkpoint effects only after idle checkpoint succeeds", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      return {
        nextWakeAt: "2026-04-27T00:02:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_success",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-success.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("durable-effect"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:02:00.000Z");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("waits for deferred import enrichment before idle checkpointing dirty runtime state", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const enrichmentGate = createDeferred<void>();
    let resultPromise: Promise<Awaited<ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess>>>
      | null = null;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_import_enrichment_checkpoint_barrier",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/import-enrichment-barrier.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            events.push("import");
            return {
              afterCheckpoint: async () => {
                events.push("mailbox:afterCheckpoint:start");
                await enrichmentGate.promise;
                events.push("mailbox:afterCheckpoint:done");
                return {
                  attachmentEvidenceUpdated: true,
                  kind: "inbox_projection",
                  projectionUpdated: true,
                  reasonCode: null,
                  status: "succeeded",
                };
              },
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant");
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(events.includes("mailbox:afterCheckpoint:start"), true);
      });
      assert.equal(events.includes("snapshot:idle_shutdown"), false);
      assert.equal(events.includes("workspace.checkpoint"), false);
      assert.equal(checkpointRequests.length, 0);

      enrichmentGate.resolve();
      const result = await resultPromise;

      assert.equal(result.status, "idle");
      assert.ok(
        requireEventIndex(events, "mailbox:afterCheckpoint:done")
          < requireEventIndex(events, "snapshot:idle_shutdown"),
      );
      assert.ok(
        requireEventIndex(events, "mailbox:afterCheckpoint:done")
          < requireEventIndex(events, "workspace.checkpoint"),
      );
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
    } finally {
      enrichmentGate.resolve();
      await resultPromise?.catch(() => undefined);
      await removeTempRoot(vaultRoot);
    }
  });

  test("preserves a deferred durable checkpoint effect wake after draining a checkpoint wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const durableWakeAt = "2026-04-27T00:04:00.000Z";
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
      runtimeWakeSignal.notify();
      return {
        nextWakeAt: durableWakeAt,
        nextWakeReason: "device-sync.reconcile",
      };
    });
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_checkpoint_wake_drain",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-checkpoint-wake-drain.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                afterCheckpoint: async () => ({
                  afterDurableCheckpoint: durableEffect,
                  checkpointReason: "assistant_runtime_commit",
                }),
                checkpointReason: "assistant_runtime_commit",
                progressed: true,
              };
            }
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.equal(durableEffect.mock.calls.length, 1);
      assert.equal(assistantPhaseCalls, 2);
      assert.ok(
        events.indexOf("durable-effect") < events.indexOf("assistant.phase:2"),
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, durableWakeAt);
      assert.equal(result.nextWakeReason, "device-sync.reconcile");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("continues later deferred durable checkpoint effects after one fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failingDurableEffect = vi.fn(async () => {
      events.push("durable-effect:failing");
      throw new Error("synthetic durable effect failure");
    });
    const followUpDurableEffect = vi.fn(async () => {
      events.push("durable-effect:follow-up");
      return {
        nextWakeAt: "2026-04-27T00:03:00.000Z",
        nextWakeReason: "device-sync.reconcile",
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_failure_isolated",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "1".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-failure-isolated.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: [
                  failingDurableEffect,
                  followUpDurableEffect,
                ],
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.equal(failingDurableEffect.mock.calls.length, 1);
      assert.equal(followUpDurableEffect.mock.calls.length, 1);
      assert.deepEqual(events.slice(events.indexOf("workspace.checkpoint") + 1), [
        "durable-effect:failing",
        "durable-effect:follow-up",
      ]);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, "2026-04-27T00:03:00.000Z");
    } finally {
      consoleError.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not run deferred durable checkpoint effects when idle checkpoint fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const durableEffect = vi.fn(async () => {
      events.push("durable-effect");
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_durable_effect_failure",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/durable-effect-failure.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "0" }),
                };
              },
              async checkpoint() {
                events.push("workspace.checkpoint");
                throw new Error("checkpoint failed before durable effects");
              },
            },
          }),
          async runAssistantPhase() {
            return {
              afterCheckpoint: async () => ({
                afterDurableCheckpoint: durableEffect,
                checkpointReason: "assistant_runtime_commit",
              }),
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      )).rejects.toThrow("checkpoint failed before durable effects");

      assert.equal(durableEffect.mock.calls.length, 0);
      assert.deepEqual(events.includes("durable-effect"), false);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when invocation workspace state has a stale version", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_invocation_workspace_stale",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: createWorkspaceState({ version: "6" }),
            workspaceVersion: "5",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after stale invocation workspace.");
          },
          async importItem() {
            throw new Error("Import should not run after stale invocation workspace.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          vaultRoot: "synthetic-vault-root",
        },
      ),
    ).rejects.toBeInstanceOf(HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError);

    assert.deepEqual(events, []);
  });

  test("fails closed when invocation workspace state belongs to another user", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_invocation_workspace_other_user",
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/other-user.bundle.json",
                size: 512,
              }),
              userId: "member_synthetic_workspace_other",
              version: "0",
            }),
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after invocation workspace user mismatch.");
          },
          async importItem() {
            throw new Error("Import should not run after invocation workspace user mismatch.");
          },
          platform: createPlatform({
            artifactGetCalls,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          vaultRoot: "synthetic-vault-root",
        },
      ),
    ).rejects.toBeInstanceOf(HostedWorkspaceRunnerUserMismatchError);

    assert.deepEqual(events, []);
    assert.deepEqual(artifactGetCalls, []);
  });

  test("emits metadata-only phase boundary logs for checkpoint and bridge shutdown", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceSyncPort: HostedRuntimeDeviceSyncPort = {
      async ackDirtyStateProcessed() {
        throw new Error("Device sync ack should not run.");
      },
      async applyUpdates() {
        throw new Error("Device sync apply should not run.");
      },
      async createConnectLink() {
        throw new Error("Device sync connect link should not run.");
      },
      async fetchDirtyStates() {
        throw new Error("Device sync dirty state should not run.");
      },
      async fetchSnapshot() {
        throw new Error("Device sync snapshot should not run.");
      },
    };

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_checkpoint",
          idleCheckpointDelayMs: 1,
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "d".repeat(64),
              key: "users/bundles/member-synthetic/phase-checkpoint.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          deviceSyncPort,
          mailboxPort: createMailboxPort({
            events: [],
            items: [createMailboxItem({ laneSeq: "1" })],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_checkpoint",
        spy: consoleInfo,
      });
      expect(phaseLogs.map((entry) => [
        entry.details.runtimePhase,
        entry.details.runtimePhaseStatus,
      ])).toEqual(expect.arrayContaining([
        ["cli.bridge", "done"],
        ["workspace.checkpoint.idle_shutdown", "start"],
        ["workspace.checkpoint.idle_shutdown", "done"],
        ["runtime.return", "done"],
      ]));
      expect(
        phaseLogs.find((entry) =>
          entry.details.runtimePhase === "cli.bridge"
          && entry.details.runtimePhaseStatus === "done"
        )?.details,
      ).toEqual(expect.objectContaining({
        bridgeStarted: true,
      }));
      assert.equal(phaseLogs.every((entry) => entry.userId === null), true);
      assert.equal(
        readCapturedHostedExecutionLogs(consoleInfo)
          .some((entry) => JSON.stringify(entry).includes(TEST_USER_ID)),
        false,
      );
      assert.equal(checkpointRequests.length, 1);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("emits metadata-only phase boundary logs for runtime failures", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hiddenFailureMessage = "hidden prompt transcript failure";
    const hiddenFailureDetail = "hidden mailbox payload detail";

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_phase_failure",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          throw new Error("Failure phase test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Failure phase test should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        async runAssistantPhase() {
          throw Object.assign(new Error(hiddenFailureMessage), {
            details: {
              payload: hiddenFailureDetail,
            },
          });
        },
        vaultRoot,
      })).rejects.toThrow(hiddenFailureMessage);

      const phaseLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_phase_failure",
        spy: consoleError,
      });
      const failureLogs = phaseLogs.filter((entry) =>
        entry.details.runtimePhaseStatus === "fail"
      );
      expect(failureLogs.map((entry) => entry.details.runtimePhase)).toEqual([
        "foreground.pass",
        "runtime",
      ]);
      for (const entry of failureLogs) {
        expect(entry.details).toEqual(expect.objectContaining({
          failureDetailsPresent: true,
          failureMessagePresent: true,
          failureName: "Error",
        }));
      }
      const serializedLogs = JSON.stringify([
        ...readCapturedHostedExecutionLogs(consoleInfo),
        ...readCapturedHostedExecutionLogs(consoleError),
      ]);
      expect(serializedLogs).not.toContain(TEST_USER_ID);
      expect(serializedLogs).not.toContain(hiddenFailureMessage);
      expect(serializedLogs).not.toContain(hiddenFailureDetail);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleError.mockRestore();
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("emits a fail boundary for the open runtime phase when restore throws", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousStdIoLogSetting = process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const hiddenSnapshotHash = "f".repeat(64);

    try {
      process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = "1";
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput({
        request: {
          attemptId: "attempt_synthetic_restore_phase_failure",
          leaseGeneration: "7",
          userId: TEST_USER_ID,
          workspaceVersion: "0",
        },
      }), {
        async createCheckpointSnapshot() {
          throw new Error("Restore phase test should not checkpoint.");
        },
        async importItem() {
          throw new Error("Restore phase test should not import mailbox items.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: hiddenSnapshotHash,
                key: "users/bundles/member-synthetic/restore-phase-failure.bundle.json",
                size: 512,
              }),
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      })).rejects.toThrow("Hosted workspace runtime job snapshot restore failed.");

      const failureLogs = readCapturedRuntimePhaseLogs({
        attemptId: "attempt_synthetic_restore_phase_failure",
        spy: consoleError,
      }).filter((entry) => entry.details.runtimePhaseStatus === "fail");
      expect(failureLogs.map((entry) => entry.details.runtimePhase)).toEqual([
        "workspace.restore",
        "runtime",
      ]);
      expect(failureLogs[0]?.details).toEqual(expect.objectContaining({
        failureDetailsPresent: false,
        failureMessagePresent: true,
        runtimePhaseDurationMs: expect.any(Number),
      }));

      const serializedLogs = JSON.stringify([
        ...readCapturedHostedExecutionLogs(consoleInfo),
        ...readCapturedHostedExecutionLogs(consoleError),
      ]);
      expect(serializedLogs).not.toContain(TEST_USER_ID);
      expect(serializedLogs).not.toContain(hiddenSnapshotHash);
    } finally {
      if (previousStdIoLogSetting === undefined) {
        delete process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS;
      } else {
        process.env.MURPH_HOSTED_EXECUTION_STDIO_LOGS = previousStdIoLogSetting;
      }
      consoleError.mockRestore();
      consoleInfo.mockRestore();
      await removeTempRoot(vaultRoot);
    }
  });

  test("reads workspace, imports mailbox prefix, snapshots through the semantic checkpoint builder, and checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const items = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_001",
        laneSeq: "1",
      }),
    ];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({ version: "0" }),
    });
    const mailboxPort = createMailboxPort({ events, items });
    const imported: Array<{ id: string; route: string }> = [];
    const importContextMilestones: unknown[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    runtimeWakeSignal.notify(1_777_000_000_075);

    try {
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.bestEffort, true);
        assert.equal(input.rebuild, true);
        assert.equal(input.requestId, "hosted-workspace-invocation:attempt_synthetic_workspace_entrypoint");
        assert.equal(input.vaultRoot, path.resolve(vaultRoot));
        return await ensureHostedInboxSidecarReadyImpl(input);
      });

      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_workspace_entrypoint",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            const state = await readHostedMailboxImportState({ vaultRoot });
            events.push(`snapshot:${state.watermarks.conversation}`);
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/workspace-entrypoint.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item, context) {
            imported.push({
              id: item.item.id,
              route: item.route.action,
            });
            events.push(`import:${item.item.id}`);
            // Snapshot at call time: the milestone object is shared and mutated
            // by the runtime across the post-restore phase-breakdown rebuild.
            importContextMilestones.push(structuredClone(context?.latencyMilestones ?? null));
            return { status: "imported" };
          },
          // Incoming container-side milestones: the post-restore rebuild must
          // PRESERVE the dispatch sub-object alongside the rebuilt restore/boot
          // (a dropped dispatch here previously killed the instrumentation
          // end-to-end despite valid headers and a valid parser).
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort,
          }),
          runtimeWakeSignal,
          vaultRoot,
        });
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:mailbox_item_entrypoint_001",
        "sidecar.ready",
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(imported, [
        {
          id: "mailbox_item_entrypoint_001",
          route: "import-conversation-message",
        },
      ]);
      expect(importContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: 1_777_000_000_075,
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("exports pending assistant runtime issues after an idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const exportedIssueIds: string[] = [];
    const issueRecord = {
      component: "assistant.codex-action",
      details: {
        actionKind: "command.execution",
        durationMsBucket: "lt_1s",
        exitCode: 1,
        outputBytesBucket: "0",
      },
      environment: "hosted" as const,
      errorCode: "CODEX_COMMAND_EXIT_NONZERO",
      fingerprint: "abcdef123456abcdef123456",
      issueId: "ari_0123456789abcdef_abcdef123456abcdef123456",
      issueKind: "tool_error" as const,
      occurredAt: "2026-04-27T00:00:00.000Z",
      operation: "command.execution",
      phase: "provider_turn" as const,
      schema: "murph.assistant-runtime-issue.v1" as const,
      severity: "warning" as const,
      summary: "Codex command execution failed during provider turn.",
      surface: null,
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_issue_export",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push("snapshot");
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            assert.deepEqual(
              (await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot }))
                .map((record) => record.issueId),
              [issueRecord.issueId],
            );
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/issue-export.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            events.push("import");
            await writePendingAssistantRuntimeIssueRecord({
              record: issueRecord,
              vault: vaultRoot,
            });
            return { status: "imported" };
          },
          platform: createPlatform({
            events,
            issueExportPort: {
              async recordIssues(issues) {
                events.push("issue.export");
                const issueIds = issues.map((issue) => {
                  const issueId = (issue as { issueId?: unknown }).issueId;
                  if (typeof issueId !== "string") {
                    throw new Error("expected exported issue id");
                  }
                  return issueId;
                });
                exportedIssueIds.push(...issueIds);
                return {
                  issueIds,
                  recorded: issues.length,
                };
              },
            },
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_issue_export_001",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(exportedIssueIds, [issueRecord.issueId]);
      assert.ok(
        events.indexOf("snapshot") < events.indexOf("workspace.checkpoint"),
        "workspace checkpoint should commit the dirty workspace snapshot before telemetry",
      );
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("issue.export"),
        "issue export should run after the durable workspace checkpoint",
      );
      assert.deepEqual(await listPendingAssistantRuntimeIssueRecords({ vault: vaultRoot }), []);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground consume ack reaches the mailbox port through the abort-guarded platform", async () => {
    // Regression: the abort-guard platform wrapper rebuilt mailboxPort with
    // only fetch/fetchPayload, silently dropping consume — every prod reply
    // pass skipped the consumed-watermark ack with consume_port_missing. The
    // runner-level consume-ack tests inject the platform directly and never
    // see that wrapper, so this must hold at the in-process job entrypoint.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const consumeRequests: HostedMailboxConsumeRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxPort = createMailboxPort({
      consumedSeqByLane: [
        {
          consumedSeq: "0",
          lane: "conversation",
        },
      ],
      consumeRequests,
      events,
      items: [
        createMailboxItem({
          id: "mailbox_item_entrypoint_consume_ack",
          laneSeq: "1",
        }),
      ],
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "b".repeat(64),
              key: "users/bundles/member-synthetic/workspace-entrypoint-consume-ack.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem(item) {
          return {
            assistantInputId: await stageAssistantInputEventForMailboxItem({
              item: item.item,
              vaultRoot,
            }),
            status: "imported",
          };
        },
        platform: createPlatform({
          events,
          logRequests,
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        async runAssistantPhase() {
          return { foregroundReplyFailed: 0, progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(
        consumeRequests.map((request) => request.lanes),
        [[{ consumedSeq: "1", lane: "conversation" }]],
      );
      assert.ok(
        events.indexOf("workspace.checkpoint") < events.indexOf("mailbox.consume"),
        "consume ack should run after the durable workspace checkpoint",
      );
      const consumeAckEntries = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "mailbox.consume_ack_advanced"
          || entry.eventCode === "mailbox.consume_ack_skipped"
        );
      assert.deepEqual(
        consumeAckEntries.map((entry) => ({
          eventCode: entry.eventCode,
          mailboxSeqEnd: entry.mailboxSeqEnd,
        })),
        [{
          eventCode: "mailbox.consume_ack_advanced",
          mailboxSeqEnd: "1",
        }],
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("replay-only consume ack flushes without a new dirty checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-replay-consume-"));
    const events: string[] = [];
    const consumeRequests: HostedMailboxConsumeRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "100";
    const bundle = createMailboxImportStateBundle(restoredState);
    const replayItems = Array.from({ length: 100 }, (_, index) =>
      createMailboxItem({
        id: `mailbox_item_entrypoint_replay_consume_${String(index + 1).padStart(3, "0")}`,
        laneSeq: String(index + 1),
        payloadInlineCiphertext: null,
        payloadRef: `payload_ref_entrypoint_replay_consume_${String(index + 1).padStart(3, "0")}`,
      })
    );

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_replay_only_consume",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("replay-only consume should not create a workspace checkpoint");
          },
          async importItem() {
            throw new Error("locally imported replay should not be imported again");
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
            mailboxPort: {
              ...createMailboxPort({
                consumedSeqByLane: [
                  {
                    consumedSeq: "0",
                    lane: "conversation",
                  },
                ],
                consumeRequests,
                events,
                items: replayItems,
              }),
              async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
                throw new Error("locally imported replay sidecar should not be fetched");
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "100",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/replay-consume-before.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant");
            return {
              progressed: false,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(
        consumeRequests.map((request) => request.lanes),
        [[{ consumedSeq: "100", lane: "conversation" }]],
      );
      assert.ok(
        events.indexOf("assistant") < events.indexOf("mailbox.consume"),
        "replay-only consume should flush after the foreground pass",
      );
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime abort blocks the foreground consume ack at the abort-guarded platform", async () => {
    // The guard half of the consume passthrough: the consumed-watermark ack is
    // a durable write, so once the runtime abort signal fires it must never
    // reach the mailbox port — an aborted attempt has no durably delivered
    // reply, and advancing the watermark anyway would permanently drop those
    // mailbox items instead of replaying them. The job promise rejects at the
    // abort race before the runner's detached best-effort ack runs, and the
    // abort-guarded log port swallows the runner.error/mailbox_consume_failed
    // durable write, so the runner's consume-failure console warning is the
    // only deterministic completion signal for the detached pass.
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const consumeRequests: HostedMailboxConsumeRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const hostAbortController = new AbortController();
    const hostAbortReason = new Error("synthetic runtime abort during assistant phase");
    const consumeAttemptSettled = createDeferred<"underlying_consume_invoked">();
    const basePort = createMailboxPort({
      consumeRequests,
      events,
      items: [
        createMailboxItem({
          id: "mailbox_item_entrypoint_consume_abort",
          laneSeq: "1",
        }),
      ],
    });
    const mailboxPort: HostedRuntimeMailboxPort = {
      ...basePort,
      async consume(request) {
        consumeAttemptSettled.resolve("underlying_consume_invoked");
        return await basePort.consume!(request);
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const outcome = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: { attemptId: "attempt_synthetic_consume_abort" },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/workspace-entrypoint-consume-abort.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            return {
              assistantInputId: await stageAssistantInputEventForMailboxItem({
                item: item.item,
                vaultRoot,
              }),
              status: "imported",
            };
          },
          platform: createPlatform({
            events,
            logRequests,
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            hostAbortController.abort(hostAbortReason);
            return { foregroundReplyFailed: 0, progressed: false };
          },
          signal: hostAbortController.signal,
          vaultRoot,
        },
      ).then(
        () => "resolved" as const,
        (error: unknown) => error,
      );
      assert.equal(outcome, hostAbortReason);

      const consumeAttempt = await Promise.race([
        consumeAttemptSettled.promise,
        new Promise<"timed_out_waiting_for_consume_attempt">((resolve) =>
          setTimeout(() => resolve("timed_out_waiting_for_consume_attempt"), 100)
        ),
      ]);
      assert.equal(consumeAttempt, "timed_out_waiting_for_consume_attempt");
      assert.deepEqual(consumeRequests, []);
      assert.deepEqual(
        logRequests
          .flatMap((request) => request.entries)
          .filter((entry) => entry.eventCode === "mailbox.consume_ack_advanced"),
        [],
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("imports system bootstrap before initial conversation import for cold vaults", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    let bootstrapImported = false;

    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
    });
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_member_activated_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.rebuild, true);
        return true;
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_cold_conversation_bootstrap",
            budget: {
              maxMailboxItems: 10,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            assert.equal(snapshotInput.reason, "idle_shutdown");
            assert.equal(await readCheckpointConversationWatermark(snapshotInput, vaultRoot), "1");
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/cold-bootstrap.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            if (item.item.kind === "member.activated") {
              await initializeVault({ createdAt: TEST_NOW, vaultRoot });
              bootstrapImported = true;
              return { status: "imported" };
            }

            assert.equal(bootstrapImported, true);
            return {
              assistantInputId: "ain_00000000000000000000000000000000",
              status: "imported",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [conversationItem, systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            assert.equal(input.initialMailboxImport.state.watermarks.system, "1");
            assert.equal(input.initialMailboxImport.state.watermarks.conversation, "1");
            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
        "conversation:conversation.message",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 2,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "1",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not import initial conversation messages while cold bootstrap is deferred", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];

    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_deferred_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
    });
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_deferred_member_activated_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_cold_conversation_bootstrap",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Deferred bootstrap should not checkpoint unchanged mailbox state.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            return {
              reasonCode: "bootstrap.deferred",
              status: "deferred",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [conversationItem, systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Deferred bootstrap should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
      ]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 2,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 2,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("stops before assistant runtime when cold bootstrap is deferred without conversation", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const systemItem = createMailboxItem({
      id: "mailbox_item_entrypoint_system_deferred_only_001",
      kind: "member.activated",
      lane: "system",
      laneSeq: "1",
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_deferred_system_bootstrap_only",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Deferred system bootstrap should not checkpoint unchanged mailbox state.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            return {
              reasonCode: "bootstrap.deferred",
              status: "deferred",
            };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [systemItem],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Deferred system bootstrap should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, [
        "system:member.activated",
      ]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not resolve initial conversation payloads before cold bootstrap exists", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const imported: string[] = [];
    const conversationItem = createMailboxItem({
      id: "mailbox_item_entrypoint_unbootstrapped_image_only_001",
      kind: "conversation.message",
      lane: "conversation",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "payload_ref_synthetic_conversation",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      fetchRequests,
      items: [conversationItem],
    });
    const mailboxPort: HostedRuntimeMailboxPort = {
      ...baseMailboxPort,
      async fetchPayload() {
        events.push("mailbox.fetchPayload");
        throw new Error("Cold bootstrap should defer before conversation payload fetch.");
      },
    };

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_unbootstrapped_conversation_payload",
            budget: {
              maxMailboxItems: 10,
            },
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Unbootstrapped conversation deferral should not checkpoint.");
          },
          async importItem(item) {
            imported.push(`${item.item.lane}:${item.item.kind}`);
            throw new Error("Unbootstrapped conversation deferral should not import.");
          },
          platform: createPlatform({
            mailboxPort,
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            throw new Error("Unbootstrapped conversation deferral should not run assistant phase.");
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map((request) => request.lanes.map((lane) => lane.lane)), [
        ["system", "conversation"],
      ]);
      assert.deepEqual(imported, []);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.equal(typeof result.nextWakeAt, "string");
      assert.deepEqual(result, {
        nextWakeAt: result.nextWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoints dirty mailbox imports after the runtime idle window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const workspacePort = createWorkspacePort({
      checkpointRequests,
      events,
      workspace: createWorkspaceState({ version: "4" }),
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            assert.equal(snapshotInput.reason, "idle_shutdown");
            assert.equal(
              snapshotInput.redactedStatus?.hostedMailboxConversationImportedSeq,
              "1",
            );
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            events.push("mailbox.importItem");
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort,
          }),
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.attemptId, "attempt_synthetic_runtime_idle_checkpoint");
      assert.equal(checkpointRequests[0]?.expectedWorkspaceVersion, "4");
      assert.equal(checkpointRequests[0]?.leaseGeneration, "9");
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 1,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground stale assistant wake does not keep dirty runtime ahead of idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleWakeAt = "2026-04-26T23:59:59.000Z";

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_foreground_stale_assistant_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/foreground-stale-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            deviceSyncPort,
            events,
            logRequests,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_foreground_stale_wake_001",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          vaultRoot,
        },
      );
      const elapsedMs = performance.now() - startedAt;
      const assistantPass = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "assistant.pass_finished");

      assert.ok(elapsedMs < 5_000);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_foreground_stale_wake_001",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(assistantPass?.redactedJson?.deviceSyncSkipped, true);
      assert.equal(assistantPass?.redactedJson?.nextWakeAtPresent, false);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, 0);
      assert.equal(deviceSyncPort.fetchSnapshotCalls, 0);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes reset the idle checkpoint window before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const idleWakeImportContextMilestones: unknown[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let wakeQueued = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wake",
            idleCheckpointDelayMs: 5,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_002") {
              idleWakeImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            if (!wakeQueued) {
              wakeQueued = true;
              setTimeout(() => {
                mailboxItems.push(createMailboxItem({
                  id: "mailbox_item_entrypoint_002",
                  laneSeq: "2",
                }));
                runtimeWakeSignal.notify();
              }, 0);
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_001",
        "mailbox.importItem:mailbox_item_entrypoint_002",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      expect(idleWakeImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: expect.any(Number),
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("no-progress runtime wakes do not postpone the dirty idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 50;
    const wakeTimers: ReturnType<typeof setTimeout>[] = [];
    const clearWakeTimers = () => {
      while (wakeTimers.length > 0) {
        clearTimeout(wakeTimers.pop());
      }
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      for (const delayMs of [2, 8, 14, 20]) {
        wakeTimers.push(setTimeout(() => runtimeWakeSignal.notify(), delayMs));
      }
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_no_progress_wakes",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            clearWakeTimers();
            return {
              snapshotRef: createBundleRef({
                hash: "4".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-no-progress-wakes.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_no_progress_wake_001",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );
      const elapsedMs = performance.now() - startedAt;

      assert.ok(elapsedMs >= idleCheckpointDelayMs - 20);
      assert.ok(fetchRequests.length > 1);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_no_progress_wake_001",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "1",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "1");
    } finally {
      clearWakeTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("dirty runtime wakes use projected wake state before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const staleWakeAt = "2000-04-27T00:05:00.000Z";
    const idleCheckpointDelayMs = 50;
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_wake",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (input.workspace?.nextWakeAt === staleWakeAt) {
              if (assistantPhaseCalls === 1) {
                runtimeWakeSignal.notify();
              }
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "idle");
      assert.ok(fetchRequests.length > 1);
      assert.equal(assistantPhaseCalls, 1);
      assert.deepEqual(
        events
          .filter((event) => event.startsWith("assistant.phase:"))
          .filter((event) => event.includes(staleWakeAt)),
        [`assistant.phase:1:${staleWakeAt}`],
      );
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.nextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("projected runtime wakes use projected wake state before the idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const staleWakeAt = "2000-04-27T00:05:00.000Z";
    const projectedWakeAt = new Date(Date.now() + 15).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_runtime_wake",
            idleCheckpointDelayMs: 75,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-runtime-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase(input) {
            assistantPhaseCalls += 1;
            events.push(
              `assistant.phase:${assistantPhaseCalls}:${input.workspace?.nextWakeAt ?? "none"}`,
            );
            if (input.workspace?.nextWakeAt === staleWakeAt) {
              return {
                checkpointReason: "canonical_runtime_commit",
                nextWakeAt: projectedWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              progressed: false,
              redactedStatus: {
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(result.status, "scheduled");
      assert.ok(fetchRequests.length > 1);
      assert.ok(assistantPhaseCalls > 1);
      assert.deepEqual(
        events
          .filter((event) => event.startsWith("assistant.phase:"))
          .filter((event) => event.includes(staleWakeAt)),
        [`assistant.phase:1:${staleWakeAt}`],
      );
      assert.ok(events.includes(`assistant.phase:2:${projectedWakeAt}`));
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground runtime wake imports conversation input after initial mailbox budget exhaustion", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-foreground-budget-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const importedSeqs: string[] = [];
    const foregroundImportContextMilestones: unknown[] = [];
    const expectedImportedSeqs = Array.from({ length: 14 }, (_, index) => String(index + 1));
    const mailboxItems = Array.from({ length: 13 }, (_, index) => {
      const seq = String(index + 1);
      return createMailboxItem({
        id: `mailbox_item_entrypoint_foreground_budget_${seq.padStart(3, "0")}`,
        laneSeq: seq,
      });
    });
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_foreground_budget",
            budget: {
              maxMailboxItems: 12,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/foreground-budget.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            if (item.item.laneSeq === "14") {
              foregroundImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_foreground_budget_014",
              laneSeq: "14",
              occurredAt: "2026-04-27T00:00:14.000Z",
            }));
            runtimeWakeSignal.notify();
            await waitUntil(() => {
              assert.deepEqual(importedSeqs, expectedImportedSeqs);
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "12"]);
      assert.deepEqual(fetchRequests.map((request) => request.limitPerLane), [13, 11]);
      assert.deepEqual(
        events.filter((event) => event.startsWith("import:")),
        expectedImportedSeqs.map((seq) => `import:${seq}`),
      );
      assert.ok(events.includes("snapshot:idle_shutdown:14"));
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "14",
      );
      assert.equal(result.status, "budget_exhausted");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "14");
      expect(foregroundImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
      assert.equal(
        (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
        "14",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground mailbox budget ignores replayed rows while admitting rapid follow-ups", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-budget-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importedSeqs: string[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_replay_budget_001",
        laneSeq: "1",
      }),
      createMailboxItem({
        id: "mailbox_item_entrypoint_replay_budget_002",
        laneSeq: "2",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_replay_budget",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/replay-budget.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            logRequests,
            mailboxPort: createMailboxPort({
              consumedSeqByLane: [
                {
                  consumedSeq: "0",
                  lane: "conversation",
                },
              ],
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            events.push("assistant");
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_replay_budget_003",
              laneSeq: "3",
              occurredAt: "2026-04-27T00:00:03.000Z",
            }));
            mailboxItems.push(createMailboxItem({
              id: "mailbox_item_entrypoint_replay_budget_004",
              laneSeq: "4",
              occurredAt: "2026-04-27T00:00:04.000Z",
            }));
            runtimeWakeSignal.notify();
            await waitUntil(() => {
              assert.ok(importedSeqs.includes("4"));
            });
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "2"]);
      assert.deepEqual(importedSeqs, ["1", "2", "3", "4"]);
      assert.ok(events.includes("snapshot:idle_shutdown:4"));
      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "4");
      const activeImportLogs = logRequests
        .flatMap((request) => request.entries)
        .filter((entry) => entry.phase === "active_turn_input");
      expect(activeImportLogs).toEqual([
        expect.objectContaining({
          eventCode: "mailbox.imported",
          level: "info",
          redactedJson: expect.objectContaining({
            blockCodes: [],
            blockedCount: 0,
            conversationSeqEnd: "4",
            conversationSeqStart: "2",
          }),
        }),
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("initial mailbox budget ignores replayed rows while admitting the fresh tail", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-replay-initial-budget-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const importedSeqs: string[] = [];
    const mailboxItems = [
      ...Array.from({ length: 100 }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_initial_replay_budget_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          payloadInlineCiphertext: null,
          payloadRef: `payload_ref_entrypoint_initial_replay_budget_${String(index + 1).padStart(3, "0")}`,
        })
      ),
      createMailboxItem({
        id: "mailbox_item_entrypoint_initial_replay_budget_251",
        laneSeq: "251",
        occurredAt: "2026-04-27T00:04:11.000Z",
      }),
    ];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "250";
    const bundle = createMailboxImportStateBundle(restoredState);

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_initial_replay_budget",
            budget: {
              maxMailboxItems: 2,
            },
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/initial-replay-budget.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
            mailboxPort: {
              ...createMailboxPort({
                consumedSeqByLane: [
                  {
                    consumedSeq: "0",
                    lane: "conversation",
                  },
                ],
                events,
                fetchRequests,
                items: mailboxItems,
              }),
              async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
                throw new Error("locally imported replay sidecar should not be fetched");
              },
            },
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "250",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/initial-replay-budget-before.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "4",
              }),
            }),
          }),
          async runAssistantPhase() {
            events.push("assistant");
            return {
              checkpointReason: "canonical_runtime_commit",
              foregroundReplyFailed: 0,
              progressed: true,
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["250"]);
      assert.deepEqual(fetchRequests.map((request) => request.limitPerLane), [3]);
      assert.deepEqual(importedSeqs, ["251"]);
      assert.ok(events.includes("import:251"));
      assert.ok(events.includes("snapshot:idle_shutdown:251"));
      assert.equal(result.status, "idle");
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "251");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "251",
      );
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "251");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes during the final idle checkpoint do not abort checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let settled = false;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wake_during_checkpoint",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wake-during.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push("workspace.checkpoint");
                checkpointRequests.push(request);
                runtimeWakeSignal.notify();
                return await checkpointResponse.promise;
              },
            },
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      ).finally(() => {
        settled = true;
      });

      await waitUntil(() => {
        assert.equal(checkpointRequests.length, 1);
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(settled, false);
      assert.equal(checkpointRequests.length, 1);

      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      await expect(resultPromise).resolves.toMatchObject({
        status: "idle",
        redactedStatus: {
          hostedMailboxConversationImportedSeq: "1",
        },
      });
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_001",
      ]);
    } finally {
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes during the final idle checkpoint drain after the checkpoint commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointWakeImportContextMilestones: unknown[] = [];
    const firstCheckpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_wake_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_pending_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-pending-${checkpointRequests.length}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item, context) {
            events.push(`mailbox.importItem:${item.item.id}`);
            if (item.item.id === "mailbox_item_entrypoint_checkpoint_wake_002") {
              checkpointWakeImportContextMilestones.push(
                structuredClone(context?.latencyMilestones ?? null),
              );
            }
            return { status: "imported" };
          },
          latencyMilestones: {
            phaseBreakdown: {
              schemaVersion: 1,
              dispatch: {
                invokeReceivedAtEpochMs: 1_777_000_000_000,
                containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
              },
              boot: { nodeStartupMs: 4321 },
            },
            runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                if (checkpointRequests.length === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_wake_002",
                    laneSeq: "2",
                  }));
                  runtimeWakeSignal.notify();
                  return await firstCheckpointResponse.promise;
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "6",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(checkpointRequests.length, 1);
      });
      firstCheckpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      const result = await resultPromise;

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_wake_001",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_wake_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
        "5",
      ]);
      assert.deepEqual(
        checkpointRequests.map((request) =>
          request.redactedStatus?.hostedMailboxConversationImportedSeq
        ),
        ["1", "2"],
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
      expect(checkpointWakeImportContextMilestones).toEqual([
        expect.objectContaining({
          phaseBreakdown: expect.objectContaining({
            schemaVersion: 1,
            dispatch: {
              invokeReceivedAtEpochMs: 1_777_000_000_000,
              containerEnsureReadyStartedAtEpochMs: 1_777_000_000_050,
            },
            boot: expect.objectContaining({
              nodeStartupMs: 4321,
              restoreWasCold: expect.any(Boolean),
            }),
            wake: expect.objectContaining({
              runtimeWakeNotifiedAtEpochMs: expect.any(Number),
              foregroundWaitResolvedAtEpochMs: expect.any(Number),
              foregroundImportStartedAtEpochMs: expect.any(Number),
            }),
          }),
          runnerJobAcceptedAt: "2026-04-27T00:00:00.100Z",
          runtimePhaseStartedAt: expect.any(String),
          workspaceRestoreDoneAt: expect.any(String),
        }),
      ]);
    } finally {
      firstCheckpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes that interrupt snapshot publication rerun the foreground pass before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_snapshot_wake_001",
        laneSeq: "1",
      }),
    ];
    let snapshotAttempt = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_snapshot_wake",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            snapshotAttempt += 1;
            events.push(`snapshot:${snapshotAttempt}:${snapshotInput.reason}`);
            if (snapshotAttempt === 1) {
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_snapshot_wake_002",
                laneSeq: "2",
              }));
              throw new HostedRuntimeCheckpointInterruptedByWakeError();
            }
            return {
              snapshotRef: createBundleRef({
                hash: `${snapshotAttempt}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-snapshot-wake-${snapshotAttempt}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events.filter((event) => event.startsWith("snapshot:")), [
        "snapshot:1:idle_shutdown",
        "snapshot:2:idle_shutdown",
      ]);
      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_snapshot_wake_001",
        "mailbox.importItem:mailbox_item_entrypoint_snapshot_wake_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
      ]);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedMailboxConversationImportedSeq,
        "2",
      );
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wakes pending after checkpoint are drained without a host checkpoint timer", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    const mailboxItems = [
      createMailboxItem({
        id: "mailbox_item_entrypoint_checkpoint_timer_001",
        laneSeq: "1",
      }),
    ];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let checkpointCallCount = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const resultPromise = runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_pending_wake_timer",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-pending-timer.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: mailboxItems,
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointCallCount += 1;
                events.push(`workspace.checkpoint:${request.expectedWorkspaceVersion}`);
                checkpointRequests.push(request);
                if (checkpointCallCount === 1) {
                  mailboxItems.push(createMailboxItem({
                    id: "mailbox_item_entrypoint_checkpoint_timer_002",
                    laneSeq: "2",
                  }));
                  runtimeWakeSignal.notify();
                  return await checkpointResponse.promise;
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    version: "6",
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          vaultRoot,
        },
      );

      await waitUntil(() => {
        assert.equal(checkpointRequests.length, 1);
      });
      await new Promise((resolve) => setTimeout(resolve, 750));
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({
          snapshotRef: checkpointRequests[0]!.snapshotRef,
          version: "5",
        }),
      });

      const result = await resultPromise;

      assert.deepEqual(fetchRequests.map(readConversationImportedSeq), ["0", "1"]);
      assert.deepEqual(events.filter((event) => event.startsWith("mailbox.importItem:")), [
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_timer_001",
        "mailbox.importItem:mailbox_item_entrypoint_checkpoint_timer_002",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.expectedWorkspaceVersion), [
        "4",
        "5",
      ]);
      assert.equal(result.redactedStatus?.hostedMailboxConversationImportedSeq, "2");
      assert.equal(result.status, "idle");
    } finally {
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "5" }),
      });
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake passes preserve earlier projected checkpoint metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_accumulate_projection",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-accumulated.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {};
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, assistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        assistantWakeAt,
      );
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantProgressed,
        true,
      );
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, assistantWakeAt);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake no-progress hints do not replace earlier dirty wake metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const earlierWakeAt = "2099-04-27T00:01:00.000Z";
    const laterWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_no_progress_hint",
            idleCheckpointDelayMs: 25,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-no-progress-hint.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: earlierWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: earlierWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              nextWakeAt: laterWakeAt,
              progressed: false,
              redactedStatus: {
                hostedAssistantNextWakeAt: laterWakeAt,
                hostedAssistantProgressed: false,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, earlierWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.status, "scheduled");
      assert.equal(result.nextWakeAt, earlierWakeAt);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("checkpoint wake pass can clear previously checkpointed wake metadata", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_clear_projection",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: `${checkpointRequests.length}`.repeat(64).slice(0, 64),
                key: `users/bundles/member-synthetic/runtime-idle-checkpoint-clear-${checkpointRequests.length}.bundle.json`,
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: {
              async read() {
                events.push("workspace.read");
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                checkpointRequests.push(request);
                events.push(`workspace.checkpoint:${checkpointRequests.length}`);
                if (checkpointRequests.length === 1) {
                  runtimeWakeSignal.notify();
                }
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    nextWakeAt: request.nextWakeAt ?? null,
                    nextWakeReason: request.nextWakeReason ?? null,
                    redactedStatus: request.redactedStatus ?? null,
                    snapshotRef: request.snapshotRef,
                    version: `${4 + checkpointRequests.length}`,
                  }),
                };
              },
            },
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: null,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
      assert.equal(checkpointRequests.length, 2);
      assert.equal(checkpointRequests[0]?.nextWakeAt, assistantWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(checkpointRequests[1]?.nextWakeAt, null);
      assert.equal(checkpointRequests[1]?.nextWakeReason, null);
      assert.equal(
        checkpointRequests[1]?.redactedStatus?.hostedAssistantNextWakeAt,
        null,
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedAssistantNextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runtime wake pass can clear projected wake metadata before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const assistantWakeAt = "2099-04-27T00:05:00.000Z";
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_idle_timer_clear",
            idleCheckpointDelayMs: 10_000,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-idle-timer-clear.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem(item) {
            events.push(`mailbox.importItem:${item.item.id}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              setTimeout(() => runtimeWakeSignal.notify(), 10);
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: assistantWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: assistantWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }

            await new Promise((resolve) => setTimeout(resolve, 150));
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: null,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: null,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 2);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(
        checkpointRequests[0]?.redactedStatus?.hostedAssistantNextWakeAt,
        null,
      );
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedAssistantNextWakeAt, null);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("dirty runtime checkpoints after the idle delay", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_timer",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-timer.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.equal(checkpointRequests.length, 1);
      assert.ok(elapsedMs >= 200);
      assert.ok(elapsedMs < 2_000);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("due projected runtime wake runs a hot pass without forcing an early idle checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const idleCheckpointDelayMs = 250;
    const projectedWakeAt = new Date(Date.now()).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_projected_wake",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-projected-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls > 1) {
              return {
                checkpointReason: "provider_cleanup",
                nextWakeAt: null,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: null,
                  hostedAssistantProgressed: true,
                },
              };
            }

            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: projectedWakeAt,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: projectedWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.ok(elapsedMs >= idleCheckpointDelayMs - 50);
      assert.ok(elapsedMs < 2_000);
      assert.equal(assistantPhaseCalls, 2);
      const secondAssistantPhaseIndex = events.indexOf("assistant.phase:2");
      const snapshotIndex = events.findIndex((event) => event === "snapshot:idle_shutdown");
      assert.ok(secondAssistantPhaseIndex >= 0);
      assert.ok(snapshotIndex > secondAssistantPhaseIndex);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("external runtime wake preserves already-serviced projected wake guard", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    const idleCheckpointDelayMs = 75;
    const projectedWakeAt = new Date(Date.now()).toISOString();
    let assistantPhaseCalls = 0;

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_external_after_projected",
            idleCheckpointDelayMs,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-external-after-projected.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          runtimeWakeSignal,
          async runAssistantPhase() {
            assistantPhaseCalls += 1;
            events.push(`assistant.phase:${assistantPhaseCalls}`);
            if (assistantPhaseCalls === 1) {
              return {
                checkpointReason: "assistant_runtime_commit",
                nextWakeAt: projectedWakeAt,
                progressed: true,
                redactedStatus: {
                  hostedAssistantNextWakeAt: projectedWakeAt,
                  hostedAssistantProgressed: true,
                },
              };
            }
            if (assistantPhaseCalls === 2) {
              setTimeout(() => runtimeWakeSignal.notify(), 0);
            }

            return {};
          },
          vaultRoot,
        },
      );

      assert.equal(assistantPhaseCalls, 3);
      assert.deepEqual(events.filter((event) => event.startsWith("assistant.phase:")), [
        "assistant.phase:1",
        "assistant.phase:2",
        "assistant.phase:3",
      ]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("idle checkpoint can run before a later projected wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const projectedWakeAt = new Date(Date.now() + 120_000).toISOString();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_timer_before_projected_wake",
            idleCheckpointDelayMs: 250,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-timer-before-wake.bundle.json",
                size: 640,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "4" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              checkpointReason: "assistant_runtime_commit",
              nextWakeAt: projectedWakeAt,
              progressed: true,
              redactedStatus: {
                hostedAssistantNextWakeAt: projectedWakeAt,
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      const elapsedMs = performance.now() - startedAt;
      assert.ok(elapsedMs >= 200);
      assert.ok(elapsedMs < 2_000);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.nextWakeAt, projectedWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "assistant");
      assert.equal(result.nextWakeAt, projectedWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when the runtime-owned idle checkpoint returns another user's workspace", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-runtime-idle-checkpoint-"));
    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await expect(runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_runtime_idle_checkpoint_wrong_user",
            idleCheckpointDelayMs: 1,
            leaseGeneration: "9",
            userId: TEST_USER_ID,
            workspaceVersion: "4",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/runtime-idle-checkpoint-wrong-user.bundle.json",
                size: 256,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events: [],
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: {
              async read() {
                return {
                  fetchedAt: TEST_NOW,
                  workspace: createWorkspaceState({ version: "4" }),
                };
              },
              async checkpoint(request) {
                return {
                  checkpointed: true,
                  workspace: createWorkspaceState({
                    snapshotRef: request.snapshotRef,
                    userId: "member_synthetic_other",
                    version: "5",
                  }),
                };
              },
            },
          }),
          vaultRoot,
        },
      )).rejects.toThrow(
        "Hosted mailbox import checkpoint returned an unexpected user.",
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("runs assistant outbox phase after restored mailbox checkpoint with restored vault root", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
          return {
            snapshotRef: createBundleRef({
              hash: snapshotInput.reason === "import" ? "1".repeat(64) : "2".repeat(64),
              key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
              size: 512,
            }),
          };
        },
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_assistant_phase",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: null,
          }),
        }),
        async runAssistantPhase(input) {
          assert.equal(input.restored.vaultRoot, path.resolve(vaultRoot));
          assert.equal(
            (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
            "1",
          );
          events.push("assistant");
          return {
            checkpointReason: "outbox_sending",
            progressed: true,
            redactedStatus: {
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
        "snapshot:idle_shutdown:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("defers alarm mailbox import when an active alarm absorbs pending conversation work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: snapshotInput.reason === "import" ? "3".repeat(64) : "4".repeat(64),
                key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
                size: 512,
              }),
            };
          },
          async importItem(item) {
            events.push(`import:${item.item.laneSeq}`);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_alarm_absorbed_pending_work",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: TEST_NOW,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          async runAssistantPhase() {
            assert.equal(
              (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
              "1",
            );
            events.push("assistant");
            return {
              checkpointReason: "outbox_sending",
              progressed: true,
              redactedStatus: {
                hostedAssistantProgressed: true,
              },
            };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:1",
        "assistant",
        "snapshot:idle_shutdown:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps exact hosted canonical writes local until the idle workspace checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactPutCalls: Array<{ byteLength: number; sha256: string }> = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const artifactLabelsByHash = new Map<string, string>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactLabelsByHash,
        artifactPutCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({ version: "0" }),
        }),
      });

      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
          const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
          artifactLabelsByHash.set(hotHash, "canonical-hot-state");
          artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
          return {
            snapshotRef: createBundleRef({
              hash: hotHash,
              key: "users/bundles/member-synthetic/canonical-hot.bundle.json",
              size: hotSnapshot.bundle.byteLength,
            }),
          };
        },
        async importItem() {
          throw new Error("Mailbox import should not run without mailbox items.");
        },
        platform,
        async runAssistantPhase(input) {
          await runCanonicalWrite({
            vaultRoot: input.restored.vaultRoot,
            operationType: "hosted_canonical_write_test",
            summary: "Persist hosted canonical write receipt.",
            occurredAt: TEST_NOW,
            mutate: async ({ batch }) => {
              await batch.stageTextWrite("journal/2026-04-27.md", "exact hosted note\n");
            },
          });
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.equal(artifactPutCalls.length, 0);
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "2026-04-27.md"), "utf8"),
        "exact hosted note\n",
      );
      const receiptRoot = path.join(
        resolveAssistantStatePaths(vaultRoot).assistantStateRoot,
        "receipts",
        "canonical-writes",
      );
      await assert.rejects(readdir(receiptRoot));
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not run assistant outbox phase when mailbox import fails before checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    let assistantPhaseCalled = false;

    try {
      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run after failed mailbox import.");
          },
          async importItem() {
            events.push("import");
            throw new Error("Synthetic mailbox import failure.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_import_failure",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: null,
            }),
          }),
          async runAssistantPhase() {
            assistantPhaseCalled = true;
            return {
              checkpointReason: "canonical_runtime_commit",
              progressed: true,
            };
          },
          vaultRoot,
        }),
      ).rejects.toThrow(/Synthetic mailbox import failure/u);

      assert.equal(assistantPhaseCalled, false);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when required workspace-invocation ports are absent", async () => {
    const input = {
      request: createWorkspaceRunRequest(),
    };
    const vaultRoot = "synthetic-vault-root";
    const importItem = async () => {
      throw new Error("Import should not run without required ports.");
    };
    const createCheckpointSnapshot = async () => ({
      snapshotRef: null,
    });
    let livenessTouches = 0;
    const runtimeLivenessPort: RuntimeLivenessPort = {
      async touch() {
        livenessTouches += 1;
        return continueRuntimeLiveness();
      },
    };

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: null,
          runtimeLivenessPort,
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events: [],
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/mailbox port must be injected/u);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          runtimeLivenessPort,
          workspacePort: null,
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/workspace port must be injected/u);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess(input, {
        createCheckpointSnapshot,
        importItem,
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events: [], items: [] }),
          runtimeLivenessPort,
          workspacePort: {
            async checkpoint(): Promise<HostedWorkspaceCheckpointResponse> {
              throw new Error("Checkpoint should not run without workspace read.");
            },
          },
        }),
        vaultRoot,
      }),
    ).rejects.toThrow(/workspace port must support read/u);
    assert.equal(livenessTouches, 0);
  });

  test("dirty foreground turns fail closed when the idle checkpoint request cannot be built", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async () => {
      throw new Error("Foreground test should not build checkpoint snapshots.");
    });
    const createRequest = vi.fn(() => {
      throw new Error("Foreground test should not build checkpoint requests.");
    });
    const restoreBuilder =
      mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.getMockImplementation();
    const restorePortableSnapshot =
      mocks.snapshotHostedPortableWorkspaceDelta.getMockImplementation();
    mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockClear();
    mocks.snapshotHostedPortableWorkspaceDelta.mockClear();
    mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(() => {
      return { createRequest };
    });
    mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(() => {
      throw new Error("Foreground test should not snapshot portable workspace deltas.");
    });
    const checkpointStarted = createDeferred<void>();
    const checkpointResponse = createDeferred<HostedWorkspaceCheckpointResponse>();
    let resultPromise: ReturnType<typeof runHostedWorkspaceRuntimeJobInProcess> | null = null;

    const workspacePort = {
      async read(): Promise<HostedWorkspaceReadResponse> {
        events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: createWorkspaceState({ version: "0" }),
        };
      },
      async checkpoint(request: HostedWorkspaceCheckpointRequest): Promise<HostedWorkspaceCheckpointResponse> {
        events.push("workspace.checkpoint");
        checkpointRequests.push(request);
        checkpointStarted.resolve();
        return await checkpointResponse.promise;
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      resultPromise = runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem() {
          throw new Error("Import should not run without mailbox items.");
        },
        platform: createPlatform({
          events,
          mailboxPort: createMailboxPort({ events, items: [] }),
          logRequests,
          workspacePort,
        }),
        async runAssistantPhase(input) {
          events.push("assistant.phase");
          assert.equal("checkpointActiveTurnInput" in input.platform, false);
          assert.equal("refreshMailboxForActiveTurnInput" in input.platform, false);
          return {
            checkpointReason: "assistant_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      await expect(resultPromise).rejects.toThrow(
        "Foreground test should not build checkpoint requests.",
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "runtime.log:mailbox.imported",
        "mailbox.fetch",
        "runtime.log:mailbox.imported",
        "assistant.phase",
        "runtime.log:checkpoint.runtime_residue_deferred",
        "runtime.log:mailbox.consume_ack_skipped",
      ]);
      assert.deepEqual(checkpointRequests, []);
      const deferredLogs = logRequests.flatMap((request) => request.entries)
        .filter((entry) => entry.eventCode === "checkpoint.runtime_residue_deferred");
      assert.deepEqual(deferredLogs.map((entry) => entry.redactedJson), [
        {
          checkpointPhase: "assistant",
          checkpointReason: "assistant_runtime_commit",
        },
      ]);
      expect(mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder).toHaveBeenCalled();
      expect(createRequest).toHaveBeenCalledOnce();
      expect(mocks.snapshotHostedPortableWorkspaceDelta).not.toHaveBeenCalled();
      expect(createCheckpointSnapshot).not.toHaveBeenCalled();
    } finally {
      if (restoreBuilder) {
        mocks.createHostedWorkspaceSnapshotCheckpointRequestBuilder.mockImplementation(
          restoreBuilder,
        );
      }
      if (restorePortableSnapshot) {
        mocks.snapshotHostedPortableWorkspaceDelta.mockImplementation(
          restorePortableSnapshot,
        );
      }
      checkpointResponse.resolve({
        checkpointed: true,
        workspace: createWorkspaceState({ version: "1" }),
      });
      if (resultPromise) {
        await Promise.race([
          resultPromise.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 10)),
        ]);
      }
      await removeTempRoot(vaultRoot);
    }
  });

  test("normal foreground turns fail closed on every checkpoint-capable runtime surface", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const checkpointRequest: HostedWorkspaceCheckpointRequest = {
      attemptId: "attempt_foreground_tripwire",
      expectedWorkspaceVersion: "0",
      leaseGeneration: "1",
      nextWakeAt: null,
      nextWakeReason: null,
      reason: "assistant_runtime_commit",
      redactedStatus: null,
      snapshotRef: null,
    };
    const activationBootstrapCheckpointRequest: HostedWorkspaceCheckpointRequest = {
      ...checkpointRequest,
      reason: "activation_bootstrap",
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      await expect(
        runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
          async createCheckpointSnapshot() {
            throw new Error("Foreground test should not build checkpoint snapshots.");
          },
          async importItem() {
            throw new Error("Import should not run without mailbox items.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase(input) {
            await assert.rejects(
              () => input.platform.workspacePort!.checkpoint(checkpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.runtime.platform.workspacePort!.checkpoint(checkpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.platform.workspacePort!.checkpoint(activationBootstrapCheckpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            await assert.rejects(
              () => input.runtime.platform.workspacePort!.checkpoint(activationBootstrapCheckpointRequest),
              /Foreground hosted runner must not checkpoint workspace/u,
            );
            return {};
          },
          vaultRoot,
        }),
      ).resolves.toMatchObject({
        status: "idle",
      });

      assert.deepEqual(checkpointRequests, []);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground member activation defers bootstrap checkpointing to idle shutdown", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async (snapshotInput) => {
      events.push(`snapshot:${snapshotInput.reason}`);
      assert.equal(snapshotInput.reason, "idle_shutdown");
      return {
        snapshotRef: createBundleRef({
          hash: "b".repeat(64),
          key: "users/bundles/member-synthetic/activation-bootstrap.bundle.json",
          size: 512,
        }),
      };
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem(item) {
          events.push(`import:${item.item.lane}:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          events,
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_activation",
                kind: "member.activated",
                lane: "system",
                laneSeq: "1",
              }),
            ],
          }),
          logRequests,
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        async runAssistantPhase() {
          events.push("assistant.phase");
          return {
            checkpointReason: "activation_bootstrap",
            progressed: true,
            redactedStatus: {
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.status, "idle");
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      expect(createCheckpointSnapshot).toHaveBeenCalledOnce();
      expect(events).toContain("workspace.checkpoint");
      expect(events).not.toContain("snapshot:activation_bootstrap");
      const assistantDeferredLogs = logRequests.flatMap((request) => request.entries)
        .filter((entry) =>
          entry.eventCode === "checkpoint.runtime_residue_deferred"
          && entry.redactedJson?.checkpointPhase === "assistant"
        );
      assert.deepEqual(assistantDeferredLogs.map((entry) => entry.redactedJson), [
        {
          checkpointPhase: "assistant",
          checkpointReason: "activation_bootstrap",
        },
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground runtime wake import waits until idle before checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const createCheckpointSnapshot = vi.fn(async (snapshotInput) => {
      events.push(`snapshot:${snapshotInput.reason}`);
      assert.equal(snapshotInput.reason, "idle_shutdown");
      return {
        snapshotRef: createBundleRef({
          hash: "5".repeat(64),
          key: "users/bundles/member-synthetic/foreground-runtime-wake.bundle.json",
          size: 512,
        }),
      };
    });
    let fetchCount = 0;
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();

    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        const lateItem = createMailboxItem({
          id: "mailbox_item_entrypoint_late_active_turn",
          laneSeq: "1",
        });
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 ? [] : [lateItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount === 1 ? lane.importedSeq : "1",
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(
        request: HostedMailboxPayloadFetchRequest,
      ): Promise<HostedMailboxPayloadFetchResponse> {
        return {
          fetchedAt: TEST_NOW,
          payload: {
            createdAt: TEST_NOW,
            mailboxItemId: request.mailboxItemId,
            payloadCiphertext: "ciphertext_synthetic_sidecar",
            payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
            userId: TEST_USER_ID,
          },
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        createCheckpointSnapshot,
        async importItem(item) {
          events.push(`import:${item.item.laneSeq}`);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          runtimeWakeSignal.notify();
          await waitUntil(() => {
            assert.equal(events.includes("import:1"), true);
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "0",
              hostedMailboxSystemImportedSeq: "999",
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.status, "idle");
      assert.ok(result.redactedStatus);
      assert.equal(result.redactedStatus["hostedMailboxConversationImportedSeq"], "1");
      assert.equal(result.redactedStatus["hostedMailboxSystemImportedSeq"], "0");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch:1",
        "mailbox.fetch:2",
        "mailbox.fetch:3",
        "import:1",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      expect(createCheckpointSnapshot).toHaveBeenCalledOnce();
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("foreground runtime wake retryable blocks schedule the next mailbox wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const runtimeWakeSignal = createCoalescingRuntimeWakeSignal();
    let fetchCount = 0;
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_entrypoint_late_sidecar_retry",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_entrypoint_late_sidecar_retry",
    });

    const mailboxPort: HostedRuntimeMailboxPort = {
      async fetch(request): Promise<HostedMailboxFetchResponse> {
        fetchCount += 1;
        events.push(`mailbox.fetch:${fetchCount}`);
        return {
          fetchedAt: TEST_NOW,
          items: fetchCount === 1 ? [] : [sidecarItem],
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: fetchCount === 1 ? lane.importedSeq : "1",
          })),
          userId: TEST_USER_ID,
        };
      },
      async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
        events.push("mailbox.fetchPayload");
        return {
          fetchedAt: TEST_NOW,
          payload: null,
          unavailable: {
            code: "not_found",
            retryable: true,
          },
        };
      },
    };

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(`snapshot:${snapshotInput.reason}`);
          assert.equal(snapshotInput.reason, "idle_shutdown");
          return {
            snapshotRef: createBundleRef({
              hash: "6".repeat(64),
              key: "users/bundles/member-synthetic/foreground-runtime-wake-retry.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          throw new Error("Retryable sidecar block must not import the item.");
        },
        platform: createPlatform({
          mailboxPort,
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        runtimeWakeSignal,
        async runAssistantPhase() {
          runtimeWakeSignal.notify();
          await waitUntil(() => {
            assert.equal(events.includes("mailbox.fetchPayload"), true);
          });
          return {
            checkpointReason: "canonical_runtime_commit",
            progressed: true,
          };
        },
        vaultRoot,
      });

      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch:1",
        "mailbox.fetch:2",
        "mailbox.fetch:3",
        "mailbox.fetchPayload",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed when workspace read returns a stale version before mailbox fetch", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          workspaceVersion: "5",
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after stale workspace read.");
        },
        async importItem() {
          throw new Error("Import should not run after stale workspace read.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "6" }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toBeInstanceOf(HostedWorkspaceRuntimeJobWorkspaceVersionMismatchError);
    assert.deepEqual(events, ["workspace.read"]);
  });

  test("fails closed before snapshot restore when workspace read returns another user", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest(),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run after workspace user mismatch.");
        },
        async importItem() {
          throw new Error("Import should not run after workspace user mismatch.");
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: "c".repeat(64),
                key: "users/bundles/member-synthetic/other-user.bundle.json",
                size: 512,
              }),
              userId: "member_synthetic_workspace_other",
              version: "0",
            }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toBeInstanceOf(HostedWorkspaceRunnerUserMismatchError);

    assert.deepEqual(events, ["workspace.read"]);
    assert.deepEqual(artifactGetCalls, []);
  });

  test("restores existing workspace snapshot before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceVaultRoot });
    await mkdir(path.join(sourceVaultRoot, "raw"), { recursive: true });
    const rawArtifactBytes = Buffer.from("synthetic artifact", "utf8");
    const rawArtifactHash = sha256HostedBundleHex(rawArtifactBytes);
    await writeFile(path.join(sourceVaultRoot, "raw", "artifact.txt"), rawArtifactBytes);
    const sourceBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        if (file.path !== "raw/artifact.txt") {
          return null;
        }

        return {
          byteSize: file.bytes.byteLength,
          sha256: sha256HostedBundleHex(file.bytes),
        };
      },
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    const bundle = writeHostedBundleTextFile({
      bytes: sourceBundle,
      kind: "vault",
      path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
      root: "vault",
      text: JSON.stringify({
        schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
        schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
        value: restoredState,
      }),
    });
    const bundleHash = sha256HostedBundleHex(bundle);
    const artifactBytesByHash = new Map([
      [bundleHash, bundle],
      [rawArtifactHash, rawArtifactBytes],
    ]);
    const imported: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });
      await ensureHostedInboxSidecarReady({
        bestEffort: false,
        rebuild: false,
        requestId: "request_mark_sidecar_ready_before_cold_restore",
        vaultRoot,
      });
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        assert.equal(input.rebuild, true);
        assert.equal(input.requestId, "hosted-workspace-invocation:attempt_synthetic_workspace_run");
        assert.equal(input.vaultRoot, path.resolve(vaultRoot));
        return await ensureHostedInboxSidecarReadyImpl(input);
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "d".repeat(64),
                key: "users/bundles/member-synthetic/restored-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_old",
                  laneSeq: "3",
                }),
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_new",
                  laneSeq: "4",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "0",
                  hostedMailboxSystemImportedSeq: "0",
                },
                snapshotRef: createBundleRef({
                  hash: bundleHash,
                  key: "users/bundles/member-synthetic/restored-before-import.bundle.json",
                  size: bundle.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        });

      assert.deepEqual(artifactGetCalls, [bundleHash]);
      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.deepEqual(fetchRequests[0]?.lanes, [
        { importedSeq: "3", lane: "conversation" },
      ]);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "sidecar.ready",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("restores working snapshots without bootstrap checkpoint before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceCurrentVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-current-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];

    try {
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      const baseState = createEmptyHostedMailboxImportState();
      baseState.watermarks.conversation = "2";
      await writeMailboxImportStateFile(sourceBaseVaultRoot, baseState);
      const baseSourceBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseSourceBundle);
      const baseBundle = baseSourceBundle;
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseManifest = createHostedPortableWorkspaceManifestFromBundle(baseBundle);

      await writeFile(path.join(sourceCurrentVaultRoot, "note.md"), "current note\n", "utf8");
      const currentState = createEmptyHostedMailboxImportState();
      currentState.watermarks.conversation = "3";
      await writeMailboxImportStateFile(sourceCurrentVaultRoot, currentState);
      const delta = await snapshotHostedPortableWorkspaceDelta({
        baseManifest,
        baseSnapshotHash: baseHash,
        vaultRoot: sourceCurrentVaultRoot,
      });
      assert.equal(delta.kind, "changed");
      const deltaHash = sha256HostedBundleHex(delta.bundle);
      const artifactBytesByHash = new Map([
        [baseHash, baseBundle],
        [deltaHash, delta.bundle],
      ]);

      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [
            createMailboxItem({
              id: "mailbox_item_entrypoint_legacy_current",
              laneSeq: "3",
            }),
            createMailboxItem({
              id: "mailbox_item_entrypoint_legacy_next",
              laneSeq: "4",
            }),
          ],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "3",
            },
            snapshotRef: buildHostedExecutionWorkingSnapshotRef({
              base: createBundleRef({
                hash: baseHash,
                key: "users/bundles/member-synthetic/base.bundle.json",
                size: baseBundle.byteLength,
              }),
              delta: createBundleRef({
                hash: deltaHash,
                key: "users/bundles/member-synthetic/delta.bundle.json",
                size: delta.bundle.byteLength,
              }),
            }),
            version: "9",
          }),
        }),
      });
      const runOnce = async (attempt: number) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_working_snapshot_restore_${attempt}`,
              workspaceVersion: "9",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(
                `snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`,
              );
              return {
                snapshotRef: createBundleRef({
                  hash: snapshotInput.reason === "activation_bootstrap"
                    ? "b".repeat(64)
                    : "c".repeat(64),
                  key: `users/bundles/member-synthetic/${snapshotInput.reason}.bundle.json`,
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.laneSeq);
              events.push(`import:${item.item.laneSeq}`);
              return { status: "imported" };
            },
            platform,
            async runAssistantPhase() {
              events.push("assistant");
              return { progressed: false };
            },
            vaultRoot,
          },
        );

      await runOnce(1);

      assert.deepEqual(artifactGetCalls, [baseHash, baseHash, deltaHash]);
      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:4",
        "assistant",
        "snapshot:idle_shutdown:4",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => [
        request.reason,
        request.expectedWorkspaceVersion,
      ]), [
        ["idle_shutdown", "9"],
      ]);
      assert.equal(
        await readFile(path.join(vaultRoot, "note.md"), "utf8"),
        "current note\n",
      );
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");

      artifactGetCalls.length = 0;
      events.length = 0;
      await runOnce(2);

      assert.deepEqual(
        artifactGetCalls,
        artifactGetCalls.length === 0 ? [] : [baseHash, baseHash, deltaHash],
      );
      assert.deepEqual(imported, ["4", "4"]);
      assert.equal(fetchRequests.length, 2);
      assert.equal(readConversationImportedSeq(fetchRequests[1]), "3");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import:4",
        "assistant",
        "snapshot:idle_shutdown:4",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
        "idle_shutdown",
      ]);
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceCurrentVaultRoot);
    }
  });

  test("fetches mailbox rows from the authoritative restored watermark", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    const bundle = createMailboxImportStateBundle(restoredState);
    const imported: string[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/prefetch-reused-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
            mailboxPort: createMailboxPort({
              events,
              fetchRequests,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_prefetch_old",
                  laneSeq: "3",
                }),
                createMailboxItem({
                  id: "mailbox_item_entrypoint_prefetch_new",
                  laneSeq: "4",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedMailboxConversationImportedSeq: "3",
                  hostedMailboxSystemImportedSeq: "0",
                },
                snapshotRef: createBundleRef({
                  hash: bundle.hash,
                  key: "users/bundles/member-synthetic/prefetch-reused-before-import.bundle.json",
                  size: bundle.bytes.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not let a stale pre-restore mailbox read hide a conversation item appended during restore", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const restoredState = createEmptyHostedMailboxImportState();
    restoredState.watermarks.conversation = "3";
    const bundle = createMailboxImportStateBundle(restoredState);
    const mailboxItems: HostedMailboxItem[] = [];
    const imported: string[] = [];
    const artifactLabelsByHash = new Map([[bundle.hash, "workspace-bundle"]]);

    try {
      const platform = createPlatform({
        artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
        artifactLabelsByHash,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: mailboxItems,
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace: createWorkspaceState({
            redactedStatus: {
              hostedMailboxConversationImportedSeq: "3",
              hostedMailboxSystemImportedSeq: "0",
            },
            snapshotRef: createBundleRef({
              hash: bundle.hash,
              key: "users/bundles/member-synthetic/prefetch-stale-before-import.bundle.json",
              size: bundle.bytes.byteLength,
            }),
            version: "9",
          }),
        }),
      });
      const platformWithAppendDuringRestore: HostedRuntimePlatform = {
        ...platform,
        artifactStore: {
          ...platform.artifactStore,
          async get(sha256) {
            const bytes = await platform.artifactStore.get(sha256);
            if (sha256 === bundle.hash && mailboxItems.length === 0) {
              events.push("artifact.get:workspace-bundle");
              mailboxItems.push(createMailboxItem({
                id: "mailbox_item_entrypoint_prefetch_stale_new",
                laneSeq: "4",
              }));
            }
            return bytes;
          },
        },
      };

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/prefetch-stale-after-import.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform: platformWithAppendDuringRestore,
          vaultRoot,
        },
      );

      assert.deepEqual(imported, ["4"]);
      assert.equal(fetchRequests.length, 1);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
      assert.equal((await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation, "4");
      assert.deepEqual(events, [
        "workspace.read",
        "artifact.get:workspace-bundle",
        "mailbox.fetch",
        "snapshot:4",
        "workspace.checkpoint",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("falls back to restored mailbox state for incomplete or malformed existing-workspace hints", async () => {
    const redactedStatuses: Array<HostedWorkspaceState["redactedStatus"]> = [
      null,
      {
        hostedMailboxConversationImportedSeq: "3",
      },
      {
        hostedMailboxConversationImportedSeq: "not-a-seq",
        hostedMailboxSystemImportedSeq: "0",
      },
    ];
    for (const redactedStatus of redactedStatuses) {
      const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
      const events: string[] = [];
      const fetchRequests: HostedMailboxFetchRequest[] = [];
      const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const restoredState = createEmptyHostedMailboxImportState();
      restoredState.watermarks.conversation = "3";
      const bundle = createMailboxImportStateBundle(restoredState);
      const imported: string[] = [];

      try {
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              workspaceVersion: "9",
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              return {
                snapshotRef: createBundleRef({
                  hash: "f".repeat(64),
                  key: "users/bundles/member-synthetic/malformed-prefetch-after-import.bundle.json",
                  size: 512,
                }),
              };
            },
            async importItem(item) {
              imported.push(item.item.laneSeq);
              return { status: "imported" };
            },
            platform: createPlatform({
              artifactBytesByHash: new Map([[bundle.hash, bundle.bytes]]),
              mailboxPort: createMailboxPort({
                events,
                fetchRequests,
                items: [
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_malformed_old",
                    laneSeq: "3",
                  }),
                  createMailboxItem({
                    id: "mailbox_item_entrypoint_malformed_new",
                    laneSeq: "4",
                  }),
                ],
              }),
              workspacePort: createWorkspacePort({
                checkpointRequests,
                events,
                workspace: createWorkspaceState({
                  redactedStatus,
                  snapshotRef: createBundleRef({
                    hash: bundle.hash,
                    key: "users/bundles/member-synthetic/malformed-prefetch-before-import.bundle.json",
                    size: bundle.bytes.byteLength,
                  }),
                  version: "9",
                }),
              }),
            }),
            vaultRoot,
          },
        );

        assert.deepEqual(imported, ["4"]);
        assert.equal(fetchRequests.length, 1);
        assert.equal(readConversationImportedSeq(fetchRequests[0]), "3");
        assert.deepEqual(events, [
          "workspace.read",
          "mailbox.fetch",
          "snapshot:4",
          "workspace.checkpoint",
        ]);
      } finally {
        await removeTempRoot(vaultRoot);
      }
    }
  });

  test("restores base snapshots and authoritative latest hot state before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const baseAssistantRoot = resolveAssistantStatePaths(sourceBaseVaultRoot).assistantStateRoot;
      await mkdir(path.join(baseAssistantRoot, "outbox"), { recursive: true });
      await writeFile(path.join(sourceBaseVaultRoot, "note.md"), "base note\n", "utf8");
      await writeFile(
        path.join(baseAssistantRoot, "outbox", "intent-old.json"),
        "{\"intent\":\"old\"}\n",
        "utf8",
      );
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-latest.json"),
        "{\"session\":\"latest\"}\n",
        "utf8",
      );
      const exactPayload = Buffer.from("restored exact hosted note\n", "utf8");
      const exactPayloadHash = sha256Hex(exactPayload);
      const receiptBytes = Buffer.from(`${JSON.stringify({
        actions: [
          {
            byteLength: exactPayload.byteLength,
            contentRef: {
              byteSize: exactPayload.byteLength,
              sha256: exactPayloadHash,
            },
            effect: "create",
            kind: "text_upsert",
            sha256: exactPayloadHash,
            targetRelativePath: "journal/2026-04-28.md",
          },
        ],
        committedAt: TEST_NOW,
        createdAt: TEST_NOW,
        occurredAt: TEST_NOW,
        operationId: "op_synthetic_canonical_restore",
        operationType: "hosted_canonical_write_test",
        schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
        summary: "Restore hosted canonical write receipt.",
        updatedAt: TEST_NOW,
      }, null, 2)}\n`, "utf8");
      const receiptHash = sha256Hex(receiptBytes);
      const receiptLogBytes = Buffer.from(`${JSON.stringify({
        entries: [
          {
            byteSize: receiptBytes.byteLength,
            sha256: receiptHash,
          },
        ],
        schema: "murph.hosted-canonical-write-receipt-log.v1",
      }, null, 2)}\n`, "utf8");
      const receiptLogHash = sha256Hex(receiptLogBytes);
      const forgedLocalReceiptRoot = path.join(hotAssistantRoot, "receipts", "canonical-writes");
      const forgedLocalPayload = Buffer.from("forged local receipt\n", "utf8");
      const forgedLocalPayloadHash = sha256Hex(forgedLocalPayload);
      await mkdir(path.join(forgedLocalReceiptRoot, "payloads"), { recursive: true });
      await writeFile(
        path.join(forgedLocalReceiptRoot, "payloads", `${forgedLocalPayloadHash}.bin`),
        forgedLocalPayload,
      );
      await writeFile(
        path.join(forgedLocalReceiptRoot, "op_forged_local_restore.json"),
        `${JSON.stringify({
          actions: [
            {
              byteLength: forgedLocalPayload.byteLength,
              contentRef: {
                byteSize: forgedLocalPayload.byteLength,
                sha256: forgedLocalPayloadHash,
              },
              effect: "create",
              kind: "text_upsert",
              sha256: forgedLocalPayloadHash,
              targetRelativePath: "journal/forged-local.md",
            },
          ],
          committedAt: TEST_NOW,
          createdAt: TEST_NOW,
          occurredAt: TEST_NOW,
          operationId: "op_forged_local_restore",
          operationType: "hosted_canonical_write_test",
          schema: HOSTED_CANONICAL_WRITE_RECEIPT_SCHEMA_VERSION,
          summary: "Forged local receipt.",
          updatedAt: TEST_NOW,
        }, null, 2)}\n`,
        "utf8",
      );
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const artifactBytesByHash = new Map([
        [baseHash, baseBundle],
        [hotHash, hotSnapshot.bundle],
        [exactPayloadHash, exactPayload],
        [receiptHash, receiptBytes],
        [receiptLogHash, receiptLogBytes],
      ]);

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Snapshot should not run while validating restore.");
          },
          async importItem() {
            throw new Error("Mailbox import should not run without mailbox items.");
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                redactedStatus: {
                  hostedCanonicalWriteReceiptLogByteSize: receiptLogBytes.byteLength,
                  hostedCanonicalWriteReceiptLogEntryCount: 1,
                  hostedCanonicalWriteReceiptLogSha256: receiptLogHash,
                },
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: createBundleRef({
                    hash: baseHash,
                    key: "users/bundles/member-synthetic/base.bundle.json",
                    size: baseBundle.byteLength,
                  }),
                  hot: createBundleRef({
                    hash: hotHash,
                    key: "users/bundles/member-synthetic/hot.bundle.json",
                    size: hotSnapshot.bundle.byteLength,
                  }),
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(artifactGetCalls, [baseHash, hotHash, receiptLogHash, receiptHash, exactPayloadHash]);
      assert.equal(await readFile(path.join(vaultRoot, "note.md"), "utf8"), "base note\n");
      assert.equal(
        await readFile(path.join(vaultRoot, "journal", "2026-04-28.md"), "utf8"),
        "restored exact hosted note\n",
      );
      await assert.rejects(readFile(path.join(vaultRoot, "journal", "forged-local.md"), "utf8"));
      await assert.rejects(
        readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent-old.json"), "utf8"),
      );
      assert.equal(
        await readFile(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session-latest.json"), "utf8"),
        "{\"session\":\"latest\"}\n",
      );
      assert.deepEqual(checkpointRequests, []);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("cold-restores legacy snapshots after no-progress alarms", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/no-progress-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      const hotAssistantRoot = resolveAssistantStatePaths(sourceHotVaultRoot).assistantStateRoot;
      await mkdir(path.join(hotAssistantRoot, "sessions"), { recursive: true });
      await writeFile(
        path.join(hotAssistantRoot, "sessions", "session-initial.json"),
        "{\"session\":\"initial\"}\n",
        "utf8",
      );
      const initialHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const initialHotHash = sha256HostedBundleHex(initialHotSnapshot.bundle);
      const initialHotRef = createBundleRef({
        hash: initialHotHash,
        key: "users/bundles/member-synthetic/no-progress-hot-initial.bundle.json",
        size: initialHotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(initialHotHash, initialHotSnapshot.bundle);

      let currentWorkspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: initialHotRef,
        }),
        version: "9",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(currentWorkspace.version) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          items: [],
        }),
        workspacePort,
      });
      let firstRun = true;
      const runOnce = async () =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_no_progress_cache_${checkpointRequests.length}`,
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({ vaultRoot });
              const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
              artifactBytesByHash.set(hotHash, hotSnapshot.bundle);
              return {
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: baseRef,
                  hot: createBundleRef({
                    hash: hotHash,
                    key: `users/bundles/member-synthetic/no-progress-hot-${hotHash}.bundle.json`,
                    size: hotSnapshot.bundle.byteLength,
                  }),
                }),
              };
            },
            async importItem() {
              throw new Error("Mailbox import should not run without mailbox items.");
            },
            platform,
            async runAssistantPhase() {
              if (!firstRun) {
                return { progressed: false };
              }
              firstRun = false;
              const assistantRoot = resolveAssistantStatePaths(vaultRoot).assistantStateRoot;
              await mkdir(path.join(assistantRoot, "sessions"), { recursive: true });
              await writeFile(
                path.join(assistantRoot, "sessions", "session-checkpointed.json"),
                "{\"session\":\"checkpointed\"}\n",
                "utf8",
              );
              return {
                checkpointReason: "canonical_runtime_commit",
                progressed: true,
              };
            },
            vaultRoot,
          },
        );

      await runOnce();
      assert.deepEqual(artifactGetCalls, [baseHash, initialHotHash]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      assert.equal(checkpointRequests.length, 1);
      artifactGetCalls.length = 0;

      await runOnce();
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      assert.equal(checkpointRequests.length, 1);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("preserves checkpointed mailbox watermarks across clean warm foreground restores", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const importedSeqs: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/warm-mailbox-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const hotRef = createBundleRef({
        hash: hotHash,
        key: "users/bundles/member-synthetic/warm-mailbox-hot.bundle.json",
        size: hotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(hotHash, hotSnapshot.bundle);

      let currentWorkspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: hotRef,
        }),
        version: "9",
      });
      const mailboxItem = createMailboxItem({
        id: "mailbox_item_warm_restore_001",
        laneSeq: "1",
      });
      const workspacePort: HostedRuntimeWorkspacePort = {
        async read() {
          events.push("workspace.read");
          return {
            fetchedAt: TEST_NOW,
            workspace: currentWorkspace,
          };
        },
        async checkpoint(request) {
          events.push("workspace.checkpoint");
          checkpointRequests.push(request);
          currentWorkspace = createWorkspaceState({
            nextWakeAt: request.nextWakeAt ?? null,
            nextWakeReason: request.nextWakeReason ?? null,
            redactedStatus: request.redactedStatus ?? null,
            snapshotRef: request.snapshotRef,
            version: String(BigInt(currentWorkspace.version) + 1n),
          });
          return {
            checkpointed: true,
            workspace: currentWorkspace,
          };
        },
      };
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [mailboxItem],
        }),
        workspacePort,
      });

      const runOnce = async (attempt: number) =>
        await runHostedWorkspaceRuntimeJobInProcess(
          createWorkspaceRuntimeJobInput({
            request: {
              attemptId: `attempt_warm_mailbox_restore_${attempt}`,
              workspaceVersion: currentWorkspace.version,
            },
          }),
          {
            async createCheckpointSnapshot(snapshotInput) {
              events.push(`snapshot:${snapshotInput.reason}`);
              assert.equal(snapshotInput.reason, "idle_shutdown");
              const currentHotSnapshot = await snapshotHostedAssistantRuntimeHotState({
                vaultRoot,
              });
              const currentHotHash = sha256HostedBundleHex(currentHotSnapshot.bundle);
              artifactBytesByHash.set(currentHotHash, currentHotSnapshot.bundle);
              return {
                snapshotRef: buildHostedExecutionLayeredSnapshotRef({
                  base: baseRef,
                  hot: createBundleRef({
                    hash: currentHotHash,
                    key: `users/bundles/member-synthetic/warm-mailbox-hot-${currentHotHash}.bundle.json`,
                    size: currentHotSnapshot.bundle.byteLength,
                  }),
                }),
              };
            },
            async importItem(item) {
              importedSeqs.push(item.item.laneSeq);
              return { status: "imported" };
            },
            platform,
            async runAssistantPhase() {
              return { progressed: false };
            },
            vaultRoot,
          },
        );

      await runOnce(1);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      artifactGetCalls.length = 0;

      await runOnce(2);
      assert.deepEqual(importedSeqs, ["1"]);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(artifactGetCalls.length, 2);
      assert.equal(artifactGetCalls[0], baseHash);
      const secondFetch = fetchRequests
        .filter((request) => request.lanes.some((lane) => lane.lane === "conversation"))
        .at(-1);
      assert.ok(secondFetch);
      assert.equal(
        secondFetch.lanes.find((lane) => lane.lane === "conversation")?.importedSeq,
        "1",
      );
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("runs assistant phase from restored staged input when mailbox watermark is already current", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const sourceBaseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-base-"));
    const sourceHotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-hot-"));
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactBytesByHash = new Map<string, Uint8Array>();
    const importedSeqs: string[] = [];

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceBaseVaultRoot });
      await writeFile(path.join(sourceBaseVaultRoot, "base-note.md"), "base\n", "utf8");
      const baseBundle = await snapshotHostedBundleRoots({
        kind: "vault",
        roots: [
          {
            root: sourceBaseVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(baseBundle);
      const baseHash = sha256HostedBundleHex(baseBundle);
      const baseRef = createBundleRef({
        hash: baseHash,
        key: "users/bundles/member-synthetic/cold-restore-base.bundle.json",
        size: baseBundle.byteLength,
      });
      artifactBytesByHash.set(baseHash, baseBundle);

      await initializeVault({ createdAt: TEST_NOW, vaultRoot: sourceHotVaultRoot });
      const stagedInput = await upsertAssistantInputEvent({
        vault: sourceHotVaultRoot,
        event: {
          content: {
            text: "staged hosted Linq input",
            userMessageContent: [
              {
                text: "staged hosted Linq input",
                type: "text",
              },
            ],
          },
          conversation: {
            accountId: "acct_staged_linq",
            actorId: "actor_staged_linq",
            actorIsSelf: false,
            source: "linq",
            threadId: "thread_staged_linq",
            threadIsDirect: true,
          },
          occurredAt: TEST_NOW,
          receivedAt: TEST_NOW,
          replyTarget: {
            channel: "linq",
            messageId: "msg_staged_linq",
            threadId: "thread_staged_linq",
          },
          sourceRef: {
            dedupeKey: "dedupe_staged_linq",
            eventId: "evt_staged_linq",
            itemId: "mailbox_item_cold_restore_001",
            kind: "hosted-mailbox",
            lane: "conversation",
            laneSeq: "1",
            payloadSchema: "payload.v1",
            payloadSource: "inline",
            source: "hosted-mailbox",
            wakeSchema: "wake.v1",
          },
        },
      });
      const restoredState = createEmptyHostedMailboxImportState();
      restoredState.watermarks.conversation = "1";
      await writeMailboxImportStateFile(sourceHotVaultRoot, restoredState);
      const hotSnapshot = await snapshotHostedAssistantRuntimeHotState({
        vaultRoot: sourceHotVaultRoot,
      });
      const hotHash = sha256HostedBundleHex(hotSnapshot.bundle);
      const hotRef = createBundleRef({
        hash: hotHash,
        key: "users/bundles/member-synthetic/cold-restore-hot.bundle.json",
        size: hotSnapshot.bundle.byteLength,
      });
      artifactBytesByHash.set(hotHash, hotSnapshot.bundle);

      const workspace = createWorkspaceState({
        snapshotRef: buildHostedExecutionLayeredSnapshotRef({
          base: baseRef,
          hot: hotRef,
        }),
        version: "9",
      });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        events,
        mailboxPort: createMailboxPort({
          events,
          fetchRequests,
          items: [
            createMailboxItem({
              id: "mailbox_item_cold_restore_001",
              laneSeq: "1",
            }),
          ],
        }),
        workspacePort: createWorkspacePort({
          checkpointRequests,
          events,
          workspace,
        }),
      });

      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_cold_restore_staged_input",
            workspaceVersion: workspace.version,
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Cold-restore foreground replay should not checkpoint.");
          },
          async importItem(item) {
            importedSeqs.push(item.item.laneSeq);
            return { status: "imported" };
          },
          platform,
          async runAssistantPhase() {
            events.push("assistant");
            const restoredInput = await readAssistantInputEvent({
              inputId: stagedInput.inputId,
              vault: vaultRoot,
            });
            assert.equal(restoredInput?.inputId, stagedInput.inputId);
            assert.equal(restoredInput?.sourceRef.kind, "hosted-mailbox");
            return { progressed: false };
          },
          vaultRoot,
        },
      );

      assert.deepEqual(importedSeqs, []);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(artifactGetCalls, [baseHash, hotHash]);
      assert.equal(readConversationImportedSeq(fetchRequests[0]), "1");
      assert.ok(requireEventIndex(events, "workspace.read") < requireEventIndex(events, "mailbox.fetch"));
      assert.ok(requireEventIndex(events, "mailbox.fetch") < requireEventIndex(events, "assistant"));
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceBaseVaultRoot);
      await removeTempRoot(sourceHotVaultRoot);
    }
  });

  test("defers raw and derived snapshot artifacts before mailbox import", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-artifact-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-artifact-"));
    const artifactGetCalls: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const artifactLabelsByHash = new Map<string, string>();
    const eagerArtifactSpec = {
      bytes: Buffer.from("capture-artifact\n", "utf8"),
      path: "raw/captures/example/capture.bin",
    } as const;
    const artifactSpecs = [
      {
        bytes: Buffer.from("pdf-binary-artifact\n", "utf8"),
        path: "raw/inbox/example/scan.pdf",
      },
      {
        bytes: Buffer.from("assistant-input-preview\n", "utf8"),
        path: "raw/inbox/example/preview.txt",
      },
      {
        bytes: Buffer.from("{\"schema\":\"example\"}\n", "utf8"),
        path: "derived/inbox/example/attachment/manifest.json",
      },
      {
        bytes: Buffer.from("assistant-input-derived-summary\n", "utf8"),
        path: "derived/inbox/example/attachment/summary.txt",
      },
    ] as const;

    for (const spec of [eagerArtifactSpec, ...artifactSpecs]) {
      const sourceArtifactPath = path.join(sourceVaultRoot, spec.path);
      await mkdir(path.dirname(sourceArtifactPath), { recursive: true });
      await writeFile(sourceArtifactPath, spec.bytes);
    }

    const eagerArtifactHash = sha256HostedBundleHex(eagerArtifactSpec.bytes);
    artifactLabelsByHash.set(eagerArtifactHash, "eager-raw-capture");
    const artifactHashes = artifactSpecs.map((spec) => sha256HostedBundleHex(spec.bytes));
    artifactHashes.forEach((hash, index) => {
      artifactLabelsByHash.set(hash, `restored-artifact-${index}`);
    });
    const sourceBundle = await snapshotHostedBundleRoots({
      externalizeFile: async (file) => {
        const spec = [eagerArtifactSpec, ...artifactSpecs].find((entry) => entry.path === file.path);
        if (!spec) {
          return null;
        }

        return {
          byteSize: file.bytes.byteLength,
          sha256: sha256HostedBundleHex(file.bytes),
        };
      },
      kind: "vault",
      roots: [
        {
          root: sourceVaultRoot,
          rootKey: "vault",
        },
      ],
    });
    assert.ok(sourceBundle);
    const bundleHash = sha256HostedBundleHex(sourceBundle);
    artifactLabelsByHash.set(bundleHash, "workspace-bundle");
    const artifactBytesByHash = new Map<string, Uint8Array>(
      [
        [eagerArtifactHash, eagerArtifactSpec.bytes],
        ...artifactSpecs.map((spec, index) => [artifactHashes[index]!, spec.bytes] as const),
      ],
    );
    artifactBytesByHash.set(bundleHash, sourceBundle);

    try {
      await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            workspaceVersion: "9",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "e".repeat(64),
                key: "users/bundles/member-synthetic/restored-artifact.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            for (const spec of [eagerArtifactSpec, ...artifactSpecs]) {
              const restoredArtifactPath = path.join(vaultRoot, spec.path);
              await assert.rejects(readFile(restoredArtifactPath, "utf8"));
            }
            return { status: "imported" };
          },
          platform: createPlatform({
            artifactBytesByHash,
            artifactGetCalls,
            artifactLabelsByHash,
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_restored_artifact",
                  laneSeq: "1",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                snapshotRef: createBundleRef({
                  hash: bundleHash,
                  key: "users/bundles/member-synthetic/restored-artifact-before-import.bundle.json",
                  size: sourceBundle.byteLength,
                }),
                version: "9",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      assert.equal(events.includes("artifact.get:eager-raw-capture"), false);
      for (const [index] of artifactHashes.entries()) {
        assert.equal(events.includes(`artifact.get:restored-artifact-${index}`), false);
      }
      assert.ok(mailboxFetchIndex >= 0);
      assert.deepEqual(artifactGetCalls, [bundleHash]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("profiles pre-import work with many restored artifacts and mailbox messages", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-load-"));
    const sourceVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-source-load-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const artifactGetCalls: string[] = [];
    const artifactPutCalls: Array<{ byteLength: number; sha256: string }> = [];
    const logRequests: HostedRuntimeLogRequest[] = [];
    const events: string[] = [];
    const stageSamples: StageTimingSample[] = [];
    const artifactLabelsByHash = new Map<string, string>();
    const externalArtifactCount = 48;
    const inlineFileCount = 80;
    const mailboxItemCount = 75;
    const artifactSpecs: Array<{ bytes: Uint8Array; label: string; path: string }> = [];
    const inlineFileSpecs: Array<{ text: string; path: string }> = [];

    try {
      for (let index = 0; index < externalArtifactCount; index += 1) {
        const label = `artifact-${String(index + 1).padStart(3, "0")}`;
        const artifactPath = `raw/inbox/pre-import-load/${label}.bin`;
        const bytes = Buffer.from(
          `${label}\n${"synthetic attachment bytes ".repeat(64)}\n`,
          "utf8",
        );
        artifactSpecs.push({
          bytes,
          label,
          path: artifactPath,
        });
        const sourceArtifactPath = path.join(sourceVaultRoot, artifactPath);
        await mkdir(path.dirname(sourceArtifactPath), { recursive: true });
        await writeFile(sourceArtifactPath, bytes);
      }

      for (let index = 0; index < inlineFileCount; index += 1) {
        const notePath = path.join(
          sourceVaultRoot,
          "bank",
          "pre-import-load",
          `note-${String(index + 1).padStart(3, "0")}.md`,
        );
        const noteText = `# Synthetic note ${index + 1}\n\n${"workspace restore metadata ".repeat(48)}\n`;
        inlineFileSpecs.push({
          path: path.join("bank", "pre-import-load", `note-${String(index + 1).padStart(3, "0")}.md`),
          text: noteText,
        });
        await mkdir(path.dirname(notePath), { recursive: true });
        await writeFile(notePath, noteText, "utf8");
      }

      const artifactSpecByPath = new Map(artifactSpecs.map((spec) => [spec.path, spec]));
      const artifactHashes = artifactSpecs.map((spec) => {
        const sha256 = sha256HostedBundleHex(spec.bytes);
        artifactLabelsByHash.set(sha256, spec.label);
        return sha256;
      });
      const sourceBundle = await snapshotHostedBundleRoots({
        externalizeFile: async (file) => {
          const spec = artifactSpecByPath.get(file.path);
          if (!spec) {
            return null;
          }

          return {
            byteSize: file.bytes.byteLength,
            sha256: sha256HostedBundleHex(file.bytes),
          };
        },
        kind: "vault",
        roots: [
          {
            root: sourceVaultRoot,
            rootKey: "vault",
          },
        ],
      });
      assert.ok(sourceBundle);
      const bundleHash = sha256HostedBundleHex(sourceBundle);
      artifactLabelsByHash.set(bundleHash, "workspace-bundle");
      const artifactBytesByHash = new Map<string, Uint8Array>(
        artifactSpecs.map((spec, index) => [artifactHashes[index]!, spec.bytes]),
      );
      artifactBytesByHash.set(bundleHash, sourceBundle);
      const mailboxItems = Array.from({ length: mailboxItemCount }, (_, index) =>
        createMailboxItem({
          id: `mailbox_item_entrypoint_load_${String(index + 1).padStart(3, "0")}`,
          laneSeq: String(index + 1),
          payloadBytes: 256,
        })
      );
      const importedSeqs: string[] = [];
      const mailboxPort = createMailboxPort({
        events,
        items: mailboxItems,
        stageSamples,
      });
      const workspacePort = createWorkspacePort({
        checkpointRequests,
        events,
        stageSamples,
        workspace: createWorkspaceState({
          redactedStatus: {
            hostedMailboxConversationImportedSeq: "0",
            hostedMailboxSystemImportedSeq: "0",
          },
          snapshotRef: createBundleRef({
            hash: bundleHash,
            key: "users/bundles/member-synthetic/pre-import-load.bundle.json",
            size: sourceBundle.byteLength,
          }),
          version: "12",
        }),
      });
      const platform = createPlatform({
        artifactBytesByHash,
        artifactGetCalls,
        artifactLabelsByHash,
        artifactPutCalls,
        events,
        logRequests,
        mailboxPort,
        stageSamples,
        workspacePort,
      });
      const ensureHostedInboxSidecarReadyImpl =
        mocks.ensureHostedInboxSidecarReady.getMockImplementation();
      assert.ok(ensureHostedInboxSidecarReadyImpl);
      mocks.ensureHostedInboxSidecarReady.mockImplementationOnce(async (input) => {
        events.push("sidecar.ready");
        return await ensureHostedInboxSidecarReadyImpl(input);
      });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_workspace_preimport_load",
            budget: {
              maxMailboxItems: mailboxItemCount,
            },
            leaseGeneration: "3",
            workspaceVersion: "12",
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            return await measureStage(stageSamples, "snapshot.create", async () => {
              events.push(`snapshot.create:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
              assert.equal(
                (await readHostedMailboxImportState({ vaultRoot })).watermarks.conversation,
                String(mailboxItemCount),
              );
              const snapshotBytes = await snapshotHostedBundleRoots({
                kind: "vault",
                roots: [
                  {
                    root: vaultRoot,
                    rootKey: "vault",
                  },
                ],
              });
              if (!snapshotBytes) {
                throw new Error("Expected checkpoint snapshot bytes.");
              }
              const snapshotHash = sha256HostedBundleHex(snapshotBytes);
              artifactLabelsByHash.set(snapshotHash, "checkpoint-snapshot");
              await platform.artifactStore.put({
                bytes: snapshotBytes,
                sha256: snapshotHash,
              });
              return {
                snapshotRef: createBundleRef({
                  hash: snapshotHash,
                  key: "users/bundles/member-synthetic/pre-import-load-after-import.bundle.json",
                  size: snapshotBytes.byteLength,
                }),
              };
            });
          },
          async importItem(item) {
            return await measureStage(stageSamples, "mailbox.importItem", async () => {
              importedSeqs.push(item.item.laneSeq);
              events.push(`import:${item.item.laneSeq}`);
              if (importedSeqs.length === 1) {
                for (const spec of artifactSpecs) {
                  await assert.rejects(readFile(path.join(vaultRoot, spec.path), "utf8"));
                }
                for (const spec of inlineFileSpecs) {
                  assert.equal(await readFile(path.join(vaultRoot, spec.path), "utf8"), spec.text);
                }
              }
              return { status: "imported" };
            });
          },
          platform,
          vaultRoot,
        },
      );

      const mailboxFetchIndex = requireEventIndex(events, "mailbox.fetch");
      const firstArtifactFetchIndex = requireEventIndex(events, "artifact.get:workspace-bundle");
      const importedEvents = events.filter((event) => event.startsWith("import:"));
      const mailboxImportedLogIndex = requireEventIndex(events, "runtime.log:mailbox.imported");
      const sidecarIndex = requireEventIndex(events, "sidecar.ready");
      const mailboxImportedLog = logRequests
        .flatMap((request) => request.entries)
        .find((entry) => entry.eventCode === "mailbox.imported");
      const stageSummary = summarizeStageTimings(stageSamples);
      assert.ok(mailboxImportedLog);

      assert.equal(events[0], "workspace.read");
      assert.ok(firstArtifactFetchIndex < mailboxFetchIndex);
      assert.deepEqual(artifactGetCalls, [bundleHash]);
      for (const artifactHash of artifactHashes) {
        assert.equal(
          events.includes(`artifact.get:${artifactLabelsByHash.get(artifactHash)}`),
          false,
        );
      }
      assert.equal(importedEvents.length, mailboxItemCount);
      assert.deepEqual(importedSeqs, mailboxItems.map((item) => item.laneSeq));
      assert.equal(artifactPutCalls.length, 1);
      assert.ok(mailboxFetchIndex < mailboxImportedLogIndex);
      assert.ok(mailboxImportedLogIndex < sidecarIndex);
      assert.ok(sidecarIndex < requireEventIndex(events, `snapshot.create:${mailboxItemCount}`));
      assert.equal(stageSummary["workspace.read"]?.count, 1);
      assert.equal(stageSummary["artifact.get"]?.count, 1);
      assert.equal(stageSummary["mailbox.fetch"]?.count, 1);
      assert.equal(stageSummary["mailbox.importItem"]?.count, mailboxItemCount);
      assert.equal(stageSummary["snapshot.create"]?.count ?? 0, 1);
      assert.equal(stageSummary["artifact.put"]?.count ?? 0, 1);
      assert.equal(stageSummary["workspace.checkpoint"]?.count ?? 0, 1);
      assert.ok((stageSummary["runtime.log.write"]?.count ?? 0) >= 1);
      for (const key of Object.keys(mailboxImportedLog.redactedJson ?? {})) {
        assert.doesNotMatch(key, /(?:body|cipher|file|id|path|payload|ref)/iu);
      }
      assert.equal(mailboxImportedLog.redactedJson?.fetchedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.importedCount, mailboxItemCount);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointDeferred, true);
      assert.equal(mailboxImportedLog.redactedJson?.checkpointed, false);
      assert.equal(mailboxImportedLog.redactedJson?.conversationSeqEnd, String(mailboxItemCount));
      if (process.env.HOSTED_PREIMPORT_PROFILE === "1") {
        console.info("hosted pre-import local profile", stageSummary);
      }
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: String(mailboxItemCount),
          hostedMailboxFetchedCount: mailboxItemCount,
          hostedMailboxImportedCount: mailboxItemCount,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
      await removeTempRoot(sourceVaultRoot);
    }
  });

  test("creates a null-bootstrap local workspace when no snapshot exists", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const fetchRequests: HostedMailboxFetchRequest[] = [];
    const artifactGetCalls: string[] = [];

    try {
      await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot(snapshotInput) {
          events.push(
            `snapshot:${await describeCheckpointConversationWatermarkTransition(snapshotInput, vaultRoot)}`,
          );
          return {
            snapshotRef: createBundleRef({
              hash: "e".repeat(64),
              key: "users/bundles/member-synthetic/null-bootstrap.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          events.push("import");
          return { status: "imported" };
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({
            events,
            fetchRequests,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_null_bootstrap",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: null,
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(artifactGetCalls, []);
      assert.equal(
        fetchRequests[0]?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq,
        "0",
      );
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "import",
        "snapshot:idle->1",
        "workspace.checkpoint",
      ]);
      await assertPrivateDirectoryMode(vaultRoot);
      await assertPrivateDirectoryMode(
        resolveAssistantStatePaths(path.resolve(vaultRoot)).assistantStateRoot,
      );
      await assertPrivateDirectoryMode(
        path.join(path.dirname(path.resolve(vaultRoot)), `${path.basename(vaultRoot)}-operator-home`),
      );
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("fails closed before mailbox fetch when an existing snapshot is unavailable", async () => {
    const events: string[] = [];
    const artifactGetCalls: string[] = [];
    const snapshotHash = "f".repeat(64);

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          workspaceVersion: "2",
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run when restore fails.");
        },
        async importItem() {
          throw new Error("Import should not run when restore fails.");
        },
        platform: createPlatform({
          artifactGetCalls,
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              snapshotRef: createBundleRef({
                hash: snapshotHash,
                key: "users/bundles/member-synthetic/missing.bundle.json",
                size: 512,
              }),
              version: "2",
            }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow(/snapshot restore failed/u);

    assert.deepEqual(events, ["workspace.read"]);
    assert.deepEqual(artifactGetCalls, [snapshotHash]);
  });

  test("fails closed before workspace read when runtime budget is requested", async () => {
    const events: string[] = [];

    await expect(
      runHostedWorkspaceRuntimeJobInProcess({
        request: createWorkspaceRunRequest({
          budget: {
            maxRuntimeMs: 30_000,
          },
        }),
      }, {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run with unsupported runtime budget.");
        },
        async importItem() {
          throw new Error("Import should not run with unsupported runtime budget.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot: "synthetic-vault-root",
      }),
    ).rejects.toThrow(/budget\.maxRuntimeMs is not supported yet/u);
    assert.deepEqual(events, []);
  });

  test("reports mailbox budget exhaustion only after deferring an overflow item", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];

    try {
      const startedAt = performance.now();
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            budget: {
              maxMailboxItems: 1,
            },
            idleCheckpointDelayMs: 10_000,
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "b".repeat(64),
                key: "users/bundles/member-synthetic/workspace-budget.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem(item) {
            imported.push(item.item.id);
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [
                createMailboxItem({
                  id: "mailbox_item_entrypoint_budget_001",
                  laneSeq: "1",
                }),
                createMailboxItem({
                  createdAt: "9999-01-01T00:00:00.000Z",
                  id: "mailbox_item_entrypoint_budget_002",
                  laneSeq: "2",
                }),
              ],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.ok(performance.now() - startedAt < 2_000);
      assert.deepEqual(imported, ["mailbox_item_entrypoint_budget_001"]);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "snapshot:1",
        "workspace.checkpoint",
      ]);
      assert.deepEqual(checkpointRequests.map((request) => request.reason), [
        "idle_shutdown",
      ]);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(checkpointRequests[0]?.nextWakeAt, mailboxRetryWakeAt);
      assert.equal(checkpointRequests[0]?.nextWakeReason, "mailbox");
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "1",
          hostedMailboxFetchedCount: 2,
          hostedMailboxImportedCount: 1,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "budget_exhausted",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns mailbox retry wake for an unbootstrapped sidecar item without idle checkpointing", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const imported: string[] = [];
    const sidecarItem = createMailboxItem({
      id: "mailbox_item_entrypoint_sidecar_retry",
      laneSeq: "1",
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_entrypoint_sidecar_retry",
    });
    const baseMailboxPort = createMailboxPort({
      events,
      items: [sidecarItem],
    });

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Retry-only mailbox scheduling should not snapshot unchanged state.");
        },
        async importItem(item) {
          imported.push(item.item.id);
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: {
            ...baseMailboxPort,
            async fetchPayload(): Promise<HostedMailboxPayloadFetchResponse> {
              events.push("mailbox.fetchPayload");
              return {
                fetchedAt: TEST_NOW,
                payload: null,
                unavailable: {
                  code: "not_found",
                  retryable: true,
                },
              };
            },
          },
          workspacePort: createWorkspacePort({
            checkpointRequests,
            events,
            workspace: createWorkspaceState({ version: "0" }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(imported, []);
      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      const mailboxRetryWakeAt = result.nextWakeAt;
      assert.match(mailboxRetryWakeAt ?? "", /^\d{4}-\d{2}-\d{2}T/u);
      assert.deepEqual(result, {
        nextWakeAt: mailboxRetryWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 1,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 1,
          hostedMailboxImportedCount: 0,
          hostedMailboxNextRetryAtPresent: true,
          hostedMailboxRetryableBlockedCount: 1,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns next wake from the checkpointed workspace after import commits", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const previousWakeAt = "2099-04-27T00:05:00.000Z";
    const events: string[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "c".repeat(64),
              key: "users/bundles/member-synthetic/workspace-cleared-wake.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_wake_001",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            checkpointWorkspace(request) {
              return createWorkspaceState({
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              });
            },
            events,
            workspace: createWorkspaceState({
              nextWakeAt: previousWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, previousWakeAt);
      assert.equal(result.status, "scheduled");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("keeps device-sync ownership when invocation projections tie on wake time", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const tiedWakeAt = "2099-04-27T00:05:00.000Z";
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          return {
            snapshotRef: createBundleRef({
              hash: "d".repeat(64),
              key: "users/bundles/member-synthetic/device-sync-tied-projection.bundle.json",
              size: 512,
            }),
          };
        },
        async importItem() {
          return { status: "imported" };
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({
            events,
            items: [
              createMailboxItem({
                id: "mailbox_item_entrypoint_wake_tie",
                laneSeq: "1",
              }),
            ],
          }),
          workspacePort: createWorkspacePort({
            checkpointRequests,
            checkpointWorkspace(request) {
              return createWorkspaceState({
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              });
            },
            events,
            workspace: createWorkspaceState({
              nextWakeAt: tiedWakeAt,
              nextWakeReason: "assistant",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return {
            checkpointReason: "assistant_runtime_commit",
            nextWakeAt: tiedWakeAt,
            nextWakeReason: "device-sync.reconcile",
            progressed: true,
            redactedStatus: {
              hostedAssistantNextWakeAt: tiedWakeAt,
              hostedAssistantProgressed: true,
            },
          };
        },
        vaultRoot,
      });

      assert.equal(result.nextWakeAt, tiedWakeAt);
      assert.equal(result.status, "scheduled");
      assert.equal(checkpointRequests.at(-1)?.nextWakeAt, tiedWakeAt);
      assert.equal(checkpointRequests.at(-1)?.nextWakeReason, "device-sync.reconcile");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("returns scheduled when no mailbox import runs and the workspace has a future wake", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const nextWakeAt = "2099-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run without mailbox state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              nextWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        vaultRoot,
      });

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch", "mailbox.fetch"]);
      assert.deepEqual(result, {
        nextWakeAt,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "scheduled",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("drops stale workspace wake when no mailbox import runs", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const staleWakeAt = "2000-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(createWorkspaceRuntimeJobInput(), {
        async createCheckpointSnapshot() {
          throw new Error("Snapshot should not run without mailbox state changes.");
        },
        async importItem() {
          throw new Error("Import should not run when no mailbox items are fetched.");
        },
        platform: createPlatform({
          mailboxPort: createMailboxPort({ events, items: [] }),
          workspacePort: createWorkspacePort({
            checkpointRequests: [],
            events,
            workspace: createWorkspaceState({
              nextWakeAt: staleWakeAt,
              nextWakeReason: "alarm",
              version: "0",
            }),
          }),
        }),
        async runAssistantPhase() {
          return { progressed: false };
        },
        vaultRoot,
      });

      assert.deepEqual(events, ["workspace.read", "mailbox.fetch", "mailbox.fetch"]);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("does not dirty-checkpoint a consumed alarm wake when the assistant phase ends idle", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const staleWakeAt = "2026-04-27T00:05:00.000Z";

    try {
      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
          },
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}:${await readCheckpointConversationWatermark(snapshotInput, vaultRoot)}`);
            return {
              snapshotRef: createBundleRef({
                hash: "7".repeat(64),
                key: "users/bundles/member-synthetic/alarm-idle.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: "assistant",
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
      ]);
      assert.deepEqual(checkpointRequests, []);
      assert.deepEqual(result, {
        nextWakeAt: null,
        redactedStatus: {
          hostedMailboxBlockedCount: 0,
          hostedMailboxConversationImportedSeq: "0",
          hostedMailboxFetchedCount: 0,
          hostedMailboxImportedCount: 0,
          hostedMailboxRetryableBlockedCount: 0,
          hostedMailboxSystemImportedSeq: "0",
        },
        status: "idle",
      });
    } finally {
      await removeTempRoot(vaultRoot);
    }
  });

  test("forces browser-vault refresh maintenance from assistant phase refresh intent", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];

    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
    mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockResolvedValueOnce({
      status: "skipped_no_port",
    });

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_browser_vault_marker_force",
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            throw new Error("Browser-vault marker force test should not checkpoint.");
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: [],
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            return {
              browserVaultReplicaRefreshRequested: true,
              progressed: false,
            };
          },
          vaultRoot,
        },
      );

      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledTimes(1);
      expect(mocks.refreshHostedBrowserVaultReplicaFromRuntime).toHaveBeenCalledWith(
        expect.objectContaining({
          force: true,
          vaultRoot,
          workspace: expect.objectContaining({
            version: "0",
          }),
        }),
      );
      expect(result.status).toBe("idle");
    } finally {
      mocks.refreshHostedBrowserVaultReplicaFromRuntime.mockClear();
      await removeTempRoot(vaultRoot);
    }
  });

  test.each([
    {
      label: "assistant-labeled",
      nextWakeReason: "assistant" as const,
    },
    {
      label: "null-labeled",
      nextWakeReason: null,
    },
    {
      label: "explicit device-sync",
      nextWakeReason: "device-sync.reconcile" as const,
    },
  ])("e2e clears stale $label scheduled device-sync wake when no dirty work remains", async (input) => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const deviceSyncPort = createEmptyDeviceSyncPort();
    const staleWakeAt = "2026-04-26T23:59:59.000Z";

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-04-27T00:00:00.000Z"));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            idleCheckpointDelayMs: 1,
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "a".repeat(64),
                key: "users/bundles/member-synthetic/stale-device-sync-clear.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Import should not run when no mailbox items are fetched.");
          },
          platform: createPlatform({
            deviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: staleWakeAt,
                nextWakeReason: input.nextWakeReason,
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      assert.deepEqual(events, [
        "workspace.read",
        "mailbox.fetch",
        "mailbox.fetch",
        "snapshot:idle_shutdown",
        "workspace.checkpoint",
      ]);
      const shouldRunDeviceSync = input.nextWakeReason === "device-sync.reconcile";
      assert.equal(deviceSyncPort.fetchSnapshotCalls, shouldRunDeviceSync ? 1 : 0);
      assert.equal(deviceSyncPort.fetchDirtyStatesCalls, shouldRunDeviceSync ? 1 : 0);
      assert.equal(checkpointRequests.length, 1);
      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(checkpointRequests[0]?.nextWakeAt, null);
      assert.equal(checkpointRequests[0]?.nextWakeReason, null);
      assert.equal(result.status, "idle");
      assert.equal(result.nextWakeAt, null);
      assert.equal(result.redactedStatus?.hostedMailboxFetchedCount, 0);
      assert.equal(result.redactedStatus?.hostedMailboxImportedCount, 0);
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("e2e preserves device-sync follow-up wake and runs the scheduled alarm lane", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const events: string[] = [];
    const firstCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const connectionId = "device_sync_connection_synthetic";
    const firstNow = "2026-04-27T00:00:00.000Z";
    const firstNextWakeAt = "2026-04-27T00:01:00.000Z";
    const secondNow = "2026-04-27T00:01:01.000Z";
    const secondNextWakeAt = "2026-04-27T00:02:00.000Z";
    const firstDeviceSyncPort = createSnapshotDeviceSyncPort({
      connectionId,
      nextReconcileAt: firstNextWakeAt,
    });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(firstNow));
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const firstResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_first",
            workspaceVersion: "0",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:first:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "8".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-first.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("Scheduled device-sync wakes should not import mailbox items.");
          },
          platform: createPlatform({
            deviceSyncPort: firstDeviceSyncPort,
            mailboxPort: createMailboxPort({
              events,
              items: [],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests: firstCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: firstNow,
                nextWakeReason: "device-sync.reconcile",
                version: "0",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const firstCheckpoint = firstCheckpointRequests.at(-1);
      assert.ok(firstCheckpoint);
      assert.equal(firstDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(firstResult.status, "scheduled");
      assert.equal(firstResult.nextWakeAt, firstNextWakeAt);
      assert.equal(firstCheckpoint.nextWakeAt, firstNextWakeAt);
      assert.equal(firstCheckpoint.nextWakeReason, "device-sync.reconcile");

      vi.setSystemTime(new Date(secondNow));
      const secondCheckpointRequests: HostedWorkspaceCheckpointRequest[] = [];
      const secondDeviceSyncPort = createSnapshotDeviceSyncPort({
        connectionId,
        nextReconcileAt: secondNextWakeAt,
      });
      const secondResult = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_device_sync_follow_up",
            workspaceVersion: "1",
          },
          resolvedConfig: createDeviceSyncResolvedConfig(),
        }),
        {
          async createCheckpointSnapshot(snapshotInput) {
            events.push(`snapshot:second:${snapshotInput.reason}`);
            return {
              snapshotRef: createBundleRef({
                hash: "9".repeat(64),
                key: "users/bundles/member-synthetic/device-sync-follow-up.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            throw new Error("No mailbox items should be imported for the follow-up alarm.");
          },
          platform: createPlatform({
            deviceSyncPort: secondDeviceSyncPort,
            mailboxPort: createMailboxPort({ events, items: [] }),
            workspacePort: createWorkspacePort({
              checkpointRequests: secondCheckpointRequests,
              events,
              workspace: createWorkspaceState({
                nextWakeAt: firstCheckpoint.nextWakeAt,
                nextWakeReason: "device-sync.reconcile",
                version: "1",
              }),
            }),
          }),
          vaultRoot,
        },
      );

      const secondCheckpoint = secondCheckpointRequests.at(-1);
      assert.ok(secondCheckpoint);
      assert.equal(secondDeviceSyncPort.fetchSnapshotCalls, 1);
      assert.equal(secondResult.status, "scheduled");
      assert.equal(secondResult.nextWakeAt, secondNextWakeAt);
      assert.equal(secondCheckpoint.nextWakeAt, secondNextWakeAt);
      assert.equal(secondCheckpoint.nextWakeReason, "device-sync.reconcile");
    } finally {
      vi.useRealTimers();
      await removeTempRoot(vaultRoot);
    }
  });

  test("parses additive workspace-invocation inputs and rejects legacy run-drain fields", () => {
    const parsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: createWorkspaceRunRequest({
        workspace: createWorkspaceState({ version: "0" }),
      }),
      runtime: {
        forwardedEnv: {
          HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
        },
      },
    });

    assert.equal(parsed.request.attemptId, "attempt_synthetic_workspace_run");
    assert.equal(parsed.request.workspace?.version, "0");
    assert.deepEqual(parsed.runtime?.forwardedEnv, {
      HOSTED_ASSISTANT_MODEL: "gpt-synthetic",
    });

    const nullWorkspaceParsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: createWorkspaceRunRequest({
        workspace: null,
      }),
    });
    assert.equal(nullWorkspaceParsed.request.workspace, null);

    const timedParsed = parseHostedAssistantWorkspaceRuntimeJobInput({
      request: {
        ...createWorkspaceRunRequest(),
        idleCheckpointDelayMs: 180_000,
      },
    });
    assert.equal(timedParsed.request.idleCheckpointDelayMs, 180_000);

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          reason: "browser_vault_refresh",
        },
      })
    ).toThrow("Hosted assistant workspace runtime job request.reason is no longer supported.");

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          source: "manual",
        },
      })
    ).toThrow("Hosted assistant workspace runtime job request.source is no longer supported.");

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          checkpointNextWakeAt: null,
        },
      })
    ).toThrow(
      "Hosted assistant workspace runtime job request.checkpointNextWakeAt is no longer supported.",
    );

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          deadlineAt: "2026-04-27T00:10:00.000Z",
        },
      })
    ).toThrow(
      "Hosted assistant workspace runtime job request.deadlineAt is no longer supported.",
    );

    expect(() =>
      parseHostedAssistantWorkspaceRuntimeJobInput({
        request: {
          ...createWorkspaceRunRequest(),
          runDrain: {},
        },
      })
    ).toThrow(/runDrain is no longer supported/u);
  });
});

interface OpenAiHttpsProbeResult {
  body?: string;
  caConfigured: boolean;
  code?: string | null;
  message?: string;
  name?: string;
  ok: boolean;
  status?: number;
}

async function createOpenAiProbeCertificateFiles(root: string): Promise<{
  caCertPath: string;
  serverCertPath: string;
  serverKeyPath: string;
}> {
  await mkdir(root, { recursive: true });
  const caConfigPath = path.join(root, "openssl-ca.cnf");
  const serverConfigPath = path.join(root, "openssl-server.cnf");
  const caCertPath = path.join(root, "test-ca.crt");
  const caKeyPath = path.join(root, "test-ca.key");
  const serverCertPath = path.join(root, "api-openai-com.crt");
  const serverKeyPath = path.join(root, "api-openai-com.key");
  const serverCsrPath = path.join(root, "api-openai-com.csr");

  await writeFile(caConfigPath, [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "prompt = no",
    "x509_extensions = v3_ca",
    "",
    "[req_distinguished_name]",
    "CN = Murph Hosted Runtime Test CA",
    "",
    "[v3_ca]",
    "basicConstraints = critical,CA:TRUE",
    "keyUsage = critical,keyCertSign,cRLSign",
    "subjectKeyIdentifier = hash",
    "authorityKeyIdentifier = keyid:always,issuer",
    "",
  ].join("\n"));
  await writeFile(serverConfigPath, [
    "[req]",
    "distinguished_name = req_distinguished_name",
    "req_extensions = v3_req",
    "prompt = no",
    "",
    "[req_distinguished_name]",
    "CN = api.openai.com",
    "",
    "[v3_req]",
    "basicConstraints = CA:FALSE",
    "keyUsage = digitalSignature,keyEncipherment",
    "extendedKeyUsage = serverAuth",
    "subjectAltName = @alt_names",
    "",
    "[alt_names]",
    "DNS.1 = api.openai.com",
    "IP.1 = 127.0.0.1",
    "",
  ].join("\n"));

  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-sha256",
    "-config",
    caConfigPath,
    "-keyout",
    caKeyPath,
    "-out",
    caCertPath,
  ], { cwd: root });
  await execFileAsync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-config",
    serverConfigPath,
    "-keyout",
    serverKeyPath,
    "-out",
    serverCsrPath,
  ], { cwd: root });
  await execFileAsync("openssl", [
    "x509",
    "-req",
    "-in",
    serverCsrPath,
    "-CA",
    caCertPath,
    "-CAkey",
    caKeyPath,
    "-CAcreateserial",
    "-out",
    serverCertPath,
    "-days",
    "1",
    "-sha256",
    "-extensions",
    "v3_req",
    "-extfile",
    serverConfigPath,
  ], { cwd: root });

  return {
    caCertPath,
    serverCertPath,
    serverKeyPath,
  };
}

async function startOpenAiProbeServer(input: {
  serverCertPath: string;
  serverKeyPath: string;
}): Promise<{
  close: () => Promise<void>;
  port: number;
}> {
  const server = createHttpsServer({
    cert: await readFile(input.serverCertPath),
    key: await readFile(input.serverKeyPath),
  }, (request, response) => {
    if (
      request.method === "POST"
      && request.url === "/v1/responses"
      && request.headers.authorization === "Bearer __cloudflare_injected__"
    ) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("ok");
      return;
    }

    response.writeHead(401, { "content-type": "text/plain" });
    response.end("unexpected probe request");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    port: (address as AddressInfo).port,
  };
}

async function runOpenAiHttpsProbe(input: {
  runtimeEnv: Readonly<Record<string, string>>;
  url: string;
}): Promise<OpenAiHttpsProbeResult> {
  const childEnv: NodeJS.ProcessEnv = {
    ...input.runtimeEnv,
    TARGET_URL: input.url,
  };
  const child = spawn(process.execPath, ["-e", OPENAI_HTTPS_PROBE_SCRIPT], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  assert.equal(exitCode, 0, stderr);

  try {
    return JSON.parse(stdout) as OpenAiHttpsProbeResult;
  } catch (error) {
    throw new Error(`OpenAI HTTPS probe did not emit JSON: ${stdout}`, {
      cause: error,
    });
  }
}

const OPENAI_HTTPS_PROBE_SCRIPT = `
const { readFileSync } = require("node:fs");
const https = require("node:https");

const targetUrl = process.env.TARGET_URL;
const caPath = process.env.CODEX_CA_CERTIFICATE || process.env.SSL_CERT_FILE || null;
const caConfigured = Boolean(
  process.env.CODEX_CA_CERTIFICATE
  || process.env.CURL_CA_BUNDLE
  || process.env.NODE_EXTRA_CA_CERTS
  || process.env.REQUESTS_CA_BUNDLE
  || process.env.SSL_CERT_FILE
);
const options = {
  headers: {
    authorization: "Bearer " + (process.env.OPENAI_API_KEY || ""),
    "content-type": "application/json",
  },
  lookup(hostname, lookupOptions, callback) {
    if (lookupOptions && lookupOptions.all) {
      callback(null, [{ address: "127.0.0.1", family: 4 }]);
      return;
    }
    callback(null, "127.0.0.1", 4);
  },
  method: "POST",
  servername: "api.openai.com",
  ...(caPath ? { ca: readFileSync(caPath) } : {}),
};

const request = https.request(targetUrl, options, (response) => {
  const chunks = [];
  response.on("data", (chunk) => chunks.push(chunk));
  response.on("end", () => {
    process.stdout.write(JSON.stringify({
      body: Buffer.concat(chunks).toString("utf8"),
      caConfigured,
      ok: true,
      status: response.statusCode,
    }));
  });
});
request.setTimeout(2_000, () => {
  request.destroy(Object.assign(new Error("OpenAI HTTPS probe timed out."), {
    code: "PROBE_TIMEOUT",
  }));
});
request.on("error", (error) => {
  process.stdout.write(JSON.stringify({
    caConfigured,
    code: error.code || null,
    message: error.message,
    name: error.name,
    ok: false,
  }));
});
request.end(JSON.stringify({
  input: "ping",
  model: "gpt-synthetic",
}));
`;

function createPlatform(input: {
  artifactBytesByHash?: ReadonlyMap<string, Uint8Array>;
  artifactGetCalls?: string[];
  artifactLabelsByHash?: ReadonlyMap<string, string>;
  artifactPutCalls?: Array<{ byteLength: number; sha256: string }>;
  deviceSyncPort?: HostedRuntimeDeviceSyncPort | null;
  events?: string[];
  latencyTraceRequests?: HostedRuntimeLatencyTraceRequest[];
  logRequests?: HostedRuntimeLogRequest[];
  issueExportPort?: HostedRuntimePlatform["issueExportPort"] | null;
  mailboxPort: HostedRuntimeMailboxPort | null;
  runtimeLivenessIntervalMs?: number | null;
  runtimeLivenessPort?: RuntimeLivenessPort | null;
  runtimeLivenessRequired?: boolean | null;
  stageSamples?: StageTimingSample[];
  workspacePort: HostedRuntimeWorkspacePort | null;
}): HostedRuntimePlatform {
  return {
    artifactStore: {
      async get(sha256) {
        return await measureStage(input.stageSamples, "artifact.get", async () => {
          input.artifactGetCalls?.push(sha256);
          input.events?.push(`artifact.get:${readArtifactEventLabel(input.artifactLabelsByHash, sha256)}`);
          return input.artifactBytesByHash?.get(sha256) ?? null;
        });
      },
      async put(artifact) {
        await measureStage(input.stageSamples, "artifact.put", async () => {
          input.artifactPutCalls?.push({
            byteLength: artifact.bytes.byteLength,
            sha256: artifact.sha256,
          });
          input.events?.push(
            `artifact.put:${readArtifactEventLabel(input.artifactLabelsByHash, artifact.sha256)}`,
          );
        });
        return undefined;
      },
    },
    effectsPort: {
      async readRawEmailMessage() {
        return null;
      },
      async sendEmail() {
        return undefined;
      },
    },
    ...(input.deviceSyncPort ? { deviceSyncPort: input.deviceSyncPort } : {}),
    ...(input.logRequests
      ? {
          logPort: {
            async write(request: HostedRuntimeLogRequest) {
              await measureStage(input.stageSamples, "runtime.log.write", async () => {
                input.logRequests?.push(request);
                for (const entry of request.entries) {
                  input.events?.push(`runtime.log:${entry.eventCode}`);
                }
              });
              return { loggedCount: request.entries.length };
            },
          },
        }
      : {}),
    ...(input.latencyTraceRequests
      ? {
          latencyTracePort: {
            async record(request: HostedRuntimeLatencyTraceRequest) {
              input.latencyTraceRequests?.push(request);
              return {
                matchedCount: 1,
                recorded: true,
                unmatchedCount: 0,
              };
            },
          },
        }
      : {}),
    ...(input.issueExportPort ? { issueExportPort: input.issueExportPort } : {}),
    ...(input.mailboxPort ? { mailboxPort: input.mailboxPort } : {}),
    ...(input.runtimeLivenessIntervalMs
      ? { runtimeLivenessIntervalMs: input.runtimeLivenessIntervalMs }
      : {}),
    ...(input.runtimeLivenessPort ? { runtimeLivenessPort: input.runtimeLivenessPort } : {}),
    ...(input.runtimeLivenessRequired !== undefined
      ? { runtimeLivenessRequired: input.runtimeLivenessRequired }
      : {}),
    ...(input.workspacePort ? { workspacePort: input.workspacePort } : {}),
  };
}

interface StageTimingSample {
  elapsedMs: number;
  stage: string;
}

interface StageTimingSummary {
  count: number;
  elapsedMs: number;
}

async function measureStage<T>(
  samples: StageTimingSample[] | undefined,
  stage: string,
  run: () => Promise<T> | T,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await run();
  } finally {
    samples?.push({
      elapsedMs: Math.max(0, performance.now() - startedAt),
      stage,
    });
  }
}

function summarizeStageTimings(
  samples: readonly StageTimingSample[],
): Record<string, StageTimingSummary> {
  return samples.reduce<Record<string, StageTimingSummary>>((summary, sample) => {
    const existing = summary[sample.stage] ?? {
      count: 0,
      elapsedMs: 0,
    };
    summary[sample.stage] = {
      count: existing.count + 1,
      elapsedMs: existing.elapsedMs + sample.elapsedMs,
    };
    return summary;
  }, {});
}

function readArtifactEventLabel(
  labelsByHash: ReadonlyMap<string, string> | undefined,
  sha256: string,
): string {
  return labelsByHash?.get(sha256) ?? "unlabeled-artifact";
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireEventIndex(events: readonly string[], event: string): number {
  const index = events.indexOf(event);
  assert.notEqual(index, -1, `Expected event ${event} among ${events.length} recorded events.`);
  return index;
}

function readConversationImportedSeq(request: HostedMailboxFetchRequest | undefined): string | null {
  return request?.lanes.find((lane) => lane.lane === "conversation")?.importedSeq ?? null;
}

function createMailboxImportStateBundle(input: HostedMailboxImportState): {
  bytes: Uint8Array;
  hash: string;
} {
  const bytes = writeMailboxImportStateToBundle(null, input);

  return {
    bytes,
    hash: sha256HostedBundleHex(bytes),
  };
}

function writeMailboxImportStateToBundle(
  bytes: Uint8Array | null,
  input: HostedMailboxImportState,
): Uint8Array {
  return writeHostedBundleTextFile({
    bytes,
    kind: "vault",
    path: HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH,
    root: "vault",
    text: JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  });
}

async function writeMailboxImportStateFile(
  vaultRoot: string,
  input: HostedMailboxImportState,
): Promise<void> {
  const statePath = path.join(vaultRoot, HOSTED_MAILBOX_IMPORT_STATE_RELATIVE_PATH);
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify({
      schema: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA,
      schemaVersion: HOSTED_MAILBOX_IMPORT_STATE_SCHEMA_VERSION,
      value: input,
    }),
  );
}

function createMailboxPort(input: {
  consumedSeqByLane?: HostedMailboxFetchResponse["consumedSeqByLane"];
  consumeRequests?: HostedMailboxConsumeRequest[];
  events: string[];
  fetchRequests?: HostedMailboxFetchRequest[];
  items: HostedMailboxItem[];
  stageSamples?: StageTimingSample[];
}): HostedRuntimeMailboxPort {
  const consumeRequests = input.consumeRequests;

  return {
    ...(consumeRequests
      ? {
          async consume(request): Promise<HostedMailboxConsumeResponse> {
            input.events.push("mailbox.consume");
            consumeRequests.push(request);
            return {
              acknowledgedAt: TEST_NOW,
              consumedSeqByLane: request.lanes,
              userId: TEST_USER_ID,
            };
          },
        }
      : {}),
    async fetch(request: HostedMailboxFetchRequest): Promise<HostedMailboxFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetch", async () => {
        input.events.push("mailbox.fetch");
        input.fetchRequests?.push(request);
        const consumedSeqByLane = new Map(
          (input.consumedSeqByLane ?? []).map((entry) => [
            entry.lane,
            BigInt(entry.consumedSeq),
          ]),
        );
        return {
          ...(input.consumedSeqByLane === undefined
            ? {}
            : { consumedSeqByLane: input.consumedSeqByLane }),
          fetchedAt: TEST_NOW,
          items: request.lanes.flatMap((lane) => {
            const importedSeq = BigInt(lane.importedSeq);
            const consumedSeq = consumedSeqByLane.get(lane.lane);
            const afterSeq =
              lane.lane === "conversation"
              && consumedSeq !== undefined
              && input.consumedSeqByLane !== undefined
              && consumedSeq < importedSeq
                ? consumedSeq
                : importedSeq;
            const replayGap = importedSeq > afterSeq ? importedSeq - afterSeq : 0n;
            const limit = Math.min(
              request.limitPerLane + Number(replayGap > 100n ? 100n : replayGap),
              100,
            );
            const laneItems = input.items.filter((item) => {
              return lane.lane === item.lane;
            });
            const primaryItems = laneItems.filter((item) => {
              return lane.lane === item.lane && BigInt(item.laneSeq) > afterSeq;
            }).slice(0, limit);
            const needsFreshTail =
              lane.lane === "conversation"
              && consumedSeq !== undefined
              && input.consumedSeqByLane !== undefined
              && importedSeq > afterSeq
              && replayGap + BigInt(request.limitPerLane) > BigInt(limit);
            const freshItems = needsFreshTail
              ? laneItems.filter((item) => BigInt(item.laneSeq) > importedSeq)
                .slice(0, request.limitPerLane)
              : [];
            const seenIds = new Set(primaryItems.map((item) => item.id));
            return [
              ...primaryItems,
              ...freshItems.filter((item) => !seenIds.has(item.id)),
            ];
          }),
          maxSeqByLane: request.lanes.map((lane) => ({
            lane: lane.lane,
            maxSeq: input.items
              .filter((item) => item.lane === lane.lane)
              .reduce((maxSeq, item) =>
                BigInt(item.laneSeq) > BigInt(maxSeq) ? item.laneSeq : maxSeq,
              lane.importedSeq),
          })),
          userId: TEST_USER_ID,
        };
      });
    },
    async fetchPayload(
      request: HostedMailboxPayloadFetchRequest,
    ): Promise<HostedMailboxPayloadFetchResponse> {
      return await measureStage(input.stageSamples, "mailbox.fetchPayload", async () => ({
        fetchedAt: TEST_NOW,
        payload: {
          createdAt: TEST_NOW,
          mailboxItemId: request.mailboxItemId,
          payloadCiphertext: "ciphertext_synthetic_sidecar",
          payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
          userId: TEST_USER_ID,
        },
      }));
    },
  };
}

function createWorkspacePort(input: {
  checkpointRequests: HostedWorkspaceCheckpointRequest[];
  checkpointWorkspace?: (request: HostedWorkspaceCheckpointRequest) => HostedWorkspaceState;
  events: string[];
  stageSamples?: StageTimingSample[];
  workspace: HostedWorkspaceState | null;
}): HostedRuntimeWorkspacePort {
  return {
    async read(): Promise<HostedWorkspaceReadResponse> {
      return await measureStage(input.stageSamples, "workspace.read", async () => {
        input.events.push("workspace.read");
        return {
          fetchedAt: TEST_NOW,
          workspace: input.workspace,
        };
      });
    },
    async checkpoint(request): Promise<HostedWorkspaceCheckpointResponse> {
      return await measureStage(input.stageSamples, "workspace.checkpoint", async () => {
        input.events.push("workspace.checkpoint");
        input.checkpointRequests.push(request);
        return {
          checkpointed: true,
          workspace: input.checkpointWorkspace
            ? input.checkpointWorkspace(request)
            : createWorkspaceState({
                nextWakeAt: request.nextWakeAt ?? null,
                nextWakeReason: request.nextWakeReason ?? null,
                redactedStatus: request.redactedStatus ?? null,
                snapshotRef: request.snapshotRef,
                version: String(BigInt(request.expectedWorkspaceVersion) + 1n),
              }),
        };
      });
    },
  };
}

function createMailboxItem(overrides: Partial<HostedMailboxItem> = {}): HostedMailboxItem {
  return {
    createdAt: TEST_NOW,
    dedupeKey: `dedupe_${overrides.id ?? "mailbox_item_entrypoint_001"}`,
    expiresAt: null,
    id: "mailbox_item_entrypoint_001",
    kind: "conversation.message",
    lane: "conversation",
    laneSeq: "1",
    occurredAt: TEST_NOW,
    payloadBytes: 128,
    payloadInlineCiphertext: "ciphertext_synthetic_inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    ...overrides,
  };
}

async function stageAssistantInputEventForMailboxItem(input: {
  item: HostedMailboxItem;
  vaultRoot: string;
}): Promise<string> {
  const text = "entrypoint hosted mailbox input";
  const staged = await upsertAssistantInputEvent({
    event: {
      content: {
        text,
        transcriptText: text,
        userMessageContent: [
          {
            text,
            type: "text" as const,
          },
        ],
      },
      conversation: {
        accountId: "acct_1",
        actorId: "actor_1",
        actorIsSelf: false,
        source: "linq",
        threadId: "thread_1",
        threadIsDirect: true,
      },
      occurredAt: input.item.occurredAt,
      receivedAt: input.item.createdAt,
      replyTarget: {
        channel: "linq",
        messageId: `msg_${input.item.id}`,
        threadId: "thread_1",
      },
      sourceRef: {
        dedupeKey: input.item.dedupeKey,
        eventId: input.item.dedupeKey,
        itemId: input.item.id,
        kind: "hosted-mailbox" as const,
        lane: "conversation" as const,
        laneSeq: input.item.laneSeq,
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        payloadSource: input.item.payloadInlineCiphertext ? "inline" as const : "sidecar" as const,
        source: "hosted-mailbox" as const,
        wakeSchema: "murph.hosted-execution-wake.v1",
      },
    },
    vault: input.vaultRoot,
  });

  return staged.inputId;
}

function createWorkspaceRunRequest(
  overrides: Partial<HostedWorkspaceInvocationRequest> = {},
): HostedWorkspaceInvocationRequest {
  return {
    attemptId: "attempt_synthetic_workspace_run",
    idleCheckpointDelayMs: 1,
    leaseGeneration: "1",
    userId: TEST_USER_ID,
    workspaceVersion: "0",
    ...overrides,
  };
}

function createWorkspaceRuntimeJobInput(input: {
  commitTimeoutMs?: number | null;
  forwardedEnv?: Readonly<Record<string, string>>;
  resolvedConfig?: HostedAssistantRuntimeResolvedConfig;
  request?: Partial<HostedWorkspaceInvocationRequest>;
} = {}): HostedAssistantWorkspaceRuntimeJobInput {
  return {
    request: createWorkspaceRunRequest(input.request),
    runtime: {
      ...(input.commitTimeoutMs === undefined ? {} : { commitTimeoutMs: input.commitTimeoutMs }),
      forwardedEnv: {
        ...TEST_HOSTED_CODEX_FORWARDED_ENV,
        ...(input.forwardedEnv ?? {}),
      },
      ...(input.resolvedConfig === undefined ? {} : { resolvedConfig: input.resolvedConfig }),
    },
  };
}

function createWorkspaceState(overrides: Partial<HostedWorkspaceState> = {}): HostedWorkspaceState {
  return {
    checkpointedAt: TEST_NOW,
    createdAt: TEST_NOW,
    nextWakeAt: null,
    nextWakeReason: null,
    redactedStatus: null,
    snapshotRef: null,
    updatedAt: TEST_NOW,
    userId: TEST_USER_ID,
    version: "0",
    ...overrides,
  };
}

function createDeviceSyncResolvedConfig(): HostedAssistantRuntimeResolvedConfig {
  return {
    channelCapabilities: {
      emailSendReady: false,
      telegramBotConfigured: false,
      whatsappCloudApiConfigured: false,
    },
    deviceSync: {
      providerConfigs: {
        whoop: {
          baseUrl: "https://whoop.example.test",
          clientId: "synthetic-whoop-client",
          clientSecret: "synthetic-whoop-secret",
        },
      },
      publicBaseUrl: "https://device-sync.example.test",
      secret: "synthetic-device-sync-secret",
    },
  };
}

function createSnapshotDeviceSyncPort(input: {
  connectionId: string;
  nextReconcileAt: string;
}): HostedRuntimeDeviceSyncPort & { readonly fetchSnapshotCalls: number } {
  let fetchSnapshotCalls = 0;
  return {
    async ackDirtyStateProcessed() {
      throw new Error("Device sync dirty ack should not run in this e2e.");
    },
    async applyUpdates(request) {
      return {
        appliedAt: request.occurredAt ?? new Date().toISOString(),
        updates: [],
        userId: TEST_USER_ID,
      };
    },
    async createConnectLink() {
      throw new Error("Device sync connect link should not run in this e2e.");
    },
    async fetchDirtyStates() {
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: TEST_USER_ID,
      };
    },
    async fetchSnapshot() {
      fetchSnapshotCalls += 1;
      return {
        connections: [
          {
            connection: {
              accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
              connectedAt: TEST_NOW,
              createdAt: TEST_NOW,
              displayName: "Synthetic WHOOP",
              externalAccountId: "synthetic-whoop-account",
              id: input.connectionId,
              metadata: {},
              provider: "whoop",
              scopes: ["offline", "read:recovery", "read:sleep", "read:workout"],
              status: "active",
              updatedAt: TEST_NOW,
            },
            credential: {
              kind: "oauth_tokens",
              tokenBundle: {
                accessToken: "synthetic-access-token",
                accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
                keyVersion: "synthetic-key-version",
                refreshToken: "synthetic-refresh-token",
                tokenVersion: 1,
              },
            },
            localState: {
              lastErrorCode: null,
              lastErrorMessage: null,
              lastSyncCompletedAt: null,
              lastSyncErrorAt: null,
              lastSyncStartedAt: null,
              lastWebhookAt: null,
              nextReconcileAt: input.nextReconcileAt,
            },
          },
        ],
        generatedAt: TEST_NOW,
        userId: TEST_USER_ID,
      };
    },
    get fetchSnapshotCalls() {
      return fetchSnapshotCalls;
    },
  };
}

function createEmptyDeviceSyncPort(): HostedRuntimeDeviceSyncPort & {
  readonly fetchDirtyStatesCalls: number;
  readonly fetchSnapshotCalls: number;
} {
  let fetchDirtyStatesCalls = 0;
  let fetchSnapshotCalls = 0;
  return {
    async ackDirtyStateProcessed() {
      throw new Error("Device sync dirty ack should not run in this e2e.");
    },
    async applyUpdates(request) {
      assert.deepEqual(request.updates, []);
      return {
        appliedAt: request.occurredAt ?? new Date().toISOString(),
        updates: [],
        userId: TEST_USER_ID,
      };
    },
    async createConnectLink() {
      throw new Error("Device sync connect link should not run in this e2e.");
    },
    async fetchDirtyStates() {
      fetchDirtyStatesCalls += 1;
      return {
        hasMore: false,
        items: [],
        nextWakeAt: null,
        userId: TEST_USER_ID,
      };
    },
    async fetchSnapshot() {
      fetchSnapshotCalls += 1;
      return {
        connections: [],
        generatedAt: TEST_NOW,
        userId: TEST_USER_ID,
      };
    },
    get fetchDirtyStatesCalls() {
      return fetchDirtyStatesCalls;
    },
    get fetchSnapshotCalls() {
      return fetchSnapshotCalls;
    },
  };
}

async function assertPrivateDirectoryMode(directoryPath: string): Promise<void> {
  const directoryMode = (await stat(directoryPath)).mode & 0o777;
  assert.equal(directoryMode, 0o700);
}

function createBundleRef(input: {
  hash: string;
  key: string;
  size: number;
}): HostedExecutionBundleRef {
  return {
    hash: input.hash,
    key: input.key,
    size: input.size,
    updatedAt: TEST_NOW,
  };
}

async function removeTempRoot(root: string): Promise<void> {
  await rm(root, {
    force: true,
    maxRetries: 3,
    recursive: true,
    retryDelay: 50,
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    reject,
    resolve,
  };
}

async function waitUntil(assertion: () => void, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

describe("hosted runtime shutdown signal", () => {
  test("an already-signalled shutdown checkpoints immediately instead of waiting out the idle window", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_signal_pre",
            // Far longer than the test timeout: only the shutdown signal can
            // start the idle checkpoint this fast.
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-signal-pre.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            shutdownController.abort(
              new DOMException("Synthetic container SIGTERM.", "AbortError"),
            );
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);

  test("a shutdown signalled mid-wait interrupts the idle window and checkpoints", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-workspace-entrypoint-"));
    const checkpointRequests: HostedWorkspaceCheckpointRequest[] = [];
    const events: string[] = [];
    const shutdownController = new AbortController();

    try {
      await initializeVault({ createdAt: TEST_NOW, vaultRoot });

      const result = await runHostedWorkspaceRuntimeJobInProcess(
        createWorkspaceRuntimeJobInput({
          request: {
            attemptId: "attempt_synthetic_shutdown_signal_mid",
            idleCheckpointDelayMs: 120_000,
            leaseGeneration: "7",
            userId: TEST_USER_ID,
            workspaceVersion: "0",
          },
        }),
        {
          async createCheckpointSnapshot() {
            return {
              snapshotRef: createBundleRef({
                hash: "f".repeat(64),
                key: "users/bundles/member-synthetic/shutdown-signal-mid.bundle.json",
                size: 512,
              }),
            };
          },
          async importItem() {
            return { status: "imported" };
          },
          platform: createPlatform({
            mailboxPort: createMailboxPort({
              events,
              items: [createMailboxItem({ laneSeq: "1" })],
            }),
            workspacePort: createWorkspacePort({
              checkpointRequests,
              events,
              workspace: createWorkspaceState({ version: "0" }),
            }),
          }),
          async runAssistantPhase() {
            setTimeout(() => {
              shutdownController.abort(
                new DOMException("Synthetic container SIGTERM.", "AbortError"),
              );
            }, 50);
            return {
              checkpointReason: "assistant_runtime_commit",
              progressed: true,
            };
          },
          shutdownSignal: shutdownController.signal,
          vaultRoot,
        },
      );

      assert.equal(checkpointRequests[0]?.reason, "idle_shutdown");
      assert.equal(result.status, "idle");
    } finally {
      await removeTempRoot(vaultRoot);
    }
  }, 30_000);
});
