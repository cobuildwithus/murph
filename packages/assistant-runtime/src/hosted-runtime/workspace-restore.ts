import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  listAssistantContextSnapshotDirtyDomainsForCanonicalWrite,
  markAssistantContextSnapshotDirty,
  type AssistantContextSnapshotDirtyDomain,
} from "@murphai/assistant-engine";
import {
  type HostedCanonicalWriteReceiptContentRef,
} from "@murphai/core";
import {
  VAULT_LAYOUT,
} from "@murphai/contracts";
import {
  buildHostedExecutionSafeErrorDiagnostics,
} from "@murphai/hosted-execution";
import type {
  HostedWorkspaceState,
} from "@murphai/hosted-execution/runtime-control";
import {
  isHostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/parsers";
import {
  buildHostedWorkspaceSnapshotV2FingerprintSha256,
  type HostedWorkspaceSnapshotV2Ref,
} from "@murphai/hosted-execution/workspace-snapshot-v2";
import {
  resolveAssistantStatePaths,
  pruneHostedCodexHomeToSessionReferencedRollouts,
} from "@murphai/runtime-state/node";
import {
  normalizeCodexResumeState,
  normalizeCodexRolloutRelativePath,
} from "@murphai/operator-config/assistant/codex-resume-state";
import {
  buildHostedRuntimeLogContextFields,
  writeHostedRuntimeLogBestEffort,
  type HostedRuntimeLogContext,
} from "./runtime-logs.ts";
import {
  omitHostedCanonicalWriteReceiptLogStatusFields,
  readHostedCanonicalWriteReceiptLog,
  readHostedCanonicalWriteReceiptLogStatusFingerprint,
  type HostedCanonicalWriteReceiptLogStatusFingerprint,
} from "./canonical-write-receipt-log.ts";
import {
  parseHostedCanonicalWriteReceiptArtifact,
} from "./canonical-write-receipt.ts";
import { applyHostedCanonicalWriteReceiptWithMedia } from "./canonical-write-media.ts";

import {
  createHostedArtifactMaterializer,
} from "./artifacts.ts";
import type {
  HostedWorkspaceArtifactMaterializer,
  HostedRestoredExecutionContext,
} from "./models.ts";
import {
  HostedRuntimeArtifactReadError,
  type HostedRuntimePlatform,
  type HostedRuntimeWorkspaceSnapshotRestoreTimingDetails,
} from "./platform.ts";

const HOSTED_CODEX_HOME_RELATIVE_PATH = ".codex-hosted";
const HOSTED_CANONICAL_WRITE_RECEIPT_RESTORE_FETCH_CONCURRENCY = 8;
const HOSTED_CODEX_THREAD_ID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/u;

const HOSTED_WORKSPACE_LIVE_RUNTIME_STATE_FILE_NAME = ".hosted-workspace-live-runtime-state.json";
const HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_FILE_NAME = ".hosted-workspace-clean-checkpoint.json";
const HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA =
  "murph.hosted-workspace-clean-checkpoint.v1";

export type HostedWorkspaceRuntimeRestoreMode = "null-bootstrap" | "snapshot";

export interface HostedWorkspaceRuntimeRestoreResult
  extends HostedRestoredExecutionContext {
  canonicalWriteReceiptCount: number;
  canonicalWriteReceiptRecoveryFailed: boolean;
  materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
  mode: HostedWorkspaceRuntimeRestoreMode;
  restoreWasCold: boolean;
  restoreTiming: HostedRuntimeWorkspaceSnapshotRestoreTimingDetails | null;
}

export type HostedWorkspaceRuntimeRestorePlatform = Pick<
  HostedRuntimePlatform,
  "artifactStore" | "logPort" | "mediaStore" | "workspaceSnapshotPort"
>;

export async function restoreHostedWorkspaceRuntimeJobWorkspace(input: {
  logContext?: HostedRuntimeLogContext | null;
  platform: HostedWorkspaceRuntimeRestorePlatform;
  signal?: AbortSignal | null;
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<HostedWorkspaceRuntimeRestoreResult> {
  const restored = readHostedWorkspaceRuntimeLocalRoots(input.vaultRoot);
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  if (snapshotRef !== null && !isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    throw new Error("Hosted workspace restore requires a v2 snapshot reference.");
  }
  const restoreLastKnownGoodAfterReceiptFailure = async (
    error: unknown,
  ): Promise<HostedWorkspaceRuntimeRestoreResult> => {
    const diagnostics = buildHostedExecutionSafeErrorDiagnostics(error);
    const nestedErrorCode = typeof diagnostics?.errorCode === "string"
      ? diagnostics.errorCode
      : "runtime_error";
    console.warn("Hosted canonical write receipt recovery failed; foreground authority retained.", {
      errorCode: "canonical_write_receipt_recovery_failed",
      failureCount: 1,
      nestedErrorCode,
    });
    void writeHostedRuntimeLogBestEffort({
      entry: {
        ...buildHostedRuntimeLogContextFields(input.logContext),
        component: "runtime",
        errorCode: "canonical_write_receipt_recovery_failed",
        eventCode: "runner.error",
        level: "warn",
        phase: "restore",
        redactedJson: {
          canonicalWriteReceiptRecoveryFailed: 1,
          nestedErrorCode,
          safeErrorMessage:
            "Canonical receipt recovery rejected unsafe state; foreground reply authority continued.",
        },
      },
      platform: input.platform,
    }).catch(() => undefined);

    await clearHostedWorkspaceRuntimeLocalRoots(restored);
    await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);
    const restoredLastKnownGood = await restoreHostedWorkspaceRuntimeJobWorkspace({
      ...input,
      workspace: input.workspace
        ? {
            ...input.workspace,
            redactedStatus: omitHostedCanonicalWriteReceiptLogStatusFields(
              input.workspace.redactedStatus,
            ),
          }
        : null,
    });
    return {
      ...restoredLastKnownGood,
      canonicalWriteReceiptRecoveryFailed: true,
    };
  };
  const recoverCanonicalWriteReceipts = async (
    vaultRoot: string,
    materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer,
  ) => {
    try {
      return {
        count: await applyHostedCanonicalWriteReceiptsFromWorkspaceState({
          materializeWorkspaceArtifacts,
          platform: input.platform,
          status: input.workspace?.redactedStatus ?? null,
          vaultRoot,
        }),
        restored: null,
      };
    } catch (error) {
      if (input.signal?.aborted) {
        throw input.signal.reason ?? error;
      }
      if (
        error instanceof HostedRuntimeArtifactReadError
        && error.retryable
      ) {
        await clearHostedWorkspaceRuntimeLocalRoots(restored);
        await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);
        throw error.cause ?? error;
      }
      return {
        count: 0,
        restored: await restoreLastKnownGoodAfterReceiptFailure(error),
      };
    }
  };

  await clearHostedWorkspaceLiveRuntimeStateBestEffort(restored.vaultRoot);

  // Current v2 restore path: restore the single direct-R2 encrypted snapshot
  // without legacy bundle, hot-layer, delta, or sidecar artifact handling.
  if (isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    if (!input.platform.workspaceSnapshotPort) {
      throw new Error("Hosted workspace snapshot v2 restore requires a workspace snapshot port.");
    }
    const warmRestored = await tryRestoreHostedWorkspaceFromCleanCheckpointMarker({
      logContext: input.logContext ?? null,
      platform: input.platform,
      restored,
      snapshotRef,
      workspace: input.workspace ?? null,
    });
    if (warmRestored) {
      const receiptRecovery = await recoverCanonicalWriteReceipts(
        warmRestored.vaultRoot, warmRestored.materializeWorkspaceArtifacts,
      );
      if (receiptRecovery.restored) {
        return receiptRecovery.restored;
      }
      return {
        ...warmRestored,
        canonicalWriteReceiptCount: receiptRecovery.count,
        canonicalWriteReceiptRecoveryFailed: false,
        mode: "snapshot",
        restoreWasCold: false,
        restoreTiming: null,
      };
    }
    const restoreTiming = await input.platform.workspaceSnapshotPort.restoreWorkspaceSnapshot({
      durableRoot: resolveHostedWorkspaceDurableRoot(restored.vaultRoot),
      ref: snapshotRef,
      signal: input.signal ?? null,
    });
    await Promise.all([
      createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
      createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
      createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
    ]);
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: restored.assistantStateRoot,
      operatorHomeRoot: restored.operatorHomeRoot,
    });
    const materializeWorkspaceArtifacts = createHostedWorkspaceRuntimeArtifactMaterializer({
      platform: input.platform,
      restored,
    });
    const receiptRecovery = await recoverCanonicalWriteReceipts(
      restored.vaultRoot, materializeWorkspaceArtifacts,
    );
    if (receiptRecovery.restored) {
      return receiptRecovery.restored;
    }

    return {
      ...restored,
      canonicalWriteReceiptCount: receiptRecovery.count,
      canonicalWriteReceiptRecoveryFailed: false,
      materializeWorkspaceArtifacts,
      mode: "snapshot",
      restoreWasCold: true,
      restoreTiming: restoreTiming ?? null,
    };
  }

  await clearHostedWorkspaceRuntimeLocalRoots(restored);
  await clearHostedWorkspaceRestoreCachesBestEffort(restored.vaultRoot);
  const receiptRecovery = await recoverCanonicalWriteReceipts(restored.vaultRoot);
  if (receiptRecovery.restored) {
    return receiptRecovery.restored;
  }

  return {
    ...restored,
    canonicalWriteReceiptCount: receiptRecovery.count,
    canonicalWriteReceiptRecoveryFailed: false,
    materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
      platform: input.platform,
      restored,
    }),
    mode: "null-bootstrap",
    restoreWasCold: true,
    restoreTiming: null,
  };
}

