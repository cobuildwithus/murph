import { createDecipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listHostedBundleArtifacts,
  readHostedBundleTextFile,
  createHostedPortableWorkspaceManifestFromBundle,
  HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
  HOSTED_PORTABLE_WORKSPACE_MANIFEST_RELATIVE_PATH,
  HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  readHostedPortableWorkspaceManifestFromBundle,
  sha256HostedBundleHex,
  snapshotHostedExecutionContext,
  snapshotHostedPortableWorkspaceDelta,
  writeHostedBundleTextFile,
  writeHostedWorkspaceSkippedInlineFiles,
} from "@murphai/runtime-state/node";
import {
  HOSTED_WORKSPACE_CHECKPOINT_REASONS,
  HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
  HOSTED_MAILBOX_PAYLOAD_SCHEMA,
  type HostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedExecutionLinqConversationMessageWake,
  buildHostedExecutionTelegramConversationMessageWake,
} from "@murphai/hosted-execution";
import {
  recordHostedMaterializedArtifactPaths,
  type HostedWorkspaceRuntimeJobOptions,
} from "@murphai/assistant-runtime";
import {
  HostedRuntimeBridgeCheckpointLeaseError,
  createHostedWorkspaceRuntimeBridgeJobOptions as createPackageHostedWorkspaceRuntimeBridgeJobOptions,
  type HostedWorkspaceMailboxPayloadDecoder,
  type HostedWorkspaceRuntimeBridgeOptionsInput,
} from "@murphai/assistant-runtime/hosted-invocation-testkit";
import {
  HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
} from "@murphai/hosted-execution/bundles";
import {
  buildHostedWorkspaceSnapshotV2Aad,
  encodeHostedWorkspaceSnapshotV2DataKey,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_REF_SCHEMA,
  HOSTED_WORKSPACE_SNAPSHOT_UPLOAD_KIND,
  HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
  HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME,
  HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA,
  serializeHostedWorkspaceSnapshotV2Aad,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";

import {
  createCloudflareHostedWorkspaceSnapshotArchiveBuilder,
} from "../src/workspace-snapshot-archive-builder.ts";
import {
  hostedWorkspaceSnapshotObjectKey,
} from "../src/storage-paths.ts";

const cleanupPaths: string[] = [];
const TEST_SNAPSHOT_PATH_HASH_SECRET = "a".repeat(64);
const workspaceSnapshotEncryptionScheme:
  typeof HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME =
    HOSTED_WORKSPACE_SNAPSHOT_V2_ENCRYPTION_SCHEME;
type TestHostedWorkspaceRuntimeBridgeOptionsInput = Omit<
  HostedWorkspaceRuntimeBridgeOptionsInput,
  "decodeMailboxPayload" | "snapshotArchiveBuilder" | "waitForBackgroundAssistantWork"
> & {
  decodeMailboxPayload?: HostedWorkspaceMailboxPayloadDecoder;
  requireMailboxPayloadDecoder?: boolean;
  snapshotArchiveBuilder?: HostedWorkspaceRuntimeBridgeOptionsInput["snapshotArchiveBuilder"];
  waitForBackgroundAssistantWork?: HostedWorkspaceRuntimeBridgeOptionsInput["waitForBackgroundAssistantWork"];
};

const blockedMailboxPayloadDecoder: HostedWorkspaceMailboxPayloadDecoder = {
  async decode() {
    return {
      reasonCode: "test.mailbox_payload_decoder_not_configured",
      retryable: false,
      status: "blocked",
    };
  },
};

function createHostedWorkspaceRuntimeBridgeJobOptions(
  input: TestHostedWorkspaceRuntimeBridgeOptionsInput,
): HostedWorkspaceRuntimeJobOptions {
  return createPackageHostedWorkspaceRuntimeBridgeJobOptions({
    ...input,
    decodeMailboxPayload: input.requireMailboxPayloadDecoder === true
      ? input.decodeMailboxPayload
      : input.decodeMailboxPayload ?? blockedMailboxPayloadDecoder,
    snapshotArchiveBuilder:
      input.snapshotArchiveBuilder ?? createCloudflareHostedWorkspaceSnapshotArchiveBuilder(),
    waitForBackgroundAssistantWork:
      input.waitForBackgroundAssistantWork ?? (async () => {}),
  });
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, {
      force: true,
      recursive: true,
    })
  ));
});

