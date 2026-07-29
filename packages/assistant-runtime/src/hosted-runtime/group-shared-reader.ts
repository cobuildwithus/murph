import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import path from "node:path";

import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
  type AssistantGroupParticipantDisplayName,
  type AssistantGroupParticipantDisplayNameSource,
  type AssistantHostedGroupParticipantDisplayNameReader,
  type AssistantHostedGroupSharedReader,
} from "@murphai/assistant-engine";
import {
  HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX,
  HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH,
  HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS,
} from "@murphai/hosted-execution/runtime-control";
import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES,
  type HostedVaultShareSelectableProjectionScope,
} from "@murphai/hosted-execution/vault-share";
import {
  ASSISTANT_STATE_DIRECTORY_MODE,
  ASSISTANT_STATE_FILE_MODE,
  readVersionedJsonStateFile,
  resolveRuntimePaths,
  writeVersionedJsonStateFile,
} from "@murphai/runtime-state/node";

import type { HostedRuntimeGroupToolPort } from "./platform.ts";

const GROUP_SHARED_REQUEST_INVALID = "group_shared_request_invalid";
const GROUP_SHARED_READ_FAILED = "group_shared_read_failed";
const GROUP_SHARED_RESULT_INVALID = "group_shared_result_invalid";
const GROUP_TOOL_UNAVAILABLE = "group_tool_unavailable";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_NAMESPACE =
  "linq-participant-display-name.v1";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA =
  "murph.hosted-group-participant-display-name-cache.v1";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA_VERSION = 1;
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_LABEL =
  "hosted group participant display-name cache";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_DIRECTORY =
  "assistant-runtime";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_FILE =
  "group-participant-display-names.json";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_BYTES = 2 * 1_024 * 1_024;
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES = 2_048;
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_KEY_PATTERN =
  /^[a-f0-9]{64}$/u;
// Web explicitly marks only handles for which it successfully checked every
// applicable authorized name source and found neither a profile name nor an
// owner-shared contact label. Bound that proven miss without adding invalidation.
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_NEGATIVE_TTL_MS =
  6 * 60 * 60 * 1_000;
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_POSITIVE_TTL_MS =
  14 * 24 * 60 * 60 * 1_000;
const HOSTED_GROUP_SHARED_SELECTABLE_SCOPE_BY_KEY = new Map(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((projectionScope) => [
    buildHostedVaultShareProjectionScopeKey(projectionScope),
    projectionScope,
  ]),
);

interface HostedGroupParticipantDisplayNameCacheState {
  entries: HostedGroupParticipantDisplayNameCacheStoredEntry[];
}

type HostedGroupParticipantDisplayNameCacheEntry =
  | {
      expiresAtMs: number;
      kind: "negative";
    }
  | {
      displayName: string;
      displayNameSource: AssistantGroupParticipantDisplayNameSource;
      expiresAtMs: number;
      kind: "positive";
    };

type HostedGroupParticipantDisplayNameCacheStoredEntry =
  HostedGroupParticipantDisplayNameCacheEntry & {
    key: string;
  };

interface HostedGroupParticipantDisplayNameCacheRead {
  entries: HostedGroupParticipantDisplayNameCacheStoredEntry[];
  needsCleanup: boolean;
  validFile: boolean;
}

/**
 * Creates a lazy operation-local adapter over the Web-owned shared-data read.
 * Construction performs no I/O. Each model-triggered request asks Web for one
 * current, consent-filtered, bounded snapshot of exactly the requested scopes.
 */