interface HostedWorkspaceCleanCheckpointMarker {
  receiptLogByteSize: number | null;
  receiptLogSha256: string | null;
  schema: typeof HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA;
  snapshotFingerprintSha256: string;
  workspaceVersion: string;
  writtenAt: string;
}

interface HostedWorkspaceCleanCheckpointReceiptMarkerFields {
  receiptLogByteSize: number | null;
  receiptLogSha256: string | null;
}

async function tryRestoreHostedWorkspaceFromCleanCheckpointMarker(input: {
  logContext: HostedRuntimeLogContext | null;
  platform: HostedWorkspaceRuntimeRestorePlatform;
  restored: HostedRestoredExecutionContext;
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  workspace: HostedWorkspaceState | null;
}): Promise<
  | (HostedRestoredExecutionContext & {
      materializeWorkspaceArtifacts: HostedWorkspaceArtifactMaterializer;
    })
  | null
> {
  const expected = tryBuildHostedWorkspaceCleanCheckpointMarker({
    snapshotRef: input.snapshotRef,
    workspace: input.workspace,
  });
  if (!expected) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  let marker: HostedWorkspaceCleanCheckpointMarker | null = null;
  try {
    marker = await readHostedWorkspaceCleanCheckpointMarker(input.restored.vaultRoot);
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }
  if (!marker) {
    return null;
  }
  if (!sameHostedWorkspaceCleanCheckpointMarker(marker, expected)) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  try {
    await consumeHostedWorkspaceCleanCheckpointMarker(input.restored.vaultRoot);
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }

  try {
    await assertHostedWorkspaceWarmCleanRoots(input.restored);
    await sanitizeRestoredHostedCodexResumeState({
      assistantStateRoot: input.restored.assistantStateRoot,
      operatorHomeRoot: input.restored.operatorHomeRoot,
    });
    return {
      ...input.restored,
      materializeWorkspaceArtifacts: createHostedWorkspaceRuntimeArtifactMaterializer({
        platform: input.platform,
        restored: input.restored,
      }),
    };
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.restored.vaultRoot);
    return null;
  }
}