describe("createHostedWorkspaceRuntimeBridgeJobOptions", () => {
  it("rejects every non-snapshot checkpoint reason before snapshot side effects", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const readWorkspace = vi.fn(async () => createWorkspaceReadResponse({ version: "7" }));
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const createOptions = () => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace,
        writeBrowserVaultReplica,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    for (const reason of HOSTED_WORKSPACE_CHECKPOINT_REASONS.filter((reason) =>
      reason !== "assistant_runtime_commit"
      && reason !== "canonical_runtime_commit"
      && reason !== "idle_shutdown"
    )) {
      await expect(createOptions().createCheckpointSnapshot(createCheckpointInput(reason)))
        .rejects.toThrow(
          "Hosted workspace snapshot construction is idle-shutdown only.",
        );
    }
    await expect(createOptions().createCheckpointSnapshot(
      // @ts-expect-error Older wire callers can still send this retired reason;
      createCheckpointInput("assistant_runtime_commit"),
    )).rejects.toThrow(
      "Hosted workspace snapshot construction is idle-shutdown only.",
    );

    expect(readWorkspace).not.toHaveBeenCalled();
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
  });

  it("rejects stale workspace versions before snapshot work", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({ version: "7" }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "6",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    let rejected: unknown = null;
    try {
      await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    } catch (error) {
      rejected = error;
    }

    expect(rejected).toBeInstanceOf(HostedRuntimeBridgeCheckpointLeaseError);
    expect(rejected).toMatchObject({
      code: "stale_workspace_version",
      stage: "before_snapshot",
    });
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("writes idle shutdown full compactions without the browser-vault replica port", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot,
    });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace changed\n", "utf8");
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        omitBrowserVaultReplicaPort: true,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
        workspaceSnapshotUploads,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(snapshotRef.objectKey).toMatch(/^users\/hsn_[0-9a-f]{24}\/workspace-snapshots\/snapshot_[A-Za-z0-9._-]+\.snapshot\.enc$/u);
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(putArtifact).not.toHaveBeenCalled();
    expect(workspaceSnapshotUploads.get(snapshotRef.objectKey)).toEqual(expect.objectContaining({
      encryptedByteSize: snapshotRef.archive.encryptedByteSize,
      encryptedObjectSha256: snapshotRef.archive.encryptedObjectSha256,
    }));
  });

  it("uploads idle shutdown snapshots as a single encrypted workspace object", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot,
    });
    const rawRoot = path.join(vaultRoot, "raw", "captures");
    await mkdir(rawRoot, { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      await writeFile(path.join(rawRoot, `capture-${index}.bin`), `artifact-${index}\n`, "utf8");
    }

    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
        workspaceSnapshotUploads,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(snapshotRef.archive.fileCount).toBeGreaterThanOrEqual(41);
    expect(workspaceSnapshotUploads.size).toBe(1);
    expect(workspaceSnapshotUploads.get(snapshotRef.objectKey)).toEqual(expect.objectContaining({
      encryptedByteSize: snapshotRef.archive.encryptedByteSize,
      encryptedObjectSha256: snapshotRef.archive.encryptedObjectSha256,
    }));
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("prunes runtime-owned operator-home symlinks before archiving v2 snapshots", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(operatorHomeRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt"),
      "runtime cache\n",
      "utf8",
    );
    await writeFile(path.join(workspaceRoot, "outside-runtime-cache.txt"), "outside target\n", "utf8");
    const runtimeSymlinkPath =
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "runtime-cache-link");
    await symlink(path.join(workspaceRoot, "outside-runtime-cache.txt"), runtimeSymlinkPath);
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotDirectPuts = vi.fn();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const uploaded = workspaceSnapshotUploads.get(snapshotRef.objectKey);

    expect(result.localWorkspaceCleanForWarmReuse).toBe(true);
    expect(uploaded).toBeDefined();
    const entries = listEncryptedWorkspaceSnapshotTarEntries(uploaded!.bytes, snapshotRef);
    expect(entries).toContain("vault/note.md");
    expect(entries).not.toContain("home/.codex-hosted/cache/runtime-cache.txt");
    expect(entries).not.toContain("home/.codex-hosted/cache/runtime-cache-link");
    await expect(lstat(runtimeSymlinkPath)).rejects.toThrow();
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_finished",
        redactedJson: expect.objectContaining({
          prunedRuntimeSymlinkCount: 1,
          runtimeSymlinkPruneScope: "operator-home",
          snapshotArchiveBuildElapsedMs: expect.any(Number),
          snapshotDirectR2PresignElapsedMs: expect.any(Number),
          snapshotDirectR2PutElapsedMs: expect.any(Number),
          snapshotDirectR2UploadElapsedMs: expect.any(Number),
          snapshotMode: "workspace_snapshot_v2",
          workspaceSnapshotFileCount: snapshotRef.archive.fileCount,
          workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
          workspaceSnapshotPlainBytes: snapshotRef.archive.totalPlainBytes,
        }),
      }),
    );
  });

  it("archives only portable v2 workspace state and explicit Codex continuity", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const providerSessionId = "00000000-0000-4000-8000-000000000041";
    const rolloutRelativePath =
      `sessions/2026/05/20/rollout-2026-05-20T01-02-03-${providerSessionId}.jsonl`;
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await mkdir(path.join(vaultRoot, ".runtime", "projections"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "cache"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "tmp"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".git"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", path.dirname(rolloutRelativePath)), {
      recursive: true,
    });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId,
          resumeRouteId: "route-ready",
        },
      }),
      "utf8",
    );
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite"), "projection\n", "utf8");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite-shm"), "projection-shm\n", "utf8");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "query.sqlite-wal"), "projection-wal\n", "utf8");
    await writeFile(path.join(vaultRoot, ".runtime", "projections", "inboxd.sqlite"), "other-projection\n", "utf8");
    await writeFile(path.join(vaultRoot, ".runtime", "cache", "cache.txt"), "cache\n", "utf8");
    await writeFile(path.join(vaultRoot, ".runtime", "tmp", "temp.txt"), "tmp\n", "utf8");
    await writeFile(path.join(vaultRoot, ".git", "config"), "git config\n", "utf8");
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"type\":\"session\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "runtime-cache.txt"),
      "runtime cache\n",
      "utf8",
    );
    await writeFile(
      path.join(
        operatorHomeRoot,
        ".codex-hosted",
        "sessions",
        "2026",
        "05",
        "20",
        "rollout-2026-05-20T01-02-03-00000000-0000-4000-8000-000000000042.jsonl",
      ),
      "{\"type\":\"unreferenced\"}\n",
      "utf8",
    );

    const putArtifact = vi.fn(async () => {});
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotUploads,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const uploaded = workspaceSnapshotUploads.get(snapshotRef.objectKey);

    expect(uploaded).toBeDefined();
    const entries = listEncryptedWorkspaceSnapshotTarEntries(uploaded!.bytes, snapshotRef);
    expect(entries).toContain("vault/note.md");
    expect(entries).toContain("vault/.runtime/operations/assistant/sessions/session.json");
    expect(entries).toContain(`home/.codex-hosted/${rolloutRelativePath}`);
    expect(entries).toContain("vault/.runtime/projections/query.sqlite");
    expect(entries).toContain("vault/.runtime/projections/query.sqlite-shm");
    expect(entries).toContain("vault/.runtime/projections/query.sqlite-wal");
    expect(entries).not.toContain("vault/.runtime/projections/inboxd.sqlite");
    expect(entries).not.toContain("vault/.runtime/cache/cache.txt");
    expect(entries).not.toContain("vault/.runtime/tmp/temp.txt");
    expect(entries).not.toContain("vault/.git/config");
    expect(entries).not.toContain("home/.codex-hosted/cache/runtime-cache.txt");
    expect(entries).not.toContain(
      "home/.codex-hosted/sessions/2026/05/20/rollout-2026-05-20T01-02-03-00000000-0000-4000-8000-000000000042.jsonl",
    );
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("rejects user-vault symlinks instead of silently dropping workspace state", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await symlink("note.md", path.join(vaultRoot, "note-link.md"));
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotDirectPuts = vi.fn();
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted workspace snapshot durable root contains symlinks.");

    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotDirectPuts).not.toHaveBeenCalled();
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          safeErrorDetail: "Hosted workspace snapshot durable root contains symlinks.",
          snapshotMode: "workspace_snapshot_v2",
        }),
      }),
    );
  });

  it("does not archive non-Codex operator-home symlinks", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(operatorHomeRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const operatorHomeSymlinkPath = path.join(operatorHomeRoot, "runtime-cache-link");
    await symlink("missing-runtime-cache", operatorHomeSymlinkPath);
    const putArtifact = vi.fn(async () => {});
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotDirectPuts = vi.fn();
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const uploaded = workspaceSnapshotUploads.get(snapshotRef.objectKey);

    expect((await lstat(operatorHomeSymlinkPath)).isSymbolicLink()).toBe(true);
    expect(uploaded).toBeDefined();
    expect(listEncryptedWorkspaceSnapshotTarEntries(uploaded!.bytes, snapshotRef))
      .not.toContain("home/runtime-cache-link");
    expect(workspaceSnapshotDirectPuts).toHaveBeenCalledOnce();
    expect(workspaceSnapshotAborts).toEqual([]);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("includes pruned runtime symlink counts when a later vault symlink fails snapshotting", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await mkdir(vaultRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const runtimeSymlinkPath =
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "runtime-cache-link");
    await symlink("missing-runtime-cache", runtimeSymlinkPath);
    await symlink("note.md", path.join(vaultRoot, "note-link.md"));
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotDirectPuts = vi.fn();
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted workspace snapshot durable root contains symlinks.");

    await expect(lstat(runtimeSymlinkPath)).rejects.toThrow();
    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotDirectPuts).not.toHaveBeenCalled();
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          prunedRuntimeSymlinkCount: 1,
          runtimeSymlinkPruneScope: "operator-home",
          safeErrorDetail: "Hosted workspace snapshot durable root contains symlinks.",
          snapshotMode: "workspace_snapshot_v2",
        }),
      }),
    );
  });

  it("rejects an operator-home root symlink before legacy materialization can write through it", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const externalHomeRoot = path.join(workspaceRoot, "external-home");
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(externalHomeRoot, { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await symlink(externalHomeRoot, path.join(durableRoot, "home"));
    const putArtifact = vi.fn(async () => {});
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotDirectPuts = vi.fn();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted workspace snapshot operator home root is a symlink.");

    expect(workspaceSnapshotDirectPuts).not.toHaveBeenCalled();
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("prunes operator-home symlinks before legacy materialization writes preserved files", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(workspaceRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const preservedProviderSessionId = "00000000-0000-4000-8000-000000000061";
    const preservedPath =
      `.codex-hosted/sessions/2026/05/20/rollout-2026-05-20T01-02-03-${preservedProviderSessionId}.jsonl`;
    const preservedBytes = Buffer.from("{\"preserved\":true}\n");
    const preservedHash = sha256HostedBundleHex(preservedBytes);
    const preservedTargetPath = path.join(operatorHomeRoot, ...preservedPath.split("/"));
    await mkdir(vaultRoot, { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await mkdir(path.dirname(preservedTargetPath), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: preservedPath.slice(".codex-hosted/".length),
          providerSessionId: preservedProviderSessionId,
          resumeRouteId: "route-ready",
        },
      }),
      "utf8",
    );
    await writeFile(path.join(workspaceRoot, "old-runtime-target.jsonl"), "{\"old\":true}\n");
    await symlink(path.join(workspaceRoot, "old-runtime-target.jsonl"), preservedTargetPath);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: [{
        path: preservedPath,
        root: "operator-home",
        sha256: preservedHash,
        size: preservedBytes.byteLength,
      }],
      vaultRoot,
    });
    const artifactBundles = new Map<string, Uint8Array>([
      [preservedHash, preservedBytes],
    ]);
    const baseSnapshotRef = createStoredManifestOnlySnapshotRef({
      artifactBundles,
      files: [{
        artifact: {
          byteSize: preservedBytes.byteLength,
          sha256: preservedHash,
        },
        path: preservedPath,
        root: "operator-home",
        sha256: preservedHash,
        size: preservedBytes.byteLength,
      }],
    });
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const uploaded = workspaceSnapshotUploads.get(snapshotRef.objectKey);

    expect(uploaded).toBeDefined();
    expect(await readFile(preservedTargetPath, "utf8")).toBe(preservedBytes.toString("utf8"));
    expect((await lstat(preservedTargetPath)).isSymbolicLink()).toBe(false);
    expect(listEncryptedWorkspaceSnapshotTarEntries(uploaded!.bytes, snapshotRef))
      .toContain(`home/${preservedPath}`);
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_finished",
        redactedJson: expect.objectContaining({
          prunedRuntimeSymlinkCount: 1,
          runtimeSymlinkPruneScope: "operator-home",
          snapshotMode: "workspace_snapshot_v2",
        }),
      }),
    );
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("fails before direct PUT at the single-part size guard", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "oversized.txt"), "size guard payload\n");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotLimits: {
          maxSinglePartEncryptedBytes: 16,
          warnEncryptedBytes: 1,
        },
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow(/size limit/u);

    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          safeErrorDetail: "Hosted workspace snapshot exceeds the configured size limit.",
          snapshotArchiveBuildElapsedMs: expect.any(Number),
          snapshotMode: "workspace_snapshot_v2",
        }),
      }),
    );
  });

  it("fails before direct PUT at the total plain size guard", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "oversized-plain.txt"), "");
    await truncate(path.join(vaultRoot, "oversized-plain.txt"), HOSTED_WORKSPACE_SNAPSHOT_MAX_TOTAL_PLAIN_BYTES);
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow(/total plain size limit/u);

    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          safeErrorDetail: "Hosted workspace snapshot exceeds the total plain size limit.",
          snapshotArchiveBuildElapsedMs: expect.any(Number),
          snapshotMode: "workspace_snapshot_v2",
        }),
      }),
    );
  });

  it("logs partial snapshot timing diagnostics when the direct R2 upload fails", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: () => {
          throw new Error("Hosted workspace snapshot direct R2 upload failed.", {
            cause: new Error(
              "fetch failed for https://r2.example.test/users/hsn_live/workspace-snapshots/snapshot_live.snapshot.enc?X-Amz-Signature=secret via /tmp/local-scratch",
            ),
          });
        },
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted workspace snapshot direct R2 upload failed.");

    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    const failureLog = entries.find((entry) =>
      typeof entry === "object"
      && entry !== null
      && "eventCode" in entry
      && entry.eventCode === "checkpoint.snapshot_failed");
    expect(failureLog).toEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_failed",
      redactedJson: expect.objectContaining({
        encryptedByteSize: expect.any(Number),
        safeErrorCause:
          "Hosted workspace snapshot direct R2 upload failed. | fetch failed for <redacted-url> via <redacted-path>",
        safeErrorDetail: "Hosted workspace snapshot direct R2 upload failed.",
        snapshotArchiveBuildElapsedMs: expect.any(Number),
        snapshotDirectR2UploadElapsedMs: expect.any(Number),
        snapshotElapsedMs: expect.any(Number),
        snapshotMode: "workspace_snapshot_v2",
        workspaceSnapshotFileCount: expect.any(Number),
        workspaceSnapshotPlainBytes: expect.any(Number),
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("snapshot_test_");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("hsn_live");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("snapshot_live");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("workspace-snapshots");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("X-Amz-Signature=secret");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("/tmp/local-scratch");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("encryptedObjectSha256");
  });

  it("keeps live raw files inside the encrypted v2 snapshot when legacy artifact refs are stale", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot);
    const rawPath = path.join("raw", "captures", "stale.bin");
    const rawBytes = Buffer.from("same live artifact bytes\n");
    await mkdir(path.join(baseVaultRoot, "raw", "captures"), { recursive: true });
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, rawPath), rawBytes);
    await writeFile(path.join(vaultRoot, rawPath), rawBytes);
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifactBundles.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot: baseVaultRoot,
    });
    const baseSnapshotHash = sha256HostedBundleHex(baseSnapshot.bundle);
    artifactBundles.set(baseSnapshotHash, baseSnapshot.bundle);
    const rawHash = sha256HostedBundleHex(rawBytes);
    artifactBundles.delete(rawHash);
    const baseSnapshotRef = {
      hash: baseSnapshotHash,
      key: `cloudflare-workspace-snapshots/${baseSnapshotHash}.bundle`,
      size: baseSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(artifactBundles.get(rawHash)).toBeUndefined();
    expect(putArtifact).not.toHaveBeenCalled();
    expect(workspaceSnapshotUploads.has(snapshotRef.objectKey)).toBe(true);
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toContainEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_finished",
      redactedJson: expect.objectContaining({
        snapshotMode: "workspace_snapshot_v2",
        workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
      }),
    }));
  });

  it("logs metadata-only diagnostics when legacy preserved artifact refs are unavailable", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot);
    const rawPath = path.join("raw", "captures", "missing.bin");
    const rawBytes = Buffer.from("missing preserved artifact bytes\n");
    await mkdir(path.join(baseVaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, rawPath), rawBytes);
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshot = await snapshotHostedExecutionContext({
      artifactSink: async (artifact) => {
        artifactBundles.set(artifact.ref.sha256, artifact.bytes);
      },
      vaultRoot: baseVaultRoot,
    });
    const baseSnapshotHash = sha256HostedBundleHex(baseSnapshot.bundle);
    artifactBundles.set(baseSnapshotHash, baseSnapshot.bundle);
    const rawHash = sha256HostedBundleHex(rawBytes);
    artifactBundles.delete(rawHash);
    const baseSnapshotRef = {
      hash: baseSnapshotHash,
      key: `cloudflare-workspace-snapshots/${baseSnapshotHash}.bundle`,
      size: baseSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    };
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "7",
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(putArtifact).not.toHaveBeenCalled();
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toContainEqual(expect.objectContaining({
      attemptId: "attempt_1",
      component: "workspace",
      eventCode: "checkpoint.snapshot_finished",
      leaseGeneration: "4",
      level: "info",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        snapshotMode: "workspace_snapshot_v2",
        workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
      }),
      workspaceVersion: "7",
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain(rawPath);
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain(rawHash);
  });

  it("writes full seed checkpoints when there is no base snapshot", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "outbox", "intent.json"),
      "{\"intent\":\"ready\"}\n",
      "utf8",
    );
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeBrowserVaultReplica = vi.fn(async (input: { replica: unknown }) =>
      createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(input.replica)));
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            checkpointedAt: null,
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: null,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "0",
          },
        }),
        writeBrowserVaultReplica,
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "0",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "0",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(snapshotRef.objectKey).toContain("/workspace-snapshots/");
    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeBrowserVaultReplica).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("browserVaultReplicaRef");
    expect(writeLog).toHaveBeenCalled();
  });

  it("snapshots idle shutdown state with dangling Codex resume diagnostics", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    cleanupPaths.push(vaultRoot, baseVaultRoot);
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot: baseVaultRoot,
    });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), {
      recursive: true,
    });
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          providerSessionId: "00000000-0000-4000-8000-000000000031",
          resumeRouteId: "route-ready",
        },
      }),
      "utf8",
    );
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: baseSnapshotRef,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "8",
          },
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(putArtifact).not.toHaveBeenCalled();
    expect(snapshotRef.objectKey).toContain("/workspace-snapshots/");
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).not.toContainEqual(
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
      }),
    );
  });

  it("fails idle shutdown compaction when current committed snapshot state is unavailable", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "local filesystem only\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const baseSnapshotRef = createBundleRef("e");
    const browserVaultReplicaRef = createBrowserVaultReplicaRef(baseSnapshotRef.hash);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          browserVaultReplicaRef,
          snapshotRef: baseSnapshotRef,
          version: "8",
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted workspace committed snapshot state is missing.");

    expect(putArtifact).not.toHaveBeenCalled();
    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toEqual([
      expect.objectContaining({
        eventCode: "checkpoint.snapshot_failed",
        redactedJson: expect.objectContaining({
          safeErrorDetail: "Hosted workspace committed snapshot state is missing.",
          snapshotMode: "workspace_snapshot_v2",
          snapshotStage: "plan",
        }),
      }),
    ]);
  });

  it("logs safe bundle validation detail when full compaction preserves an invalid artifact ref", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "local filesystem only\n", "utf8");
    const artifactBundles = new Map<string, Uint8Array>();
    const baseSnapshotRef = createStoredManifestOnlySnapshotRef({
      artifactBundles,
      files: [{
        artifact: {
          byteSize: 17,
          sha256: "not-a-valid-artifact-hash",
        },
        path: "raw/preserved-invalid.bin",
        root: "vault",
        sha256: "not-a-valid-artifact-hash",
        size: 17,
      }],
    });
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: baseSnapshotRef,
          version: "8",
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(putArtifact).not.toHaveBeenCalled();
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toContainEqual(expect.objectContaining({
      attemptId: "attempt_1",
      component: "workspace",
      eventCode: "checkpoint.snapshot_finished",
      leaseGeneration: "4",
      level: "info",
      phase: "checkpoint",
      redactedJson: expect.objectContaining({
        snapshotMode: "workspace_snapshot_v2",
        workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
      }),
      workspaceVersion: "8",
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("raw/preserved-invalid.bin");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("not-a-valid-artifact-hash");
  });

  it("aborts idle shutdown full snapshot publication when the checkpoint lease goes stale", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(path.join(vaultRoot, "raw", "captures", "large.bin"), new Uint8Array(512 * 1024));
    const putArtifact = vi.fn(async () => {});
    let leaseReadCount = 0;
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact,
      }),
      readCurrentLease: () => {
        leaseReadCount += 1;
        return {
          attemptId: leaseReadCount > 1 ? "attempt_stale" : "attempt_1",
          leaseGeneration: "4",
          userId: "member_1",
          workspaceVersion: "8",
        };
      },
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow("Hosted runtime bridge checkpoint lease validation failed before_direct_r2_put.");

    expect(leaseReadCount).toBe(2);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("completes direct R2 snapshot publication after upload when the lease stays current", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    let leaseReadCount = 0;
    const workspaceSnapshotDirectPuts = vi.fn();
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => {
        leaseReadCount += 1;
        return {
          attemptId: "attempt_1",
          leaseGeneration: "4",
          userId: "member_1",
          workspaceVersion: "7",
        };
      },
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(
      createCheckpointInput("idle_shutdown"),
    );

    expect(result.snapshotRef).not.toBeNull();
    expect(leaseReadCount).toBe(3);
    expect(workspaceSnapshotDirectPuts).toHaveBeenCalledOnce();
    expect(workspaceSnapshotUploads.size).toBe(1);
    expect(workspaceSnapshotAborts).toEqual([]);
    expect(putArtifact).not.toHaveBeenCalled();
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).toContainEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_finished",
    }));
    expect(entries).not.toContainEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_failed",
    }));
  });

  it("aborts an uploaded direct R2 snapshot when the lease changes before web checkpoint", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const putArtifact = vi.fn(async () => {});
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const workspaceSnapshotAborts: Array<{ objectKey: string; snapshotId: string }> = [];
    let leaseReadCount = 0;
    const workspaceSnapshotDirectPuts = vi.fn();
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        onWorkspaceSnapshotDirectPut: workspaceSnapshotDirectPuts,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: null,
          version: "7",
        }),
        workspaceSnapshotAborts,
        workspaceSnapshotUploads,
        writeLog,
      }),
      readCurrentLease: () => {
        leaseReadCount += 1;
        return {
          attemptId: leaseReadCount === 3 ? "attempt_stale" : "attempt_1",
          leaseGeneration: "4",
          userId: "member_1",
          workspaceVersion: "7",
        };
      },
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown")))
      .rejects.toThrow(
        "Hosted runtime bridge checkpoint lease validation failed before_web_checkpoint.",
      );

    expect(leaseReadCount).toBe(3);
    expect(workspaceSnapshotDirectPuts).toHaveBeenCalledOnce();
    expect(workspaceSnapshotUploads.size).toBe(0);
    expect(workspaceSnapshotAborts).toEqual([
      expect.objectContaining({
        snapshotId: expect.stringMatching(/^snapshot_test_/u),
      }),
    ]);
    expect(putArtifact).not.toHaveBeenCalled();
    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    expect(entries).not.toContainEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_finished",
    }));
    expect(entries).toContainEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_failed",
      redactedJson: expect.objectContaining({
        errorCode: "checkpoint_error",
        leaseCheckCount: 3,
        snapshotDirectR2PresignElapsedMs: expect.any(Number),
        snapshotDirectR2PutElapsedMs: expect.any(Number),
        snapshotMode: "workspace_snapshot_v2",
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("snapshot_test_");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("workspace-snapshots");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("encryptedObjectSha256");
  });

  it("compacts legacy working refs during idle shutdown into a direct full snapshot", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, vaultRoot);
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    await writeFile(path.join(vaultRoot, "note.md"), "latest working state\n", "utf8");

    const artifactBundles = new Map<string, Uint8Array>();
    const legacyWorkingRef = await createLegacyWorkingSnapshotFixture({
      artifactBundles,
      baseVaultRoot,
      vaultRoot,
    });

    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: legacyWorkingRef,
          version: "8",
        }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    expect(snapshotRef.schema).toBe(HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("compacts legacy layered refs with hot preserved inline files into a direct full snapshot", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const hotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-hot-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, hotVaultRoot, vaultRoot);
    const preservedPath = path.join("raw", "layered-preserved.txt");
    const preservedBytes = Buffer.from("layered hot preserved\n");
    await mkdir(path.join(hotVaultRoot, "raw"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    await writeFile(path.join(hotVaultRoot, preservedPath), preservedBytes);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: [{
        path: preservedPath,
        root: "vault",
        sha256: sha256HostedBundleHex(preservedBytes),
        size: preservedBytes.byteLength,
      }],
      vaultRoot,
    });

    const artifactBundles = new Map<string, Uint8Array>();
    const legacyLayeredRef = await createLegacyLayeredSnapshotFixture({
      artifactBundles,
      baseVaultRoot,
      externalizeHotArtifacts: false,
      hotVaultRoot,
    });
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const workspaceSnapshotUploads = new Map<string, WorkspaceSnapshotUpload>();
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: legacyLayeredRef,
          version: "8",
        }),
        workspaceSnapshotUploads,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    const uploaded = workspaceSnapshotUploads.get(snapshotRef.objectKey);
    expect(uploaded).toBeDefined();
    const entries = listEncryptedWorkspaceSnapshotTarEntries(uploaded!.bytes, snapshotRef);
    expect(entries).toContain("raw/layered-preserved.txt");
    expect(entries).not.toContain(".runtime/cache/hosted-skipped-inline-files.json");
    expect(snapshotRef.schema).toBe(HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("drops preserved raw inline files after targeted materialization", async () => {
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    const hotVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-hot-workspace-"));
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(baseVaultRoot, hotVaultRoot, vaultRoot);
    const preservedPath = path.join("raw", "inbox", "example", "scan.txt");
    const preservedBytes = Buffer.from("materialized hot raw\n");
    await mkdir(path.join(hotVaultRoot, "raw", "inbox", "example"), { recursive: true });
    await writeFile(path.join(baseVaultRoot, "note.md"), "committed base\n", "utf8");
    await writeFile(path.join(hotVaultRoot, preservedPath), preservedBytes);
    await writeHostedWorkspaceSkippedInlineFiles({
      files: [{
        path: preservedPath,
        root: "vault",
        sha256: sha256HostedBundleHex(preservedBytes),
        size: preservedBytes.byteLength,
      }],
      vaultRoot,
    });
    await recordHostedMaterializedArtifactPaths({
      materializedArtifactPaths: new Set([`vault:${preservedPath}`]),
      vaultRoot,
    });
    await writeFile(path.join(vaultRoot, "note.md"), "materialized latest\n", "utf8");

    const artifactBundles = new Map<string, Uint8Array>();
    const legacyLayeredRef = await createLegacyLayeredSnapshotFixture({
      artifactBundles,
      baseVaultRoot,
      hotVaultRoot,
    });
    const putArtifact = vi.fn(async ({ bytes, sha256 }) => {
      artifactBundles.set(sha256, bytes);
    });
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact,
        readWorkspace: async () => createWorkspaceReadResponse({
          snapshotRef: legacyLayeredRef,
          version: "8",
        }),
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "8",
      },
      runtime: {},
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);
    expect(snapshotRef.schema).toBe(HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA);
    expect(putArtifact).not.toHaveBeenCalled();
  });

  it("logs hashed Codex home snapshot diagnostics when checkpointing", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    const baseVaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-base-workspace-"));
    cleanupPaths.push(workspaceRoot, baseVaultRoot);
    const durableRoot = path.join(workspaceRoot, "durable");
    const vaultRoot = path.join(durableRoot, "vault");
    const operatorHomeRoot = path.join(durableRoot, "home");
    const threadId = "00000000-0000-4000-8000-000000000004";
    const rolloutRelativePath =
      `sessions/2026/05/06/rollout-2026-05-06T01-02-03-${threadId}.jsonl`;
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "sessions", "2026", "05", "06"), { recursive: true });
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "cache"), { recursive: true });
    await mkdir(path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"), { recursive: true });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", rolloutRelativePath),
      "{\"rollout\":\"kept\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      JSON.stringify({
        resumeState: {
          codexRolloutRelativePath: rolloutRelativePath,
          providerSessionId: threadId,
          resumeRouteId: "route-test",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "cache", "scratch.json"),
      "{\"cache\":true}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", ".env"),
      "SHOULD_NOT_APPEAR=1\n",
      "utf8",
    );
    const artifactBundles = new Map<string, Uint8Array>();
    await writeFile(path.join(baseVaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    const baseSnapshotRef = await createStoredBaseSnapshotRef({
      artifactBundles,
      vaultRoot: baseVaultRoot,
    });
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        getArtifact: async (hash) => artifactBundles.get(hash) ?? null,
        putArtifact: async ({ bytes, sha256 }) => {
          artifactBundles.set(sha256, bytes);
        },
        readWorkspace: async () => ({
          fetchedAt: "2026-05-01T00:00:00.000Z",
          workspace: {
            browserVaultReplicaRef: null,
            checkpointedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
            nextWakeAt: null,
            nextWakeReason: null,
            redactedStatus: null,
            snapshotRef: baseSnapshotRef,
            updatedAt: "2026-05-01T00:00:00.000Z",
            userId: "member_1",
            version: "7",
          },
        }),
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      snapshotDiagnosticsHashSecret: TEST_SNAPSHOT_PATH_HASH_SECRET,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    expect(writeLog.mock.calls.flatMap(([request]) => request.entries)).toContainEqual(
      expect.objectContaining({
        attemptId: "attempt_1",
        component: "workspace",
        eventCode: "checkpoint.snapshot_finished",
        leaseGeneration: "4",
        level: "info",
        phase: "checkpoint",
        redactedJson: expect.objectContaining({
          checkpointReason: "idle_shutdown",
          snapshotMode: "workspace_snapshot_v2",
          workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
        }),
        workspaceVersion: "7",
      }),
    );
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain(threadId);
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("SHOULD_NOT_APPEAR");
  });

  it("logs redacted full checkpoint size diagnostics for idle shutdown snapshots", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const operatorHomeRoot = `${vaultRoot}-operator-home`;
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await mkdir(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions"),
      { recursive: true },
    );
    await mkdir(path.join(operatorHomeRoot, ".codex-hosted", "rollouts"), {
      recursive: true,
    });
    await writeFile(path.join(vaultRoot, "note.md"), "workspace snapshot\n", "utf8");
    await writeFile(
      path.join(vaultRoot, ".runtime", "operations", "assistant", "sessions", "session.json"),
      "{\"status\":\"active\"}\n",
      "utf8",
    );
    await writeFile(
      path.join(operatorHomeRoot, ".codex-hosted", "rollouts", "state.json"),
      "{\"state\":\"kept\"}\n",
      "utf8",
    );
    const rawArtifactBytes = 300 * 1024;
    await writeFile(
      path.join(vaultRoot, "raw", "captures", "large-video.bin"),
      new Uint8Array(rawArtifactBytes),
    );
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        workspaceSnapshotLimits: {
          warnEncryptedBytes: 1,
        },
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      snapshotDiagnosticsHashSecret: TEST_SNAPSHOT_PATH_HASH_SECRET,
      vaultRoot,
    });

    const result = await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));
    const snapshotRef = requireWorkspaceSnapshotV2Ref(result.snapshotRef);

    const entries = writeLog.mock.calls.flatMap(([request]) => request.entries);
    const snapshotLog = entries.find((entry) =>
      typeof entry === "object"
      && entry !== null
      && "eventCode" in entry
      && entry.eventCode === "checkpoint.snapshot_finished");
    expect(snapshotLog).toEqual(expect.objectContaining({
      eventCode: "checkpoint.snapshot_finished",
      redactedJson: expect.objectContaining({
        checkpointReason: "idle_shutdown",
        snapshotArchiveBuildElapsedMs: expect.any(Number),
        snapshotDirectR2PresignElapsedMs: expect.any(Number),
        snapshotDirectR2PutElapsedMs: expect.any(Number),
        snapshotDirectR2UploadElapsedMs: expect.any(Number),
        snapshotMode: "workspace_snapshot_v2",
        workspaceSnapshotEncryptedBytes: snapshotRef.archive.encryptedByteSize,
        workspaceSnapshotFileCount: snapshotRef.archive.fileCount,
        workspaceSnapshotPlainBytes: snapshotRef.archive.totalPlainBytes,
        workspaceSnapshotClassSummary: expect.arrayContaining([
          `class=raw,files=1,inlineBytes=${rawArtifactBytes},externalBytes=0,externalCount=0`,
          expect.stringMatching(
            /^class=runtime-assistant,files=[1-9]\d*,inlineBytes=\d+,externalBytes=0,externalCount=0$/u,
          ),
        ]),
        workspaceSnapshotExternalArtifactBytes: 0,
        workspaceSnapshotExternalArtifactCount: 0,
        workspaceSnapshotFingerprintStatus: "enabled",
        workspaceSnapshotIncludedFileCount: snapshotRef.archive.fileCount,
        workspaceSnapshotInlineBytes: snapshotRef.archive.totalPlainBytes,
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=307200,external=0,ext=\.bin,depth=3,relHash=h1_[a-f0-9]{24}$/u,
          ),
        ]),
        workspaceSnapshotMaxFileBytes: rawArtifactBytes,
        workspaceSnapshotMaxFileClass: "raw",
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("large-video");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("session.json");
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("state.json");
    const warningLogs = consoleWarn.mock.calls
      .map(([payload]) => typeof payload === "string" ? JSON.parse(payload) as unknown : null)
      .filter((payload) =>
        typeof payload === "object"
        && payload !== null
        && "message" in payload
        && payload.message === "Hosted workspace snapshot exceeded the warning threshold."
      );
    expect(warningLogs).toContainEqual(expect.objectContaining({
      details: expect.objectContaining({
        workspaceSnapshotClassSummary: expect.arrayContaining([
          `class=raw,files=1,inlineBytes=${rawArtifactBytes},externalBytes=0,externalCount=0`,
        ]),
        workspaceSnapshotFingerprintStatus: "enabled",
        workspaceSnapshotIncludedFileCount: snapshotRef.archive.fileCount,
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=307200,external=0,ext=\.bin,depth=3,relHash=h1_[a-f0-9]{24}$/u,
          ),
        ]),
        workspaceSnapshotMaxFileBytes: rawArtifactBytes,
        workspaceSnapshotMaxFileClass: "raw",
      }),
      level: "warn",
    }));
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("large-video");
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("session.json");
    expect(JSON.stringify(consoleWarn.mock.calls)).not.toContain("state.json");
  });

  it("does not enable snapshot path fingerprints from normalized runtime env", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(vaultRoot, "raw", "captures", "large-video.bin"), "raw\n", "utf8");
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {
        forwardedEnv: {
          HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-secret",
        },
        platformEnv: {
          HOSTED_LOG_FINGERPRINT_SECRET: "diagnostic-secret",
        },
      },
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const snapshotLog = writeLog.mock.calls
      .flatMap(([request]) => request.entries)
      .find((entry) =>
        typeof entry === "object"
        && entry !== null
        && "eventCode" in entry
        && entry.eventCode === "checkpoint.snapshot_finished");
    expect(snapshotLog).toEqual(expect.objectContaining({
      redactedJson: expect.objectContaining({
        workspaceSnapshotFingerprintStatus: "disabled",
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=4,external=0,ext=\.bin,depth=3,relHash=disabled$/u,
          ),
        ]),
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("large-video");
  });

  it("does not enable snapshot path fingerprints from malformed explicit diagnostics keys", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await mkdir(path.join(vaultRoot, "raw", "captures"), { recursive: true });
    await writeFile(path.join(vaultRoot, "raw", "captures", "large-video.bin"), "raw\n", "utf8");
    const writeLog = vi.fn(async (request) => ({
      loggedCount: request.entries.length,
    }));
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({
        putArtifact: async () => {},
        writeLog,
      }),
      readCurrentLease: () => ({
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: "member_1",
        workspaceVersion: "7",
      },
      runtime: {},
      snapshotDiagnosticsHashSecret: "diagnostic-secret",
      vaultRoot,
    });

    await options.createCheckpointSnapshot(createCheckpointInput("idle_shutdown"));

    const snapshotLog = writeLog.mock.calls
      .flatMap(([request]) => request.entries)
      .find((entry) =>
        typeof entry === "object"
        && entry !== null
        && "eventCode" in entry
        && entry.eventCode === "checkpoint.snapshot_finished");
    expect(snapshotLog).toEqual(expect.objectContaining({
      redactedJson: expect.objectContaining({
        workspaceSnapshotFingerprintStatus: "disabled",
        workspaceSnapshotLargestFiles: expect.arrayContaining([
          expect.stringMatching(
            /^class=raw,root=vault,bytes=4,external=0,ext=\.bin,depth=3,relHash=disabled$/u,
          ),
        ]),
      }),
    }));
    expect(JSON.stringify(writeLog.mock.calls)).not.toContain("large-video");
  });

  it("imports sidecar mailbox payloads through an explicit bridge decoder", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const item = {
      createdAt: "2026-05-01T00:00:00.000Z",
      dedupeKey: "event:member-channels-sidecar",
      expiresAt: null,
      id: "mailbox_item_bridge_sidecar",
      kind: "member.channels.updated" as const,
      lane: "system" as const,
      laneSeq: "1",
      occurredAt: "2026-05-01T00:00:00.000Z",
      payloadBytes: 128,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_sidecar",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_bridge_sidecar",
    };
    const wake = {
      eventId: item.dedupeKey,
      kind: item.kind,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      occurredAt: item.occurredAt,
      userId: item.userId,
    };
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({ putArtifact: async () => {} }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: item.userId,
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext: "opaque-sidecar-ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_sidecar",
        source: "sidecar",
        status: "resolved",
      },
      route: {
        action: "apply-member-channels-update",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    })).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });
    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith({
      itemRef: {
        dedupeKey: item.dedupeKey,
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        userId: item.userId,
      },
      payloadCiphertext: "opaque-sidecar-ciphertext",
      payloadRequestId: "request_bridge_sidecar",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "sidecar",
    });
  });

  it("prefers mailbox payload decoders over encryption readers for system mailbox imports", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const item = createSystemMailboxItem("member_bridge_decoder_system");
    const wake = {
      eventId: item.dedupeKey,
      kind: item.kind,
      memberChannels: {
        email: true,
        linq: false,
        telegram: false,
      },
      occurredAt: item.occurredAt,
      userId: item.userId,
    };
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({ putArtifact: async () => {} }),
      request: createBridgeRequest(item.userId),
      runtime: {
        platformEnv: {},
      },
      vaultRoot,
    });

    await expect(options.importItem(createSystemMailboxImportItem({
      item,
      payloadCiphertext: "opaque-ciphertext",
      payloadSource: "sidecar",
    }))).resolves.toEqual({
      reasonCode: "system_mailbox.queued",
      status: "imported",
    });

    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith({
      itemRef: {
        dedupeKey: item.dedupeKey,
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        userId: item.userId,
      },
      payloadCiphertext: "opaque-ciphertext",
      payloadRequestId: "request_bridge_decoder",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "sidecar",
    });
  });

  it("fails closed when mailbox decoding is required but no decoder is provided", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    expect(() => createHostedWorkspaceRuntimeBridgeJobOptions({
      platform: createPlatform({ putArtifact: async () => {} }),
      requireMailboxPayloadDecoder: true,
      request: createBridgeRequest("member_bridge_decoder_required"),
      runtime: {
        platformEnv: {
          HOSTED_RUNTIME_CRYPTO_CONTEXT_PRIVATE_JWK: "legacy-jwk",
        },
      },
      vaultRoot,
    })).toThrow("Hosted mailbox payload decoder is required for this invocation.");
  });

  it("imports conversation mailbox items with empty platform env when a decoder is provided", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    await writeFile(path.join(vaultRoot, "vault.json"), "{}", "utf8");
    const recordLatencyTrace = vi.fn(async () => ({
      matchedCount: 1,
      recorded: true,
      unmatchedCount: 0,
    }));
    const wake = buildHostedExecutionLinqConversationMessageWake({
      eventId: "evt_bridge_decoder_conversation",
      linqMessage: {
        chatId: "chat_bridge_decoder",
        from: "+15550100000",
        isFromMe: false,
        messageId: "msg_bridge_decoder",
        parts: [
          {
            type: "text",
            value: "hello",
          },
        ],
      },
      occurredAt: "2026-05-01T00:00:00.000Z",
      phoneLookupKey: "phone_lookup_bridge_decoder",
      userId: "member_bridge_decoder_conversation",
    });
    const item = createConversationMailboxItem(wake);
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({
        latencyTracePort: {
          record: recordLatencyTrace,
        },
        putArtifact: async () => {},
      }),
      request: createBridgeRequest(item.userId),
      runtime: {
        platformEnv: {},
      },
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext: "opaque-conversation-ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_decoder_conversation",
        source: "inline",
        status: "resolved",
      },
      route: {
        action: "import-conversation-message",
        advanceProgress: true,
        itemRef: {
          id: item.id,
          kind: item.kind,
          lane: item.lane,
          laneSeq: item.laneSeq,
        },
        state: "route",
      },
    }, {
      runtimeAttemptId: "attempt_1",
    })).resolves.toMatchObject({
      status: "imported",
    });

    expect(recordLatencyTrace).toHaveBeenCalledWith({
      event: expect.objectContaining({
        mailboxItemId: item.id,
        runtimeAttemptId: "attempt_1",
        source: "linq",
        type: "assistant_input_staged",
      }),
    });
    expect(decodeMailboxPayload.decode).toHaveBeenCalledWith({
      itemRef: {
        dedupeKey: item.dedupeKey,
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
        occurredAt: item.occurredAt,
        userId: item.userId,
      },
      payloadCiphertext: "opaque-conversation-ciphertext",
      payloadRequestId: "request_bridge_decoder_conversation",
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      payloadSource: "inline",
    });
  });

  it("captures server-owned return targets from decoded conversation wakes", async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-cloudflare-workspace-"));
    cleanupPaths.push(vaultRoot);
    const wake = buildHostedExecutionTelegramConversationMessageWake({
      eventId: "evt_bridge_return_target",
      occurredAt: "2026-05-01T00:00:00.000Z",
      telegramMessage: {
        messageId: "msg_bridge_return_target",
        schema: "murph.hosted-telegram-message.v1",
        text: "hello",
        threadId: "thread_bridge_return_target",
      },
      userId: "member_bridge_return_target",
    });
    const item = {
      createdAt: wake.occurredAt,
      dedupeKey: wake.eventId,
      expiresAt: null,
      id: "mailbox_item_bridge_return_target",
      kind: "conversation.message" as const,
      lane: "conversation" as const,
      laneSeq: "1",
      occurredAt: wake.occurredAt,
      payloadBytes: 256,
      payloadInlineCiphertext: null,
      payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_return_target",
      payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
      updatedAt: wake.occurredAt,
      userId: wake.userId,
    };
    const route = {
      action: "import-conversation-message",
      advanceProgress: true,
      itemRef: {
        id: item.id,
        kind: item.kind,
        lane: item.lane,
        laneSeq: item.laneSeq,
      },
      state: "route",
    } as const;
    const decodeMailboxPayload = {
      decode: vi.fn(async () => ({
        status: "decoded" as const,
        wake,
      })),
    };
    const recordedReturnTargets: Array<"imessage" | "telegram" | null> = [];
    const options = createHostedWorkspaceRuntimeBridgeJobOptions({
      decodeMailboxPayload,
      platform: createPlatform({ putArtifact: async () => {} }),
      request: {
        attemptId: "attempt_1",
        leaseGeneration: "4",
        userId: item.userId,
        workspaceVersion: "7",
      },
      runtime: {},
      vaultRoot,
    });

    await expect(options.importItem({
      item,
      payload: {
        payloadCiphertext: "opaque-return-target-ciphertext",
        payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
        requestId: "request_bridge_return_target",
        source: "inline",
        status: "resolved",
      },
      route,
    }, {
      recordMessagingReturnTarget(target) {
        recordedReturnTargets.push(target);
      },
    })).rejects.toThrow();

    expect(recordedReturnTargets).toEqual(["telegram"]);
  });

});