export function createHostedGroupSharedReader(input: {
  groupToolPort: HostedRuntimeGroupToolPort | null;
}): AssistantHostedGroupSharedReader {
  return {
    async request(request) {
      const projectionScopes = normalizeHostedGroupSharedProjectionScopes(
        request.projectionScopes,
      );
      if (!projectionScopes) {
        return unavailable(GROUP_SHARED_REQUEST_INVALID);
      }
      if (!input.groupToolPort) {
        return unavailable(GROUP_TOOL_UNAVAILABLE);
      }

      try {
        const response = await input.groupToolPort.request({
          action: "read_shared",
          projectionScopes,
        });
        if (response.action !== "read_shared") {
          return unavailable(GROUP_SHARED_RESULT_INVALID);
        }
        return response.result;
      } catch {
        return unavailable(GROUP_SHARED_READ_FAILED);
      }
    },
  };
}

export function normalizeHostedGroupSharedProjectionScopes(
  values: readonly HostedVaultShareSelectableProjectionScope[],
): HostedVaultShareSelectableProjectionScope[] | null {
  if (
    values.length === 0
    || values.length > ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES
  ) {
    return null;
  }
  const seen = new Set<string>();
  const normalized: HostedVaultShareSelectableProjectionScope[] = [];
  for (const projectionScope of values) {
    let projectionScopeKey: string;
    try {
      projectionScopeKey = buildHostedVaultShareProjectionScopeKey(projectionScope);
    } catch {
      return null;
    }
    const canonicalProjectionScope =
      HOSTED_GROUP_SHARED_SELECTABLE_SCOPE_BY_KEY.get(projectionScopeKey);
    if (!canonicalProjectionScope || seen.has(projectionScopeKey)) {
      return null;
    }
    seen.add(projectionScopeKey);
    normalized.push(canonicalProjectionScope);
  }
  return normalized;
}

function unavailable(unavailableReason: string) {
  return { status: "unavailable" as const, unavailableReason };
}

/**
 * Presentation-only Linq label lookup. Web remains the exact current
 * membership/profile policy and owner-contact authority. This adapter owns one
 * operation-local memo plus one bounded private file cache scoped by the
 * callback-bound runtime member and exact accepted-input route. Failure leaves
 * the transcript safely unnamed and is never promoted beyond the operation.
 */
