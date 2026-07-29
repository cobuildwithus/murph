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
// A successful omission can represent a new profile/contact not yet shared,
// so keep negative reuse short without adding mutation-time invalidation.
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_NEGATIVE_TTL_MS = 5 * 60 * 1_000;
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_POSITIVE_TTL_MS = 60 * 60 * 1_000;
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
      const hasUnexpectedParticipant = response.result.participants.some(
        (participant) => !requestedHandleSet.has(participant.senderHandle),
      );
      if (hasUnexpectedParticipant) {
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
          cacheUpdates.push({
            expiresAtMs:
              filledAtMs
              + HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_NEGATIVE_TTL_MS,
            key: buildCacheKey(senderHandle),
            kind: "negative",
          });
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
}): Promise<HostedGroupParticipantDisplayNameCacheRead> {
  try {
    const cacheDirectory = path.dirname(input.cacheFilePath);
    const cacheDirectoryStats = await lstat(cacheDirectory);
    const cacheFileStats = await lstat(input.cacheFilePath);
    if (
      cacheDirectoryStats.isSymbolicLink()
      || !cacheDirectoryStats.isDirectory()
      || cacheFileStats.isSymbolicLink()
      || !cacheFileStats.isFile()
    ) {
      return invalidHostedGroupParticipantDisplayNameCacheRead();
    }
    await chmod(cacheDirectory, ASSISTANT_STATE_DIRECTORY_MODE);
    await chmod(input.cacheFilePath, ASSISTANT_STATE_FILE_MODE);
    if (
      cacheFileStats.size
      > HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_BYTES
    ) {
      return invalidHostedGroupParticipantDisplayNameCacheRead();
    }

    const { value } = await readVersionedJsonStateFile({
      currentPath: input.cacheFilePath,
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
}): Promise<void> {
  const current = await readHostedGroupParticipantDisplayNameCache({
    cacheFilePath: input.cacheFilePath,
    nowMs: input.nowMs,
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
  });
}

async function writeHostedGroupParticipantDisplayNameCacheState(input: {
  cacheFilePath: string;
  entries: readonly HostedGroupParticipantDisplayNameCacheStoredEntry[];
}): Promise<void> {
  await ensureHostedGroupParticipantDisplayNameCacheDirectory(
    path.dirname(input.cacheFilePath),
  );
  await writeVersionedJsonStateFile({
    filePath: input.cacheFilePath,
    mode: ASSISTANT_STATE_FILE_MODE,
    schema: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA,
    schemaVersion: HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_SCHEMA_VERSION,
    value: {
      entries: [...input.entries],
    } satisfies HostedGroupParticipantDisplayNameCacheState,
  });
}

async function ensureHostedGroupParticipantDisplayNameCacheDirectory(
  cacheDirectory: string,
): Promise<void> {
  await mkdir(cacheDirectory, {
    mode: ASSISTANT_STATE_DIRECTORY_MODE,
    recursive: true,
  });
  const stats = await lstat(cacheDirectory);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      "Hosted group participant display-name cache path is not a directory.",
    );
  }
  await chmod(cacheDirectory, ASSISTANT_STATE_DIRECTORY_MODE);
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