describe("workspace snapshot tar test helpers", () => {
  it("lists GNU tar long path entries by their expanded path", () => {
    const longPath =
      "home/.codex-hosted/sessions/2026/05/20/rollout-2026-05-20T01-02-03-00000000-0000-4000-8000-000000000041.jsonl";
    const archive = createTestTarArchive([
      createTestTarEntry({
        contents: `${longPath}\0`,
        name: "././@LongLink",
        typeflag: "L",
      }),
      createTestTarEntry({
        name: longPath.slice(0, 100),
        typeflag: "0",
      }),
    ]);

    expect(listTarArchiveEntries(archive)).toEqual([longPath]);
  });

  it("lists PAX path entries by their expanded path", () => {
    const paxPath =
      "home/.codex-hosted/sessions/2026/05/20/rollout-2026-05-20T01-02-03-00000000-0000-4000-8000-000000000041.jsonl";
    const archive = createTestTarArchive([
      createTestTarEntry({
        contents: createTestPaxRecord("path", paxPath),
        name: "./PaxHeaders.0/rollout",
        typeflag: "x",
      }),
      createTestTarEntry({
        name: "rollout.jsonl",
        typeflag: "0",
      }),
    ]);

    expect(listTarArchiveEntries(archive)).toEqual([paxPath]);
  });
});