export function createHostedGroupParticipantDisplayNameReader(input: {
  groupToolPort: HostedRuntimeGroupToolPort | null;
  routeConversationKey: string;
  runtimeMemberId: string;
  vaultRoot: string;
}): AssistantHostedGroupParticipantDisplayNameReader {
  const operationResolvedByHandle = new Map<
    string,
    AssistantGroupParticipantDisplayName | null
  >();
  const routeConversationKey = input.routeConversationKey.trim();
  const runtimeMemberId = input.runtimeMemberId.trim();
  const vaultRoot = input.vaultRoot.trim() ? input.vaultRoot : "";
  const cacheFilePath = vaultRoot
    ? resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot)
    : "";
  const buildCacheKey = (senderHandle: string) => createHash("sha256")
    .update(JSON.stringify([
      HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_NAMESPACE,
      runtimeMemberId,
      routeConversationKey,
      "linq",
      senderHandle,
    ]), "utf8")
    .digest("hex");
  const memoizeUnavailable = (senderHandles: readonly string[]) => {
    for (const senderHandle of senderHandles) {
      operationResolvedByHandle.set(senderHandle, null);
    }
  };

  const resolveMisses = async (
    senderHandles: readonly string[],
  ): Promise<boolean> => {
    if (!input.groupToolPort) {
      memoizeUnavailable(senderHandles);
      return false;
    }
    try {
      const response = await input.groupToolPort.request({
        action: "read_participant_display_names",
        linqSenderHandles: senderHandles,
      });
      if (
        response.action !== "read_participant_display_names"
        || response.result.status !== "ok"
      ) {
        memoizeUnavailable(senderHandles);
        return false;
      }

      const requestedHandleSet = new Set(senderHandles);
      const nameMissSenderHandles =
        response.result.nameMissSenderHandles ?? [];
      const nameMissSenderHandleSet = new Set(nameMissSenderHandles);
      const hasUnexpectedParticipant = response.result.participants.some(
        (participant) => !requestedHandleSet.has(participant.senderHandle),
      );
      const hasInvalidNameMiss =
        nameMissSenderHandleSet.size !== nameMissSenderHandles.length
        || nameMissSenderHandles.some(
          (senderHandle) => !requestedHandleSet.has(senderHandle),
        )
        || response.result.participants.some(
          (participant) =>
            nameMissSenderHandleSet.has(participant.senderHandle),
        );
      if (hasUnexpectedParticipant || hasInvalidNameMiss) {
        memoizeUnavailable(senderHandles);
        return false;
      }
      const filledAtMs = Date.now();
      const cacheUpdates: HostedGroupParticipantDisplayNameCacheStoredEntry[] = [];
      let responseCacheable = true;

      for (const senderHandle of senderHandles) {
        const participants = response.result.participants.filter(
          (participant) => participant.senderHandle === senderHandle,
        );
        if (participants.length === 0) {
          operationResolvedByHandle.set(senderHandle, null);
          if (nameMissSenderHandleSet.has(senderHandle)) {
            cacheUpdates.push({
              expiresAtMs:
                filledAtMs
                + HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_NEGATIVE_TTL_MS,
              key: buildCacheKey(senderHandle),
              kind: "negative",
            });
          }
          continue;
        }

        const participant = participants.length === 1 ? participants[0] : null;
        const displayName = participant
          ? normalizeHostedGroupParticipantDisplayName(participant.displayName)
          : null;
        if (
          !participant
          || !displayName
          || !isHostedGroupParticipantDisplayNameSource(
            participant.displayNameSource,
          )
        ) {
          operationResolvedByHandle.set(senderHandle, null);
          responseCacheable = false;
          continue;
        }

        const resolved = {
          displayName,
          displayNameSource: participant.displayNameSource,
          senderHandle,
        } satisfies AssistantGroupParticipantDisplayName;
        operationResolvedByHandle.set(senderHandle, resolved);
        cacheUpdates.push({
          displayName,
          displayNameSource: participant.displayNameSource,
          expiresAtMs:
            filledAtMs
            + HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_POSITIVE_TTL_MS,
          key: buildCacheKey(senderHandle),
          kind: "positive",
        });
      }

      if (responseCacheable && cacheUpdates.length > 0) {
        await writeHostedGroupParticipantDisplayNameCacheUpdates({
          cacheFilePath,
          nowMs: filledAtMs,
          updates: cacheUpdates,
          vaultRoot,
        }).catch(() => undefined);
        return true;
      }
      return false;
    } catch {
      memoizeUnavailable(senderHandles);
      return false;
    }
  };

  return {
    async read(request) {
      if (
        request.channel !== "linq"
        || !input.groupToolPort
        || !routeConversationKey
        || !runtimeMemberId
        || !vaultRoot
      ) {
        return [];
      }
      const senderHandles = normalizeHostedGroupParticipantDisplayNameHandles(
        request.senderHandles,
      );
      if (senderHandles.length === 0) {
        return [];
      }

      const handlesWithoutOperationMemo = senderHandles.filter(
        (senderHandle) => !operationResolvedByHandle.has(senderHandle),
      );
      if (handlesWithoutOperationMemo.length > 0) {
        const nowMs = Date.now();
        const cacheRead = await readHostedGroupParticipantDisplayNameCache({
          cacheFilePath,
          nowMs,
          vaultRoot,
        });
        const unresolvedHandles: string[] = [];
        for (const senderHandle of handlesWithoutOperationMemo) {
          const cacheKey = buildCacheKey(senderHandle);
          const cached = cacheRead.entries.find((entry) => entry.key === cacheKey);
          if (!cached) {
            unresolvedHandles.push(senderHandle);
            continue;
          }
          operationResolvedByHandle.set(
            senderHandle,
            cached.kind === "positive"
              ? {
                  displayName: cached.displayName,
                  displayNameSource: cached.displayNameSource,
                  senderHandle,
                }
              : null,
          );
        }

        const cacheUpdateAttempted = unresolvedHandles.length > 0
          ? await resolveMisses(unresolvedHandles)
          : false;
        if (
          cacheRead.validFile
          && cacheRead.needsCleanup
          && !cacheUpdateAttempted
        ) {
          await writeHostedGroupParticipantDisplayNameCacheState({
            cacheFilePath,
            entries: cacheRead.entries,
            vaultRoot,
          }).catch(() => undefined);
        }
      }

      return readHostedGroupParticipantDisplayNamesFromOperationMemo({
        operationResolvedByHandle,
        senderHandles,
      });
    },
  };
}

