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

import type { HostedRuntimeGroupToolPort } from "./platform.ts";

const GROUP_SHARED_REQUEST_INVALID = "group_shared_request_invalid";
const GROUP_SHARED_READ_FAILED = "group_shared_read_failed";
const GROUP_SHARED_RESULT_INVALID = "group_shared_result_invalid";
const GROUP_TOOL_UNAVAILABLE = "group_tool_unavailable";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_NAMESPACE =
  "linq-participant-display-name.v1";
const HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES = 2_048;
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

const hostedGroupParticipantDisplayNameCache = new Map<
  string,
  HostedGroupParticipantDisplayNameCacheEntry
>();

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
 * membership/profile policy and owner-contact authority. This adapter owns the
 * operation-local memo plus a bounded opportunistic process cache scoped by the
 * callback-bound runtime member and exact accepted-input route. Failure leaves
 * the transcript safely unnamed and is never promoted beyond the operation.
 */
export function createHostedGroupParticipantDisplayNameReader(input: {
  groupToolPort: HostedRuntimeGroupToolPort | null;
  routeConversationKey: string;
  runtimeMemberId: string;
}): AssistantHostedGroupParticipantDisplayNameReader {
  const operationResolvedByHandle = new Map<
    string,
    AssistantGroupParticipantDisplayName | null
  >();
  const routeConversationKey = input.routeConversationKey.trim();
  const runtimeMemberId = input.runtimeMemberId.trim();
  const buildCacheKey = (senderHandle: string) => JSON.stringify([
    HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_NAMESPACE,
    runtimeMemberId,
    routeConversationKey,
    "linq",
    senderHandle,
  ]);
  const memoizeUnavailable = (senderHandles: readonly string[]) => {
    for (const senderHandle of senderHandles) {
      operationResolvedByHandle.set(senderHandle, null);
    }
  };

  const resolveMisses = async (senderHandles: readonly string[]) => {
    if (!input.groupToolPort) {
      memoizeUnavailable(senderHandles);
      return;
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
        return;
      }

      const requestedHandleSet = new Set(senderHandles);
      const hasUnexpectedParticipant = response.result.participants.some(
        (participant) => !requestedHandleSet.has(participant.senderHandle),
      );
      if (hasUnexpectedParticipant) {
        memoizeUnavailable(senderHandles);
        return;
      }
      const filledAtMs = Date.now();
      pruneExpiredHostedGroupParticipantDisplayNameCacheEntries(filledAtMs);

      for (const senderHandle of senderHandles) {
        const participants = response.result.participants.filter(
          (participant) => participant.senderHandle === senderHandle,
        );
        if (participants.length === 0) {
          operationResolvedByHandle.set(senderHandle, null);
          writeHostedGroupParticipantDisplayNameCacheEntry({
            cacheKey: buildCacheKey(senderHandle),
            entry: {
              expiresAtMs:
                filledAtMs
                + HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_NEGATIVE_TTL_MS,
              kind: "negative",
            },
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
          continue;
        }

        const resolved = {
          displayName,
          displayNameSource: participant.displayNameSource,
          senderHandle,
        } satisfies AssistantGroupParticipantDisplayName;
        operationResolvedByHandle.set(senderHandle, resolved);
        writeHostedGroupParticipantDisplayNameCacheEntry({
          cacheKey: buildCacheKey(senderHandle),
          entry: {
            displayName,
            displayNameSource: participant.displayNameSource,
            expiresAtMs:
              filledAtMs
              + HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_POSITIVE_TTL_MS,
            kind: "positive",
          },
        });
      }
    } catch {
      memoizeUnavailable(senderHandles);
    }
  };

  return {
    async read(request) {
      if (
        request.channel !== "linq"
        || !input.groupToolPort
        || !routeConversationKey
        || !runtimeMemberId
      ) {
        return [];
      }
      const senderHandles = normalizeHostedGroupParticipantDisplayNameHandles(
        request.senderHandles,
      );
      if (senderHandles.length === 0) {
        return [];
      }

      const unresolvedHandles: string[] = [];
      const nowMs = Date.now();
      for (const senderHandle of senderHandles) {
        if (operationResolvedByHandle.has(senderHandle)) {
          continue;
        }
        const cached = readHostedGroupParticipantDisplayNameCacheEntry(
          buildCacheKey(senderHandle),
          nowMs,
        );
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

      if (unresolvedHandles.length > 0) {
        await resolveMisses(unresolvedHandles);
      }
      return readHostedGroupParticipantDisplayNamesFromOperationMemo({
        operationResolvedByHandle,
        senderHandles,
      });
    },
  };
}

function readHostedGroupParticipantDisplayNameCacheEntry(
  cacheKey: string,
  nowMs: number,
): HostedGroupParticipantDisplayNameCacheEntry | null {
  const cached = hostedGroupParticipantDisplayNameCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (cached.expiresAtMs <= nowMs) {
    hostedGroupParticipantDisplayNameCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function writeHostedGroupParticipantDisplayNameCacheEntry(input: {
  cacheKey: string;
  entry: HostedGroupParticipantDisplayNameCacheEntry;
}): void {
  hostedGroupParticipantDisplayNameCache.delete(input.cacheKey);
  hostedGroupParticipantDisplayNameCache.set(input.cacheKey, input.entry);
  while (
    hostedGroupParticipantDisplayNameCache.size
    > HOSTED_GROUP_PARTICIPANT_DISPLAY_NAME_CACHE_MAX_ENTRIES
  ) {
    const oldestCacheKey =
      hostedGroupParticipantDisplayNameCache.keys().next().value;
    if (typeof oldestCacheKey !== "string") {
      return;
    }
    hostedGroupParticipantDisplayNameCache.delete(oldestCacheKey);
  }
}

function pruneExpiredHostedGroupParticipantDisplayNameCacheEntries(
  nowMs: number,
): void {
  for (const [cacheKey, cached] of hostedGroupParticipantDisplayNameCache) {
    if (cached.expiresAtMs <= nowMs) {
      hostedGroupParticipantDisplayNameCache.delete(cacheKey);
    }
  }
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