function createBridgeRequest(userId: string) {
  return {
    attemptId: "attempt_1",
    leaseGeneration: "4",
    userId,
    workspaceVersion: "7",
  };
}

function createWorkspaceReadResponse(input: {
  browserVaultReplicaRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["browserVaultReplicaRef"];
  snapshotRef?: NonNullable<HostedWorkspaceReadResponse["workspace"]>["snapshotRef"];
  version?: string;
} = {}): HostedWorkspaceReadResponse {
  return {
    fetchedAt: "2026-05-01T00:00:00.000Z",
    workspace: {
      browserVaultReplicaRef: input.browserVaultReplicaRef ?? null,
      checkpointedAt: "2026-05-01T00:00:00.000Z",
      createdAt: "2026-05-01T00:00:00.000Z",
      nextWakeAt: null,
      nextWakeReason: null,
      redactedStatus: null,
      snapshotRef: input.snapshotRef ?? null,
      updatedAt: "2026-05-01T00:00:00.000Z",
      userId: "member_1",
      version: input.version ?? "7",
    },
  };
}

function createSystemMailboxItem(userId: string) {
  return {
    createdAt: "2026-05-01T00:00:00.000Z",
    dedupeKey: "event:member-channels-decoder",
    expiresAt: null,
    id: "mailbox_item_bridge_decoder",
    kind: "member.channels.updated" as const,
    lane: "system" as const,
    laneSeq: "1",
    occurredAt: "2026-05-01T00:00:00.000Z",
    payloadBytes: 128,
    payloadInlineCiphertext: null,
    payloadRef: "hosted-mailbox-payload:mailbox_item_bridge_decoder",
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: "2026-05-01T00:00:00.000Z",
    userId,
  };
}