export async function writeHostedWorkspaceCleanCheckpointMarkerBestEffort(input: {
  vaultRoot: string;
  workspace: HostedWorkspaceState | null;
}): Promise<boolean> {
  const snapshotRef = input.workspace?.snapshotRef ?? null;
  if (!isHostedWorkspaceSnapshotV2Ref(snapshotRef)) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
  const marker = tryBuildHostedWorkspaceCleanCheckpointMarker({
    snapshotRef,
    workspace: input.workspace,
  });
  if (!marker) {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
  try {
    await writeHostedWorkspaceCleanCheckpointMarker(input.vaultRoot, marker);
    return true;
  } catch {
    await clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot);
    return false;
  }
}

function tryBuildHostedWorkspaceCleanCheckpointMarker(input: {
  snapshotRef: HostedWorkspaceSnapshotV2Ref;
  workspace: HostedWorkspaceState | null;
}): HostedWorkspaceCleanCheckpointMarker | null {
  if (!input.workspace || input.workspace.version.trim().length === 0) {
    return null;
  }
  let receiptFields: HostedWorkspaceCleanCheckpointReceiptMarkerFields;
  try {
    receiptFields = createHostedWorkspaceCleanCheckpointReceiptMarkerFields(
      readHostedCanonicalWriteReceiptLogStatusFingerprint(input.workspace.redactedStatus ?? null),
    );
  } catch {
    return null;
  }
  return {
    ...receiptFields,
    schema: HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA,
    snapshotFingerprintSha256: buildHostedWorkspaceSnapshotV2FingerprintSha256(input.snapshotRef),
    workspaceVersion: input.workspace.version,
    writtenAt: new Date().toISOString(),
  };
}