export function resolveHostedGroupParticipantDisplayNameCachePath(
  vaultRoot: string,
): string {
  return path.join(
    resolveRuntimePaths(vaultRoot).cacheRoot,
    HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_DIRECTORY,
    HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_FILE,
  );
}

async function readHostedGroupParticipantDisplayNameCache(input: {
  cacheFilePath: string;
  nowMs: number;
  vaultRoot: string;
}): Promise<HostedGroupParticipantDisplayNameCacheRead> {
  try {
    const cachePath = resolveHostedGroupParticipantDisplayNameCachePathBoundary({
      cacheFilePath: input.cacheFilePath,
      vaultRoot: input.vaultRoot,
    });
    await assertHostedGroupParticipantDisplayNameCacheAncestor(
      cachePath.runtimeRoot,
    );
    await assertHostedGroupParticipantDisplayNameCacheAncestor(
      cachePath.cacheRoot,
    );
    await assertHostedGroupParticipantDisplayNameCacheAncestor(
      cachePath.cacheDirectory,
    );
    const cacheFileStats = await lstat(cachePath.cacheFilePath);
    if (cacheFileStats.isSymbolicLink() || !cacheFileStats.isFile()) {
      return invalidHostedGroupParticipantDisplayNameCacheRead();
    }
    await chmod(cachePath.cacheDirectory, ASSISTANT_STATE_DIRECTORY_MODE);
    await chmod(cachePath.cacheFilePath, ASSISTANT_STATE_FILE_MODE);
    if (
      cacheFileStats.size
      > HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_BYTES
    ) {
      return invalidHostedGroupParticipantDisplayNameCacheRead();
    }

    const { value } = await readVersionedJsonStateFile({
      currentPath: cachePath.cacheFilePath,
      label: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_LABEL,
      parseValue: parseHostedGroupParticipantDisplayNameCacheState,
      schema: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA,
      schemaVersion:
        HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA_VERSION,
    });
    const entries = value.entries.filter(
      (entry) => entry.expiresAtMs > input.nowMs,
    );
    return {
      entries,
      needsCleanup: entries.length !== value.entries.length,
      validFile: true,
    };
  } catch {
    return invalidHostedGroupParticipantDisplayNameCacheRead();
  }
}

function invalidHostedGroupParticipantDisplayNameCacheRead(): HostedGroupParticipantDisplayNameCacheRead {
  return {
    entries: [],
    needsCleanup: false,
    validFile: false,
  };
}

async function writeHostedGroupParticipantDisplayNameCacheUpdates(input: {
  cacheFilePath: string;
  nowMs: number;
  updates: readonly HostedGroupParticipantDisplayNameCacheStoredEntry[];
  vaultRoot: string;
}): Promise<void> {
  const current = await readHostedGroupParticipantDisplayNameCache({
    cacheFilePath: input.cacheFilePath,
    nowMs: input.nowMs,
    vaultRoot: input.vaultRoot,
  });
  const entries = [...current.entries];
  for (const update of input.updates) {
    const existingIndex = entries.findIndex((entry) => entry.key === update.key);
    if (existingIndex >= 0) {
      entries.splice(existingIndex, 1);
    }
    entries.push(update);
  }
  const boundedEntries = entries.length
    > HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES
    ? entries.slice(
        entries.length
        - HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES,
      )
    : entries;
  await writeHostedGroupParticipantDisplayNameCacheState({
    cacheFilePath: input.cacheFilePath,
    entries: boundedEntries,
    vaultRoot: input.vaultRoot,
  });
}

