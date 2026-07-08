import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareProjectionScopeKey,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

const SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";
const LEGACY_SUPPORTED_PROJECTION_KIND_PARAM = "supportedProjectionKind";

const DEFAULT_SUPPORTED_PROJECTION_SCOPE_KEYS =
  new Set(HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES
    .filter((scope) =>
      (HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS as readonly string[])
        .includes(scope.projectionKind)
      || scope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND
    )
    .map((scope) => buildHostedVaultShareProjectionScopeKey(scope)));

export function readHostedVaultShareSupportedProjectionScopeKeysFromRequest(
  request: Request,
): Set<string> {
  const url = new URL(request.url);
  const values = url.searchParams.getAll(SUPPORTED_PROJECTION_SCOPE_PARAM);
  if (values.length === 0) {
    return url.searchParams.has(LEGACY_SUPPORTED_PROJECTION_KIND_PARAM)
      ? new Set()
      : new Set(DEFAULT_SUPPORTED_PROJECTION_SCOPE_KEYS);
  }

  const supported = new Set<string>();
  for (const value of values) {
    try {
      supported.add(buildHostedVaultShareProjectionScopeKey(
        parseHostedVaultShareProjectionScopeKey(
          value,
          "Vault share supported projection scope",
        ),
      ));
    } catch {
      // Unknown future scopes are not a reason to fall back to legacy support.
    }
  }
  return supported;
}

export function filterHostedVaultShareProjectionScopesBySupportedKeys(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
  supportedProjectionScopeKeys: ReadonlySet<string>,
): HostedVaultShareProjectionScope[] {
  return projectionScopes.filter((scope) =>
    supportedProjectionScopeKeys.has(buildHostedVaultShareProjectionScopeKey(scope))
  );
}