function createConversationMailboxItem(
  wake: ReturnType<typeof buildHostedExecutionLinqConversationMessageWake>,
) {
  return {
    createdAt: wake.occurredAt,
    dedupeKey: wake.eventId,
    expiresAt: null,
    id: "mailbox_item_bridge_decoder_conversation",
    kind: "conversation.message" as const,
    lane: "conversation" as const,
    laneSeq: "1",
    occurredAt: wake.occurredAt,
    payloadBytes: 128,
    payloadInlineCiphertext: "inline",
    payloadRef: null,
    payloadSchema: HOSTED_MAILBOX_ITEM_PAYLOAD_SCHEMA,
    updatedAt: wake.occurredAt,
    userId: wake.userId,
  };
}

function createSystemMailboxImportItem(input: {
  item: ReturnType<typeof createSystemMailboxItem>;
  payloadCiphertext: string;
  payloadSource: "inline" | "sidecar";
}) {
  return {
    item: input.item,
    payload: {
      payloadCiphertext: input.payloadCiphertext,
      payloadSchema: HOSTED_MAILBOX_PAYLOAD_SCHEMA,
      requestId: "request_bridge_decoder",
      source: input.payloadSource,
      status: "resolved" as const,
    },
    route: {
      action: "apply-member-channels-update" as const,
      advanceProgress: true as const,
      itemRef: {
        id: input.item.id,
        kind: input.item.kind,
        lane: input.item.lane,
        laneSeq: input.item.laneSeq,
      },
      state: "route" as const,
    },
  };
}

