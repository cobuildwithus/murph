import {
  ASSISTANT_HOSTED_GROUP_SHARED_READ_MAX_PROJECTION_SCOPES,
  type AssistantHostedGroupSharedReader,
} from "@murphai/assistant-engine";
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