function createHostedWorkspaceCleanCheckpointReceiptMarkerFields(
  fingerprint: HostedCanonicalWriteReceiptLogStatusFingerprint | null,
): HostedWorkspaceCleanCheckpointReceiptMarkerFields {
  return fingerprint
    ? {
        receiptLogByteSize: fingerprint.byteSize,
        receiptLogSha256: fingerprint.sha256,
      }
    : {
        receiptLogByteSize: null,
        receiptLogSha256: null,
      };
}

async function readHostedWorkspaceCleanCheckpointMarker(
  vaultRoot: string,
): Promise<HostedWorkspaceCleanCheckpointMarker | null> {
  const markerPath = resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot);
  let markerStat;
  try {
    markerStat = await lstat(markerPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
  if (!markerStat.isFile()) {
    throw new Error("Hosted workspace clean checkpoint marker must be a regular file.");
  }
  return parseHostedWorkspaceCleanCheckpointMarker(await readFile(markerPath, "utf8"));
}

function parseHostedWorkspaceCleanCheckpointMarker(
  raw: string,
): HostedWorkspaceCleanCheckpointMarker {
  const parsed: unknown = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Hosted workspace clean checkpoint marker must be an object.");
  }
  const schema = parsed.schema;
  const workspaceVersion = parsed.workspaceVersion;
  const snapshotFingerprintSha256 = parsed.snapshotFingerprintSha256;
  const receiptLogSha256 = parsed.receiptLogSha256;
  const receiptLogByteSize = parsed.receiptLogByteSize;
  const writtenAt = parsed.writtenAt;
  if (schema !== HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_SCHEMA) {
    throw new Error("Hosted workspace clean checkpoint marker schema is invalid.");
  }
  if (typeof workspaceVersion !== "string" || workspaceVersion.trim().length === 0) {
    throw new Error("Hosted workspace clean checkpoint marker workspace version is invalid.");
  }
  if (!isSha256(snapshotFingerprintSha256)) {
    throw new Error("Hosted workspace clean checkpoint marker snapshot fingerprint is invalid.");
  }
  if (
    receiptLogSha256 !== null
    && !isSha256(receiptLogSha256)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt hash is invalid.");
  }
  if (
    receiptLogByteSize !== null
    && !isNonNegativeInteger(receiptLogByteSize)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt size is invalid.");
  }
  if (
    (receiptLogSha256 === null || receiptLogByteSize === null)
    && (receiptLogSha256 !== null || receiptLogByteSize !== null)
  ) {
    throw new Error("Hosted workspace clean checkpoint marker receipt fields are inconsistent.");
  }
  if (
    typeof writtenAt !== "string"
    || !Number.isFinite(Date.parse(writtenAt))
    || new Date(writtenAt).toISOString() !== writtenAt
  ) {
    throw new Error("Hosted workspace clean checkpoint marker timestamp is invalid.");
  }
  return {
    receiptLogByteSize,
    receiptLogSha256,
    schema,
    snapshotFingerprintSha256,
    workspaceVersion,
    writtenAt,
  };
}

function sameHostedWorkspaceCleanCheckpointMarker(
  actual: HostedWorkspaceCleanCheckpointMarker,
  expected: HostedWorkspaceCleanCheckpointMarker,
): boolean {
  return actual.schema === expected.schema
    && actual.workspaceVersion === expected.workspaceVersion
    && actual.snapshotFingerprintSha256 === expected.snapshotFingerprintSha256
    && actual.receiptLogSha256 === expected.receiptLogSha256
    && actual.receiptLogByteSize === expected.receiptLogByteSize;
}