async function writeHostedGroupParticipantDisplayNameCacheState(input: {
  cacheFilePath: string;
  entries: readonly HostedGroupParticipantDisplayNameCacheStoredEntry[];
  vaultRoot: string;
}): Promise<void> {
  const cachePath = await ensureHostedGroupParticipantDisplayNameCacheDirectory({
    cacheFilePath: input.cacheFilePath,
    vaultRoot: input.vaultRoot,
  });
  await writeVersionedJsonStateFile({
    filePath: cachePath.cacheFilePath,
    mode: ASSISTANT_STATE_FILE_MODE,
    schema: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA,
    schemaVersion: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA_VERSION,
    value: {
      entries: [...input.entries],
    } satisfies HostedGroupParticipantDisplayNameCacheState,
  });
}

async function ensureHostedGroupParticipantDisplayNameCacheDirectory(
  input: {
    cacheFilePath: string;
    vaultRoot: string;
  },
): Promise<HostedGroupParticipantDisplayNameCachePathBoundary> {
  const cachePath = resolveHostedGroupParticipantDisplayNameCachePathBoundary(input);
  await ensureHostedGroupParticipantDisplayNameCacheAncestor(
    cachePath.runtimeRoot,
  );
  await ensureHostedGroupParticipantDisplayNameCacheAncestor(
    cachePath.cacheRoot,
  );
  await ensureHostedGroupParticipantDisplayNameCacheAncestor(
    cachePath.cacheDirectory,
  );
  try {
    const stats = await lstat(cachePath.cacheFilePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error(
        "Hosted group participant display-name cache path is not a file.",
      );
    }
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }
  await chmod(cachePath.cacheDirectory, ASSISTANT_STATE_DIRECTORY_MODE);
  return cachePath;
}

interface HostedGroupParticipantDisplayNameCachePathBoundary {
  cacheDirectory: string;
  cacheFilePath: string;
  cacheRoot: string;
  runtimeRoot: string;
}

function resolveHostedGroupParticipantDisplayNameCachePathBoundary(input: {
  cacheFilePath: string;
  vaultRoot: string;
}): HostedGroupParticipantDisplayNameCachePathBoundary {
  const runtimePaths = resolveRuntimePaths(input.vaultRoot);
  const cacheDirectory = path.join(
    runtimePaths.cacheRoot,
    HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_DIRECTORY,
  );
  const cacheFilePath = path.join(
    cacheDirectory,
    HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_FILE,
  );
  if (path.resolve(input.cacheFilePath) !== path.resolve(cacheFilePath)) {
    throw new Error(
      "Hosted group participant display-name cache path is outside its boundary.",
    );
  }
  return {
    cacheDirectory,
    cacheFilePath,
    cacheRoot: runtimePaths.cacheRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
  };
}

async function ensureHostedGroupParticipantDisplayNameCacheAncestor(
  directoryPath: string,
): Promise<void> {
  try {
    const stats = await lstat(directoryPath);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        "Hosted group participant display-name cache path is not a directory.",
      );
    }
    return;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
  }

  try {
    await mkdir(directoryPath, { mode: ASSISTANT_STATE_DIRECTORY_MODE });
  } catch (error) {
    if (!isPathExistsError(error)) {
      throw error;
    }
  }
  const stats = await lstat(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "Hosted group participant display-name cache path is not a directory.",
    );
  }
}

async function assertHostedGroupParticipantDisplayNameCacheAncestor(
  directoryPath: string,
): Promise<void> {
  const stats = await lstat(directoryPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "Hosted group participant display-name cache path is not a directory.",
    );
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT"
  );
}

function isPathExistsError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: unknown }).code === "EEXIST"
  );
}

