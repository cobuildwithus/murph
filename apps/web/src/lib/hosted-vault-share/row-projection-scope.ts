import {
  buildHostedVaultShareProjectionScopeKey,
  parseHostedVaultShareProjectionScope,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

export function parseHostedVaultShareRowProjectionScope(row: {
  projectionKind: string;
  projectionScopeJson: unknown;
  projectionScopeKey: string;
}): HostedVaultShareProjectionScope | null {
  try {
    const scope = parseHostedVaultShareProjectionScope(
      row.projectionScopeJson ?? row.projectionKind,
      "Hosted vault-share row projection scope",
    );
    if (
      scope.projectionKind !== row.projectionKind
      || buildHostedVaultShareProjectionScopeKey(scope) !== row.projectionScopeKey
    ) {
      return null;
    }
    return scope;
  } catch {
    return null;
  }
}