async function writeHostedWorkspaceCleanCheckpointMarker(
  vaultRoot: string,
  marker: HostedWorkspaceCleanCheckpointMarker,
): Promise<void> {
  const markerPath = resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot);
  const tempPath = `${markerPath}.${randomUUID().replace(/-/g, "")}.tmp`;
  await mkdir(path.dirname(markerPath), { mode: 0o700, recursive: true });
  try {
    await writeFile(tempPath, `${JSON.stringify(marker, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, markerPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

async function consumeHostedWorkspaceCleanCheckpointMarker(vaultRoot: string): Promise<void> {
  await rm(resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot));
}

async function assertHostedWorkspaceWarmCleanRoots(
  restored: HostedRestoredExecutionContext,
): Promise<void> {
  await Promise.all([
    assertHostedWorkspaceWarmCleanDirectory(resolveHostedWorkspaceDurableRoot(restored.vaultRoot)),
    assertHostedWorkspaceWarmCleanDirectory(restored.vaultRoot),
    assertHostedWorkspaceWarmCleanDirectory(restored.assistantStateRoot),
    assertHostedWorkspaceWarmCleanDirectory(restored.operatorHomeRoot),
  ]);
  await assertHostedWorkspaceWarmCleanFile(path.join(restored.vaultRoot, VAULT_LAYOUT.metadata));
  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
  ]);
}

async function assertHostedWorkspaceWarmCleanDirectory(directoryPath: string): Promise<void> {
  const directoryStat = await lstat(directoryPath);
  if (!directoryStat.isDirectory()) {
    throw new Error("Hosted warm workspace root is not a directory.");
  }
}

async function assertHostedWorkspaceWarmCleanFile(filePath: string): Promise<void> {
  const fileStat = await lstat(filePath);
  if (!fileStat.isFile()) {
    throw new Error("Hosted warm workspace metadata is not a regular file.");
  }
}

async function sanitizeRestoredHostedCodexResumeState(input: {
  assistantStateRoot: string;
  operatorHomeRoot: string;
}): Promise<void> {
  const sessionsRoot = path.join(input.assistantStateRoot, "sessions");

  async function visit(directoryPath: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }

    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolutePath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      await sanitizeHostedAssistantSessionCodexResumeFile({
        filePath: absolutePath,
        operatorHomeRoot: input.operatorHomeRoot,
      });
    }
  }

  await visit(sessionsRoot);
  await pruneHostedCodexHomeToSessionReferencedRollouts({
    assistantStateRoot: input.assistantStateRoot,
    nativeMemoryRetention: "read-artifacts",
    operatorHomeRoot: input.operatorHomeRoot,
  });
}

async function sanitizeHostedAssistantSessionCodexResumeFile(input: {
  filePath: string;
  operatorHomeRoot: string;
}): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(input.filePath, "utf8"));
  } catch {
    return;
  }
  if (!await shouldClearHostedAssistantSessionCodexResumeRecord({
    operatorHomeRoot: input.operatorHomeRoot,
    value: parsed,
  })) {
    return;
  }
  const cleared = clearHostedAssistantSessionCodexResumeRecord(parsed);
  if (!cleared.changed) {
    return;
  }
  await writeFile(input.filePath, `${JSON.stringify(cleared.value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(input.filePath, 0o600);
}

async function shouldClearHostedAssistantSessionCodexResumeRecord(input: {
  operatorHomeRoot: string;
  value: unknown;
}): Promise<boolean> {
  if (!isPlainObject(input.value) || !isHostedAssistantSessionCodexTarget(input.value)) {
    return false;
  }
  if (!hasRawHostedAssistantSessionCodexResumeCandidate(input.value)) {
    return false;
  }

  const resumeSource =
    readRecordProperty(input.value, "codexResume")
    ?? readRecordProperty(input.value, "resumeState");
  const resumeState =
    normalizeCodexResumeState(resumeSource)
    ?? normalizeCodexResumeState(input.value);
  const rolloutRelativePath = normalizeCodexRolloutRelativePath(
    resumeState?.rolloutRelativePath,
  );
  if (!resumeState || !rolloutRelativePath) {
    return true;
  }
  if (!hostedCodexRolloutPathMatchesThreadId({
    rolloutRelativePath,
    threadId: resumeState.threadId,
  })) {
    return true;
  }

  return !await isRestoredHostedCodexRolloutRegularFile({
    operatorHomeRoot: input.operatorHomeRoot,
    rolloutRelativePath,
  });
}

function hostedCodexRolloutPathMatchesThreadId(input: {
  rolloutRelativePath: string;
  threadId: string;
}): boolean {
  const rolloutThreadId = readHostedCodexRolloutThreadId(input.rolloutRelativePath);
  return rolloutThreadId !== null && rolloutThreadId === input.threadId.toLowerCase();
}

function readHostedCodexRolloutThreadId(rolloutRelativePath: string): string | null {
  const suffix = ".jsonl";
  if (!rolloutRelativePath.endsWith(suffix)) {
    return null;
  }

  const pathWithoutSuffix = rolloutRelativePath.slice(0, -suffix.length);
  const threadIdStart = pathWithoutSuffix.length - 36;
  if (threadIdStart <= 0 || pathWithoutSuffix[threadIdStart - 1] !== "-") {
    return null;
  }

  const threadId = pathWithoutSuffix.slice(threadIdStart);
  return HOSTED_CODEX_THREAD_ID_PATTERN.test(threadId)
    ? threadId.toLowerCase()
    : null;
}

function clearHostedAssistantSessionCodexResumeRecord(value: unknown): {
  changed: boolean;
  value: unknown;
} {
  if (!isPlainObject(value)) {
    return {
      changed: false,
      value,
    };
  }

  const next: Record<string, unknown> = { ...value };
  let changed = false;
  for (const key of ["codexResume", "resumeState"] as const) {
    if (Object.hasOwn(next, key) && next[key] !== null) {
      next[key] = null;
      changed = true;
    }
  }
  for (const key of ["codexThreadId", "providerSessionId", "resumeRouteId", "routeFingerprint"] as const) {
    if (Object.hasOwn(next, key)) {
      delete next[key];
      changed = true;
    }
  }

  return {
    changed,
    value: changed ? next : value,
  };
}

function isHostedAssistantSessionCodexTarget(record: Record<string, unknown>): boolean {
  const target =
    readRecordProperty(record, "codexTarget") ?? readRecordProperty(record, "target");
  const targetAdapter = readRecordStringProperty(target, "adapter");
  return !targetAdapter || targetAdapter === "codex-cli";
}

function hasRawHostedAssistantSessionCodexResumeCandidate(
  record: Record<string, unknown>,
): boolean {
  return hasNonNullRecordProperty(record, "codexResume")
    || hasNonNullRecordProperty(record, "resumeState")
    || readRecordStringProperty(record, "codexThreadId") !== null
    || readRecordStringProperty(record, "providerSessionId") !== null;
}

function hasNonNullRecordProperty(
  record: Record<string, unknown>,
  propertyName: string,
): boolean {
  return Object.hasOwn(record, propertyName) && record[propertyName] != null;
}

async function isRestoredHostedCodexRolloutRegularFile(input: {
  operatorHomeRoot: string;
  rolloutRelativePath: string;
}): Promise<boolean> {
  const rolloutRelativePath = normalizeCodexRolloutRelativePath(input.rolloutRelativePath);
  if (!rolloutRelativePath) {
    return false;
  }

  const codexHomeRoot = path.resolve(input.operatorHomeRoot, HOSTED_CODEX_HOME_RELATIVE_PATH);
  const rolloutPath = path.resolve(codexHomeRoot, rolloutRelativePath);
  const relativeToCodexHome = path.relative(codexHomeRoot, rolloutPath);
  if (
    relativeToCodexHome.length === 0
    || relativeToCodexHome.startsWith("..")
    || path.isAbsolute(relativeToCodexHome)
  ) {
    return false;
  }

  let codexHomeStat;
  try {
    codexHomeStat = await lstat(codexHomeRoot);
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }
    throw error;
  }
  if (codexHomeStat.isSymbolicLink() || !codexHomeStat.isDirectory()) {
    return false;
  }

  let currentPath = codexHomeRoot;
  for (const segment of rolloutRelativePath.split("/")) {
    currentPath = path.join(currentPath, segment);
    let stat;
    try {
      stat = await lstat(currentPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      throw error;
    }
    if (stat.isSymbolicLink()) {
      return false;
    }
    const isLeaf = currentPath === rolloutPath;
    if (isLeaf ? !stat.isFile() : !stat.isDirectory()) {
      return false;
    }
  }

  return true;
}

function readRecordProperty(
  value: unknown,
  propertyName: string,
): unknown {
  return isPlainObject(value) ? value[propertyName] : null;
}

function readRecordStringProperty(
  value: unknown,
  propertyName: string,
): string | null {
  const propertyValue = readRecordProperty(value, propertyName);
  return typeof propertyValue === "string" && propertyValue.trim().length > 0
    ? propertyValue
    : null;
}

function createHostedWorkspaceRuntimeArtifactMaterializer(input: {
  platform: HostedWorkspaceRuntimeRestorePlatform;
  restored: HostedRestoredExecutionContext;
}): HostedWorkspaceArtifactMaterializer {
  return createHostedArtifactMaterializer({
    mediaStore: input.platform.mediaStore ?? null,
    operatorHomeRoot: input.restored.operatorHomeRoot,
    vaultRoot: input.restored.vaultRoot,
  });
}

async function applyHostedCanonicalWriteReceiptsFromWorkspaceState(input: {
  materializeWorkspaceArtifacts?: HostedWorkspaceArtifactMaterializer;
  platform: HostedWorkspaceRuntimeRestorePlatform;
  status: HostedWorkspaceState["redactedStatus"] | null | undefined;
  vaultRoot: string;
}): Promise<number> {
  const receiptLog = await readHostedCanonicalWriteReceiptLog({
    artifactStore: input.platform.artifactStore,
    status: input.status,
  });
  const { entries } = receiptLog;
  const appliedReceiptRefs = new Set<string>();
  const dirtyDomains = new Set<AssistantContextSnapshotDirtyDomain>();
  const uniqueEntries = entries.filter((entry) => {
    const receiptRefKey = `${entry.sha256}:${entry.byteSize}`;
    if (appliedReceiptRefs.has(receiptRefKey)) {
      return false;
    }
    appliedReceiptRefs.add(receiptRefKey);
    return true;
  });
  for (
    let offset = 0;
    offset < uniqueEntries.length;
    offset += HOSTED_CANONICAL_WRITE_RECEIPT_RESTORE_FETCH_CONCURRENCY
  ) {
    const receiptWave = await Promise.all(
      uniqueEntries
        .slice(
          offset,
          offset + HOSTED_CANONICAL_WRITE_RECEIPT_RESTORE_FETCH_CONCURRENCY,
        )
        .map(async (entry) => {
          const bytes = await input.platform.artifactStore.get(entry.sha256, {
            purpose: "canonical_write_receipt",
          });
          if (!bytes) {
            throw new Error("Hosted canonical write receipt artifact is unavailable.");
          }
          if (bytes.byteLength !== entry.byteSize) {
            throw new Error(
              "Hosted canonical write receipt artifact size does not match its log ref.",
            );
          }
          return parseHostedCanonicalWriteReceiptArtifact(
            Buffer.from(bytes).toString("utf8"),
          );
        }),
    );
    for (const parsed of receiptWave) {
      if (!parsed) {
        continue;
      }
      for (const domain of listAssistantContextSnapshotDirtyDomainsForCanonicalWrite(parsed)) {
        dirtyDomains.add(domain);
      }
      // Guarded replacements need their preimage. Ordinary media receipts only
      // restore references and must not download their payloads.
      const preimagePaths = parsed.actions.filter((action) =>
        action.kind === "text_upsert" && action.expectedSha256 !== undefined
      ).map((action) => action.targetRelativePath);
      if (preimagePaths.length > 0) {
        await input.materializeWorkspaceArtifacts?.(preimagePaths);
      }
      await applyHostedCanonicalWriteReceiptWithMedia({
        readPayload: async (ref) =>
          await readHostedCanonicalWritePayloadForRestore({
            platform: input.platform,
            ref,
          }),
        receipt: parsed,
        vaultRoot: input.vaultRoot,
      });
    }
  }
  if (dirtyDomains.size > 0) {
    await markAssistantContextSnapshotDirty({
      domains: [...dirtyDomains],
      vaultRoot: input.vaultRoot,
    });
  }
  return receiptLog.entryCount;
}

async function readHostedCanonicalWritePayloadForRestore(input: {
  platform: HostedWorkspaceRuntimeRestorePlatform;
  ref: HostedCanonicalWriteReceiptContentRef;
}): Promise<Uint8Array | ArrayBuffer | null> {
  return await input.platform.artifactStore.get(input.ref.sha256, {
    purpose: "canonical_write_receipt",
  });
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return isPlainObject(error) && error.code === "ENOENT";
}

export async function markHostedWorkspaceLiveRuntimeStateDirtyForSnapshotRefBestEffort(input: {
  snapshotRef: HostedWorkspaceState["snapshotRef"];
  vaultRoot: string;
}): Promise<void> {
  void input.snapshotRef;
  // Dirty local runtime state is valid only inside the currently owned child.
  // A later lease may reuse only an explicitly clean checkpoint marker.
  await Promise.all([
    clearHostedWorkspaceLiveRuntimeStateBestEffort(input.vaultRoot),
    clearHostedWorkspaceCleanCheckpointMarkerBestEffort(input.vaultRoot),
  ]);
}

async function clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot: string): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceLiveRuntimeStatePath(vaultRoot), { force: true });
  } catch {
    // The legacy marker is best-effort cleanup only.
  }
}

