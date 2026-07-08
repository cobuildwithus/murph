import type {
  HostedRuntimeGroupMemberSummary,
  HostedRuntimeGroupSummary,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import type {
  HostedVaultShareProjectionKind,
  HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  filterHostedVaultShareProjectionScopesBySupportedKeys,
} from "../hosted-vault-share/supported-projection-scopes";

export function filterHostedRuntimeGroupToolResponseProjectionScopes(
  response: HostedRuntimeGroupToolResponse,
  supportedProjectionScopeKeys: ReadonlySet<string>,
): HostedRuntimeGroupToolResponse {
  if (response.action === "read_current" && response.result.status === "ok") {
    return {
      ...response,
      result: {
        ...response.result,
        group: filterHostedRuntimeGroupSummaryProjectionScopes(
          response.result.group,
          supportedProjectionScopeKeys,
        ),
      },
    };
  }
  if (response.action === "create_join_link" && response.result.status === "ok") {
    return {
      ...response,
      result: {
        ...response.result,
        group: filterHostedRuntimeGroupSummaryProjectionScopes(
          response.result.group,
          supportedProjectionScopeKeys,
        ),
      },
    };
  }
  if (response.action === "update_display_name" && response.result.status === "ok") {
    return {
      ...response,
      result: {
        ...response.result,
        group: filterHostedRuntimeGroupSummaryProjectionScopes(
          response.result.group,
          supportedProjectionScopeKeys,
        ),
      },
    };
  }
  if (response.action === "post_join_offer" && response.result.status === "sent") {
    return {
      ...response,
      result: {
        ...response.result,
        group: filterHostedRuntimeGroupSummaryProjectionScopes(
          response.result.group,
          supportedProjectionScopeKeys,
        ),
      },
    };
  }
  return response;
}

function filterHostedRuntimeGroupSummaryProjectionScopes(
  group: HostedRuntimeGroupSummary,
  supportedProjectionScopeKeys: ReadonlySet<string>,
): HostedRuntimeGroupSummary {
  const requestedVaultShareProjectionScopes =
    filterHostedVaultShareProjectionScopesBySupportedKeys(
      group.requestedVaultShareProjectionScopes,
      supportedProjectionScopeKeys,
    );
  return {
    ...group,
    members: group.members.map((member) =>
      filterHostedRuntimeGroupMemberProjectionScopes(
        member,
        supportedProjectionScopeKeys,
      )
    ),
    requestedVaultShareProjectionKinds: projectionKindsFromScopes(
      requestedVaultShareProjectionScopes,
    ),
    requestedVaultShareProjectionScopes,
  };
}

function filterHostedRuntimeGroupMemberProjectionScopes(
  member: HostedRuntimeGroupMemberSummary,
  supportedProjectionScopeKeys: ReadonlySet<string>,
): HostedRuntimeGroupMemberSummary {
  const grantedVaultShareProjectionScopes =
    filterHostedVaultShareProjectionScopesBySupportedKeys(
      member.grantedVaultShareProjectionScopes,
      supportedProjectionScopeKeys,
    );
  return {
    ...member,
    grantedVaultShareProjectionKinds: projectionKindsFromScopes(
      grantedVaultShareProjectionScopes,
    ),
    grantedVaultShareProjectionScopes,
  };
}

function projectionKindsFromScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
): HostedVaultShareProjectionKind[] {
  return [...new Set(projectionScopes.map((scope) => scope.projectionKind))];
}