function createCheckpointInput<
  const Reason extends (typeof HOSTED_WORKSPACE_CHECKPOINT_REASONS)[number],
>(reason: Reason) {
  const state = {
    recentStatuses: [],
    watermarks: {
      conversation: "0",
      system: "0",
    },
  };

  return {
    importResult: {
      blocked: [],
      consumedSeqByLane: {
        conversation: null,
        system: null,
      },
      fetchedCount: 0,
      importedCount: 0,
      state,
    },
    previousState: state,
    reason,
    redactedStatus: {},
    state,
  };
}

async function writeExperimentMarkdown(inputVaultRoot: string, input: {
  includeProtocolFields: boolean;
  relativePath: string;
}): Promise<void> {
  await mkdir(path.dirname(path.join(inputVaultRoot, input.relativePath)), {
    recursive: true,
  });
  await writeFile(
    path.join(inputVaultRoot, input.relativePath),
    createExperimentMarkdown({ includeProtocolFields: input.includeProtocolFields }),
    "utf8",
  );
}

function createExperimentMarkdown(input: { includeProtocolFields: boolean }): string {
  const protocolFields = input.includeProtocolFields
    ? `commonsProtocolRef:
  key: protocol_variant:dry-sauna/murph-finnish-standard-3x-week
  pageRevisionId: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  runSpecRevisionId: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  testPlanId: rhr-21d
effectiveProtocolSnapshot:
  effectiveSpecHash: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
  doseSignature: 15-20 min dry sauna, 3 sessions/week
  modality: dry sauna
  frequency:
    sessionsPerWeek: 3
  durationMinutes:
    min: 15
    max: 20
  targetSessions: 9
  minimumUsefulSessions: 6
`
    : "";

  return `---
schemaVersion: murph.frontmatter.experiment.v1
docType: experiment
experimentId: exp_01KQQYJGP8XF78MBXD9R2RAG14
slug: finnish-dry-sauna-may-2026
status: active
title: Finnish Dry Sauna May 2026
startedOn: "2026-05-01"
${protocolFields}---
# Finnish Dry Sauna May 2026

## Plan

Run the sauna protocol and review the resulting biomarker trend.
`;
}