export async function clearHostedWorkspaceCleanCheckpointMarkerBestEffort(
  vaultRoot: string,
): Promise<void> {
  try {
    await rm(resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot), { force: true });
  } catch {
    // A stale marker can only affect performance; warm restore consumes it fail-closed.
  }
}

function resolveHostedWorkspaceLiveRuntimeStatePath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_LIVE_RUNTIME_STATE_FILE_NAME,
  );
}

function resolveHostedWorkspaceCleanCheckpointMarkerPath(vaultRoot: string): string {
  return path.join(
    path.dirname(path.resolve(vaultRoot)),
    HOSTED_WORKSPACE_CLEAN_CHECKPOINT_MARKER_FILE_NAME,
  );
}

function readHostedWorkspaceRuntimeLocalRoots(
  vaultRoot: string,
): HostedRestoredExecutionContext {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const assistantStateRoot = resolveAssistantStatePaths(resolvedVaultRoot).assistantStateRoot;
  const operatorHomeRoot = resolveHostedWorkspaceOperatorHomeRoot(resolvedVaultRoot);

  return {
    assistantStateRoot,
    operatorHomeRoot,
    vaultRoot: resolvedVaultRoot,
  };
}

function resolveHostedWorkspaceDurableRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault") {
    return path.dirname(resolvedVaultRoot);
  }
  return resolvedVaultRoot;
}