function parseHostedGroupParticipantDisplayNameCacheState(
  value: unknown,
): HostedGroupParticipantDisplayNameCacheState {
  if (
    !isPlainObject(value)
    || !hasExactlyKeys(value, ["entries"])
    || !Array.isArray(value.entries)
    || value.entries.length
      > HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES
  ) {
    throw new TypeError(
      "Hosted group participant display-name cache must contain bounded entries.",
    );
  }

  const seenKeys = new Set<string>();
  const entries = value.entries.map((entry) => {
    const parsed = parseHostedGroupParticipantDisplayNameCacheEntry(entry);
    if (seenKeys.has(parsed.key)) {
      throw new TypeError(
        "Hosted group participant display-name cache keys must be unique.",
      );
    }
    seenKeys.add(parsed.key);
    return parsed;
  });
  return { entries };
}

function parseHostedGroupParticipantDisplayNameCacheEntry(
  value: unknown,
): HostedGroupParticipantDisplayNameCacheStoredEntry {
  if (
    !isPlainObject(value)
    || typeof value.key !== "string"
    || !HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_KEY_PATTERN.test(value.key)
    || typeof value.expiresAtMs !== "number"
    || !Number.isSafeInteger(value.expiresAtMs)
    || value.expiresAtMs <= 0
  ) {
    throw new TypeError(
      "Hosted group participant display-name cache entry is invalid.",
    );
  }

  if (
    value.kind === "negative"
    && hasExactlyKeys(value, ["expiresAtMs", "key", "kind"])
  ) {
    return {
      expiresAtMs: value.expiresAtMs,
      key: value.key,
      kind: "negative",
    };
  }

  if (
    value.kind === "positive"
    && hasExactlyKeys(value, [
      "displayName",
      "displayNameSource",
      "expiresAtMs",
      "key",
      "kind",
    ])
    && typeof value.displayName === "string"
    && normalizeHostedGroupParticipantDisplayName(value.displayName)
      === value.displayName
    && typeof value.displayNameSource === "string"
    && isHostedGroupParticipantDisplayNameSource(value.displayNameSource)
  ) {
    return {
      displayName: value.displayName,
      displayNameSource: value.displayNameSource,
      expiresAtMs: value.expiresAtMs,
      key: value.key,
      kind: "positive",
    };
  }

  throw new TypeError(
    "Hosted group participant display-name cache entry kind is invalid.",
  );
}

function hasExactlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readHostedGroupParticipantDisplayNamesFromOperationMemo(input: {
  operationResolvedByHandle: ReadonlyMap<
    string,
    AssistantGroupParticipantDisplayName | null
  >;
  senderHandles: readonly string[];
}): AssistantGroupParticipantDisplayName[] {
  return input.senderHandles.flatMap((senderHandle) => {
    const resolved = input.operationResolvedByHandle.get(senderHandle) ?? null;
    return resolved ? [resolved] : [];
  });
}

function isHostedGroupParticipantDisplayNameSource(
  value: string,
): value is AssistantGroupParticipantDisplayNameSource {
  return value === "profile-name" || value === "unverified-owner-contact";
}

function normalizeHostedGroupParticipantDisplayNameHandles(
  values: readonly string[],
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const senderHandle = value.trim();
    if (
      !senderHandle
      || seen.has(senderHandle)
      || [...senderHandle].length
        > HOSTED_RUNTIME_GROUP_SENDER_HANDLE_MAX_CODE_POINTS
    ) {
      continue;
    }
    seen.add(senderHandle);
    normalized.push(senderHandle);
    if (normalized.length >= HOSTED_RUNTIME_GROUP_CHAT_PARTICIPANTS_MAX) {
      break;
    }
  }
  return normalized;
}

function normalizeHostedGroupParticipantDisplayName(
  value: string | null | undefined,
): string | null {
  const normalized = value
    ?.replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return null;
  }
  return Array.from(normalized)
    .slice(0, HOSTED_RUNTIME_GROUP_DISPLAY_NAME_MAX_LENGTH)
    .join("");
}