function createPlatform(input: {
  getArtifact?: (hash: string) => Promise<Uint8Array | null>;
  latencyTracePort?: NonNullable<HostedWorkspaceRuntimeJobOptions["platform"]["latencyTracePort"]>;
  omitBrowserVaultReplicaPort?: boolean;
  putArtifact: (payload: { bytes: Uint8Array; sha256: string }) => Promise<void>;
  readWorkspace?: () => Promise<HostedWorkspaceReadResponse>;
  workspaceSnapshotLimits?: Partial<{
    maxSinglePartEncryptedBytes: number;
    warnEncryptedBytes: number;
  }>;
  workspaceSnapshotAborts?: Array<{ objectKey: string; snapshotId: string }>;
  onWorkspaceSnapshotDirectPut?: (request: {
    encryptedByteSize: number;
    encryptedObjectSha256: string;
    objectKey: string;
    sourceFilePath: string;
    snapshotId: string;
  }) => void;
  workspaceSnapshotUploads?: Map<string, WorkspaceSnapshotUpload>;
  writeBrowserVaultReplica?: (payload: { replica: unknown }) => Promise<ReturnType<typeof createBrowserVaultReplicaRef>>;
  writeLog?: (request: {
    entries: readonly unknown[];
  }) => Promise<{ loggedCount: number }>;
}) {
  const workspaceSnapshotUploads = input.workspaceSnapshotUploads ?? new Map<string, WorkspaceSnapshotUpload>();
  let workspaceSnapshotStartOrdinal = 0;
  return {
    artifactStore: {
      get: input.getArtifact ?? (async () => null),
      put: input.putArtifact,
    },
    ...(input.omitBrowserVaultReplicaPort
      ? {}
      : {
          browserVaultReplicaPort: {
            write: input.writeBrowserVaultReplica
              ?? (async (payload: { replica: unknown }) =>
                createBrowserVaultReplicaRef(readBrowserVaultReplicaSourceBundleHash(payload.replica))),
          },
        }),
    effectsPort: {
      readRawEmailMessage: async () => null,
      sendEmail: async () => undefined,
    },
    ...(input.latencyTracePort
      ? {
          latencyTracePort: input.latencyTracePort,
        }
      : {}),
    ...(input.writeLog
      ? {
          logPort: {
            write: input.writeLog,
          },
        }
      : {}),
    workspaceSnapshotPort: {
      completeSnapshotSession: async (request: {
        checkpointRequest: Parameters<NonNullable<HostedWorkspaceRuntimeJobOptions["platform"]["workspaceSnapshotPort"]>["completeSnapshotSession"]>[0]["checkpointRequest"];
        ref: HostedWorkspaceSnapshotV2Ref;
      }) => ({
        checkpoint: {
          checkpointed: true,
          workspace: createWorkspaceReadResponse({
            snapshotRef: request.ref,
            version: request.checkpointRequest.expectedWorkspaceVersion,
          }).workspace!,
        },
        snapshotRef: request.ref,
      }),
      putSnapshotObjectDirect: async (request: {
        encryptedByteSize: number;
        encryptedObjectSha256: string;
        objectKey: string;
        sourceFilePath: string;
        snapshotId: string;
      }) => {
        input.onWorkspaceSnapshotDirectPut?.(request);
        const bytes = await readFile(request.sourceFilePath);
        workspaceSnapshotUploads.set(request.objectKey, {
          bytes,
          encryptedByteSize: request.encryptedByteSize,
          encryptedObjectSha256: sha256HostedBundleHex(bytes),
          objectKey: request.objectKey,
          snapshotId: request.snapshotId,
        });
        return {
          snapshotDirectR2PresignElapsedMs: 3,
          snapshotDirectR2PutElapsedMs: 5,
        };
      },
      abortSnapshotSession: async (request: {
        objectKey: string;
        snapshotId: string;
      }) => {
        input.workspaceSnapshotAborts?.push(request);
        workspaceSnapshotUploads.delete(request.objectKey);
      },
      restoreWorkspaceSnapshot: async () => {
        throw new Error("Workspace snapshot restore is not used by bridge snapshot tests.");
      },
      startSnapshotSession: async (request: {
        expectedWorkspaceVersion: string;
        nextWakeAt?: string | null;
        nextWakeReason?: string | null;
        reason: "idle_shutdown";
      }) => {
        const snapshotId = `snapshot_test_${++workspaceSnapshotStartOrdinal}`;
        const objectKey = await hostedWorkspaceSnapshotObjectKey({
          snapshotId,
          userId: "member_1",
        });
        void request.nextWakeAt;
        void request.nextWakeReason;
        return {
          encryption: {
            aad: buildHostedWorkspaceSnapshotV2Aad({
              objectKey,
              snapshotId,
              userId: "member_1",
            }),
            dataKeyBase64: encodeHostedWorkspaceSnapshotV2DataKey(
              Uint8Array.from({ length: 32 }, (_, index) => index + 1),
            ),
            ivBase64: "AQIDBAUGBwgJCgsM",
            rootKeyId: "root_key_test",
            scheme: workspaceSnapshotEncryptionScheme,
            wrappedDataKey: "wrapped_data_key_test",
          },
          limits: {
            maxSinglePartEncryptedBytes:
              input.workspaceSnapshotLimits?.maxSinglePartEncryptedBytes
              ?? HOSTED_WORKSPACE_SNAPSHOT_MAX_SINGLE_PART_BYTES,
            warnEncryptedBytes:
              input.workspaceSnapshotLimits?.warnEncryptedBytes
              ?? HOSTED_WORKSPACE_SNAPSHOT_WARN_BYTES,
          },
          objectKey,
          snapshotId,
        };
      },
    },
    ...(input.readWorkspace
      ? {
          workspacePort: {
            checkpoint: async () => {
              throw new Error("Workspace checkpoint is not used by bridge snapshot tests.");
            },
            read: input.readWorkspace,
          },
        }
      : {}),
  };
}

interface WorkspaceSnapshotUpload {
  bytes: Uint8Array;
  encryptedByteSize: number;
  encryptedObjectSha256: string;
  objectKey: string;
  snapshotId: string;
}

function listEncryptedWorkspaceSnapshotTarEntries(
  encryptedObject: Uint8Array,
  snapshotRef: HostedWorkspaceSnapshotV2Ref,
): string[] {
  const encrypted = Buffer.from(encryptedObject);
  const authTag = encrypted.subarray(encrypted.byteLength - 16);
  const encryptedBody = encrypted.subarray(0, encrypted.byteLength - 16);
  const dataKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(dataKey),
      Buffer.from(snapshotRef.encryption.ivBase64, "base64url"),
    );
    decipher.setAAD(Buffer.from(serializeHostedWorkspaceSnapshotV2Aad(snapshotRef.encryption.aad)));
    decipher.setAuthTag(authTag);
    const archive = execFileSync("zstd", [
      "-d",
      "--stdout",
    ], {
      input: Buffer.concat([
        decipher.update(encryptedBody),
        decipher.final(),
      ]),
    });
    return listTarArchiveEntries(archive);
  } finally {
    dataKey.fill(0);
  }
}

function listTarArchiveEntries(archive: Buffer): string[] {
  const entries: string[] = [];
  let pendingLongPath: string | null = null;
  let pendingPaxPath: string | null = null;
  for (let offset = 0; offset + 512 <= archive.byteLength;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const name = readTarHeaderString(header, 0, 100);
    const prefix = readTarHeaderString(header, 345, 500);
    const sizeText = readTarHeaderString(header, 124, 136).trim();
    const size = sizeText.length === 0 ? 0 : Number.parseInt(sizeText, 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("Test tar archive entry size is invalid.");
    }
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.byteLength) {
      throw new Error("Test tar archive entry exceeds archive length.");
    }

    const typeflag = readTarHeaderString(header, 156, 157);
    const data = archive.subarray(dataStart, dataEnd);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (typeflag === "L") {
      pendingLongPath = readTarEntryDataString(data);
      continue;
    }
    if (typeflag === "K") {
      continue;
    }
    if (typeflag === "x") {
      pendingPaxPath = parsePaxTarHeader(data).path ?? pendingPaxPath;
      continue;
    }
    if (typeflag === "g") {
      continue;
    }

    const headerPath = prefix.length > 0 ? `${prefix}/${name}` : name;
    const entryPath = normalizeTestTarEntryPath(
      pendingPaxPath ?? pendingLongPath ?? headerPath,
    );
    pendingLongPath = null;
    pendingPaxPath = null;
    entries.push(entryPath);
  }
  return entries;
}

function normalizeTestTarEntryPath(entryPath: string): string {
  return entryPath.replace(/^\.\/+/u, "");
}

function readTarEntryDataString(data: Buffer): string {
  const nul = data.indexOf(0);
  return data.subarray(0, nul === -1 ? data.byteLength : nul).toString("utf8");
}

