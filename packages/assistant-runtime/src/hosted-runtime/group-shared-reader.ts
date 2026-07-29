import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
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
const HOSTED_GROUP_SHARED_SELECTABLE_SCOPE_BY_KEY = new Map(
  HOSTED_VAULT_SHARE_SELECTABLE_PROJECTION_SCOPES.map((projectionScope) => [
    buildHostedVaultShareProjectionScopeKey(projectionScope),
    projectionScope,
  ]),
);

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
 * Presentation-only current-turn label lookup. Web remains the exact current
 * membership/profile policy and owner-contact authority; this adapter supplies
 * only route-admitted Linq handles and preserves Web's display provenance.
 * Failure leaves the transcript safely unnamed.
 */
export function createHostedGroupParticipantDisplayNameReader(input: {
  groupToolPort: HostedRuntimeGroupToolPort | null;
}): AssistantHostedGroupParticipantDisplayNameReader {
  return {
    async read(request) {
      if (request.channel !== "linq" || !input.groupToolPort) {
        return [];
      }
      const senderHandles = normalizeHostedGroupParticipantDisplayNameHandles(
        request.senderHandles,
      );
      if (senderHandles.length === 0) {
        return [];
      }

      try {
        const response = await input.groupToolPort.request({
          action: "read_participant_display_names",
          linqSenderHandles: senderHandles,
        });
        if (response.action !== "read_participant_display_names") {
          return [];
        }
        const result = response.result;
        if (result.status !== "ok") {
          return [];
        }

        return senderHandles.flatMap((senderHandle) => {
          const participants = result.participants.filter((participant) =>
            participant.senderHandle === senderHandle
          );
          if (participants.length !== 1) {
            return [];
          }
          const participant = participants[0];
          if (!participant) {
            return [];
          }
          const displayName = normalizeHostedGroupParticipantDisplayName(
            participant.displayName,
          );
          return displayName
            ? [{
                displayName,
                displayNameSource: participant.displayNameSource,
                senderHandle,
              }]
            : [];
        });
      } catch {
        return [];
      }
    },
  };
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