function resolveHostedWorkspaceOperatorHomeRoot(vaultRoot: string): string {
  const resolvedVaultRoot = path.resolve(vaultRoot);
  const parent = path.dirname(resolvedVaultRoot);
  if (path.basename(resolvedVaultRoot) === "vault" && path.basename(parent) === "durable") {
    return path.join(parent, "home");
  }
  return path.join(parent, `${path.basename(resolvedVaultRoot)}-operator-home`);
}

async function createHostedWorkspaceRuntimePrivateDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, {
    mode: 0o700,
    recursive: true,
  });
  await chmod(directoryPath, 0o700);
}

async function clearHostedWorkspaceRuntimeLocalRoots(
  restored: HostedRestoredExecutionContext,
): Promise<void> {
  await Promise.all([
    clearHostedWorkspaceLiveRuntimeStateBestEffort(restored.vaultRoot),
    rm(restored.operatorHomeRoot, {
      force: true,
      recursive: true,
    }),
    rm(restored.vaultRoot, {
      force: true,
      recursive: true,
    }),
  ]);
  await Promise.all([
    createHostedWorkspaceRuntimePrivateDirectory(restored.operatorHomeRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.vaultRoot),
    createHostedWorkspaceRuntimePrivateDirectory(restored.assistantStateRoot),
  ]);
}

async function clearHostedWorkspaceRestoreCachesBestEffort(vaultRoot: string): Promise<void> {
  await Promise.all([
    clearHostedWorkspaceCleanCheckpointMarkerBestEffort(vaultRoot),
    clearHostedWorkspaceLiveRuntimeStateBestEffort(vaultRoot),
  ]);
}