function parsePaxTarHeader(data: Buffer): Record<string, string> {
  const fields: Record<string, string> = {};
  const text = data.toString("utf8");
  for (let offset = 0; offset < text.length;) {
    const separatorIndex = text.indexOf(" ", offset);
    if (separatorIndex === -1) {
      throw new Error("Test tar pax header record is invalid.");
    }
    const length = Number.parseInt(text.slice(offset, separatorIndex), 10);
    if (!Number.isFinite(length) || length <= 0 || offset + length > text.length) {
      throw new Error("Test tar pax header length is invalid.");
    }
    const record = text.slice(separatorIndex + 1, offset + length - 1);
    const equalsIndex = record.indexOf("=");
    if (equalsIndex > 0) {
      fields[record.slice(0, equalsIndex)] = record.slice(equalsIndex + 1);
    }
    offset += length;
  }
  return fields;
}

function createTestTarArchive(entries: Buffer[]): Buffer {
  return Buffer.concat([
    ...entries,
    Buffer.alloc(1024),
  ]);
}

function createTestTarEntry(input: {
  contents?: string;
  name: string;
  typeflag: string;
}): Buffer {
  const contents = Buffer.from(input.contents ?? "", "utf8");
  const header = Buffer.alloc(512);
  header.write(input.name, 0, Math.min(Buffer.byteLength(input.name), 100), "utf8");
  header.write(contents.byteLength.toString(8).padStart(11, "0"), 124, 11, "ascii");
  header[135] = 0;
  header.write(input.typeflag, 156, 1, "ascii");
  return Buffer.concat([
    header,
    contents,
    Buffer.alloc(Math.ceil(contents.byteLength / 512) * 512 - contents.byteLength),
  ]);
}

function createTestPaxRecord(key: string, value: string): string {
  const body = `${key}=${value}\n`;
  let length = body.length + 2;
  for (;;) {
    const record = `${length} ${body}`;
    if (record.length === length) {
      return record;
    }
    length = record.length;
  }
}

function readTarHeaderString(header: Buffer, start: number, end: number): string {
  const value = header.subarray(start, end);
  const nul = value.indexOf(0);
  return value.subarray(0, nul === -1 ? value.byteLength : nul).toString("utf8");
}

function createBundleRef(hashCharacter: string) {
  const hash = hashCharacter.repeat(64);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: 512,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

async function createStoredBaseSnapshotRef(input: {
  artifactBundles: Map<string, Uint8Array>;
  externalizeArtifacts?: boolean;
  vaultRoot: string;
}) {
  const snapshot = await snapshotHostedExecutionContext({
    ...(input.externalizeArtifacts === false
      ? {}
      : {
          artifactSink: async (artifact) => {
            input.artifactBundles.set(artifact.ref.sha256, artifact.bytes);
          },
        }),
    vaultRoot: input.vaultRoot,
  });
  const hash = sha256HostedBundleHex(snapshot.bundle);
  input.artifactBundles.set(hash, snapshot.bundle);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: snapshot.bundle.byteLength,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function createStoredManifestOnlySnapshotRef(input: {
  artifactBundles: Map<string, Uint8Array>;
  files: readonly Record<string, unknown>[];
}) {
  const manifestBody = {
    files: input.files,
    policyVersion: HOSTED_PORTABLE_WORKSPACE_MANIFEST_POLICY_VERSION,
    schema: HOSTED_PORTABLE_WORKSPACE_MANIFEST_SCHEMA,
  };
  const manifest = {
    ...manifestBody,
    manifestHash: sha256HostedBundleHex(Buffer.from(JSON.stringify(manifestBody))),
  };
  const bundle = writeHostedBundleTextFile({
    bytes: null,
    kind: "vault",
    path: HOSTED_PORTABLE_WORKSPACE_MANIFEST_RELATIVE_PATH,
    root: "workspace-metadata",
    text: JSON.stringify(manifest) + "\n",
  });
  const hash = sha256HostedBundleHex(bundle);
  input.artifactBundles.set(hash, bundle);
  return {
    hash,
    key: `cloudflare-workspace-snapshots/${hash}.bundle`,
    size: bundle.byteLength,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

async function createLegacyWorkingSnapshotFixture(input: {
  artifactBundles: Map<string, Uint8Array>;
  baseVaultRoot: string;
  vaultRoot: string;
}) {
  const baseSnapshot = await snapshotHostedExecutionContext({
    artifactSink: async (artifact) => {
      input.artifactBundles.set(artifact.ref.sha256, artifact.bytes);
    },
    vaultRoot: input.baseVaultRoot,
  });
  const baseSnapshotHash = sha256HostedBundleHex(baseSnapshot.bundle);
  input.artifactBundles.set(baseSnapshotHash, baseSnapshot.bundle);
  const baseSnapshotRef = {
    hash: baseSnapshotHash,
    key: `cloudflare-workspace-snapshots/${baseSnapshotHash}.bundle`,
    size: baseSnapshot.bundle.byteLength,
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
  const baseManifest =
    readHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle)
    ?? createHostedPortableWorkspaceManifestFromBundle(baseSnapshot.bundle);
  const deltaSnapshot = await snapshotHostedPortableWorkspaceDelta({
    baseManifest,
    baseSnapshotHash,
    vaultRoot: input.vaultRoot,
  });
  if (deltaSnapshot.kind !== "changed") {
    throw new Error("Expected synthetic legacy working delta fixture to change.");
  }

  const deltaSnapshotHash = sha256HostedBundleHex(deltaSnapshot.bundle);
  input.artifactBundles.set(deltaSnapshotHash, deltaSnapshot.bundle);
  return {
    base: baseSnapshotRef,
    delta: {
      hash: deltaSnapshotHash,
      key: `cloudflare-workspace-deltas/${deltaSnapshotHash}.bundle`,
      size: deltaSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    schema: HOSTED_EXECUTION_WORKING_SNAPSHOT_REF_SCHEMA,
  } as const;
}

async function createLegacyLayeredSnapshotFixture(input: {
  artifactBundles: Map<string, Uint8Array>;
  baseVaultRoot: string;
  externalizeBaseArtifacts?: boolean;
  externalizeHotArtifacts?: boolean;
  hotVaultRoot: string;
}) {
  const baseSnapshotRef = await createStoredBaseSnapshotRef({
    externalizeArtifacts: input.externalizeBaseArtifacts,
    artifactBundles: input.artifactBundles,
    vaultRoot: input.baseVaultRoot,
  });
  const hotSnapshot = await snapshotHostedExecutionContext({
    ...(input.externalizeHotArtifacts === false
      ? {}
      : {
          artifactSink: async (artifact) => {
            input.artifactBundles.set(artifact.ref.sha256, artifact.bytes);
          },
        }),
    vaultRoot: input.hotVaultRoot,
  });
  const hotSnapshotHash = sha256HostedBundleHex(hotSnapshot.bundle);
  input.artifactBundles.set(hotSnapshotHash, hotSnapshot.bundle);
  return {
    base: baseSnapshotRef,
    hot: {
      hash: hotSnapshotHash,
      key: `cloudflare-workspace-hot-state/${hotSnapshotHash}.bundle`,
      size: hotSnapshot.bundle.byteLength,
      updatedAt: "2026-05-01T00:00:00.000Z",
    },
    schema: HOSTED_EXECUTION_LAYERED_SNAPSHOT_REF_SCHEMA,
  } as const;
}

function readBrowserVaultReplicaSourceBundleHash(replica: unknown): string {
  if (!replica || typeof replica !== "object" || Array.isArray(replica)) {
    throw new TypeError("Browser vault replica must be an object.");
  }

  const source = (replica as Record<string, unknown>).source;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Browser vault replica source must be an object.");
  }

  const sourceBundleHash = (source as Record<string, unknown>).sourceBundleHash;
  if (typeof sourceBundleHash !== "string") {
    throw new TypeError("Browser vault replica sourceBundleHash must be a string.");
  }

  return sourceBundleHash;
}

function createBrowserVaultReplicaRef(sourceBundleHash: string) {
  return {
    byteLength: 256,
    dataVersion: "workspace-bridge-test",
    generatedAt: "2026-05-01T00:00:00.000Z",
    keyId: "browser-key-workspace-bridge",
    objectKey: "browser-vault/member-test/replica.json",
    replicaSchema: "murph.browser-vault-replica",
    runtimeRootKeyId: "udrk:runtime:workspace-bridge",
    schema: "murph.hosted-browser-vault-replica-ref.v1",
    sourceBundleHash,
  } as const;
}

function requireWorkspaceSnapshotV2Ref(value: unknown): HostedWorkspaceSnapshotV2Ref {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (value as Record<string, unknown>).schema !== HOSTED_WORKSPACE_SNAPSHOT_V2_REF_SCHEMA
  ) {
    throw new TypeError("Expected a hosted workspace snapshot v2 ref.");
  }

  return value as HostedWorkspaceSnapshotV2Ref;
}

function requireBundleRef(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("hash" in value)) {
    throw new TypeError("Expected a hosted execution bundle ref.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.hash !== "string"
    || typeof record.key !== "string"
    || typeof record.size !== "number"
    || typeof record.updatedAt !== "string"
  ) {
    throw new TypeError("Hosted execution bundle ref is malformed.");
  }

  return {
    hash: record.hash,
    key: record.key,
    size: record.size,
    updatedAt: record.updatedAt,
  };
}
