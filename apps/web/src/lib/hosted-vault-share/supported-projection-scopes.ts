import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareProjectionScopeKey,
  type HostedVaultShareFixedProjectionKind,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

const SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";
const LEGACY_SUPPORTED_PROJECTION_KIND_PARAM = "supportedProjectionKind";

// Temporary omitted-capability fallback for runner bundles that predate exact
// supportedProjectionScope negotiation. Keep this frozen so future registry
// additions are not granted to runners that did not declare exact support.
const LEGACY_OMITTED_CAPABILITY_FIXED_PROJECTION_KINDS = [
  "group-email.v0",
  "profile-name.v0",
  "sleep-times.v0",
  "workout-days.v0",
  "heart-rate-zones-days.v0",
  "activity-days.v0",
  "steps-days.v0",
  "max-heart-rate-days.v0",
  "distance-days.v0",
  "active-calories-days.v0",
  "elevation-gain-days.v0",
  "floors-climbed-days.v0",
  "day-strain-days.v0",
  "workout-strain-days.v0",
  "activity-score-days.v0",
  "vo2-max-days.v0",
  "resting-heart-rate-days.v0",
  "hrv-days.v0",
] as const satisfies readonly HostedVaultShareFixedProjectionKind[];

const DEFAULT_SUPPORTED_PROJECTION_SCOPE_KEYS =
  new Set([
    ...LEGACY_OMITTED_CAPABILITY_FIXED_PROJECTION_KINDS
      .map((projectionKind) => buildHostedVaultShareProjectionScopeKey({
        projectionKind,
      })),
    ...HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES
      .filter((scope) =>
        scope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND
      )
      .map((scope) => buildHostedVaultShareProjectionScopeKey(scope)),
  ]);

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
