import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS,
  HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES,
  parseHostedVaultShareProjectionScopeKey,
  type HostedVaultShareActiveProjectionKindsResponse,
  type HostedVaultShareProjectionScope,
} from "@murphai/hosted-execution/vault-share";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  readDeliverableHostedVaultShareProjectionScopes,
} from "@/src/lib/hosted-mailbox/vault-share-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_VAULT_SHARE_ACTIVE_KINDS_BODY_LIMIT_BYTES = 0;
const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM = "supportedProjectionScope";
const HOSTED_VAULT_SHARE_LEGACY_SUPPORTED_PROJECTION_KIND_PARAM = "supportedProjectionKind";

const HOSTED_VAULT_SHARE_DEFAULT_SUPPORTED_PROJECTION_SCOPE_KEYS =
  new Set(HOSTED_VAULT_SHARE_KNOWN_PROJECTION_SCOPES
    .filter((scope) =>
      (HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS as readonly string[])
        .includes(scope.projectionKind)
      || scope.projectionKind === HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND
    )
    .map((scope) => buildHostedVaultShareProjectionScopeKey(scope)));

export const GET = withJsonError(async (request: Request) => {
  const grantorMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_VAULT_SHARE_ACTIVE_KINDS_BODY_LIMIT_BYTES,
  });
  const prisma = getPrisma();

  try {
    await requireHostedRuntimeActiveAccess(grantorMemberId, { prisma });
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return jsonOk({
        projectionKinds: [],
        projectionScopes: [],
      } satisfies HostedVaultShareActiveProjectionKindsResponse);
    }
    throw error;
  }

  const supportedProjectionScopeKeys = readSupportedProjectionScopeKeys(request);
  const projectionScopes = filterSupportedProjectionScopes(
    await readDeliverableHostedVaultShareProjectionScopes({
      grantorMemberId,
      prisma,
    }),
    supportedProjectionScopeKeys,
  );

  return jsonOk({
    projectionKinds: [...new Set(projectionScopes.map((scope) => scope.projectionKind))],
    projectionScopes: projectionScopes.sort((left, right) =>
      buildHostedVaultShareProjectionScopeKey(left)
        .localeCompare(buildHostedVaultShareProjectionScopeKey(right))
    ),
  } satisfies HostedVaultShareActiveProjectionKindsResponse);
});

function readSupportedProjectionScopeKeys(request: Request): Set<string> {
  const url = new URL(request.url);
  const values = url.searchParams.getAll(
    HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_SCOPE_PARAM,
  );
  if (values.length === 0) {
    return url.searchParams.has(HOSTED_VAULT_SHARE_LEGACY_SUPPORTED_PROJECTION_KIND_PARAM)
      ? new Set()
      : HOSTED_VAULT_SHARE_DEFAULT_SUPPORTED_PROJECTION_SCOPE_KEYS;
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

function filterSupportedProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
  supportedProjectionScopeKeys: ReadonlySet<string>,
): HostedVaultShareProjectionScope[] {
  return projectionScopes.filter((scope) =>
    supportedProjectionScopeKeys.has(buildHostedVaultShareProjectionScopeKey(scope))
  );
}
