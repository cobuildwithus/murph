import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS,
  isHostedVaultShareProjectionKind,
  type HostedVaultShareActiveProjectionKindsResponse,
  type HostedVaultShareProjectionKind,
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
const HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_KIND_PARAM = "supportedProjectionKind";

const HOSTED_VAULT_SHARE_DEFAULT_SUPPORTED_PROJECTION_KINDS =
  new Set<HostedVaultShareProjectionKind>([
    ...HOSTED_VAULT_SHARE_FIXED_PROJECTION_KINDS,
    HOSTED_VAULT_SHARE_ACTIVITY_MINUTES_PROJECTION_KIND,
  ]);

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

  const supportedProjectionKinds = readSupportedProjectionKinds(request);
  const projectionScopes = filterSupportedProjectionScopes(
    await readDeliverableHostedVaultShareProjectionScopes({
      grantorMemberId,
      prisma,
    }),
    supportedProjectionKinds,
  );

  return jsonOk({
    projectionKinds: [...new Set(projectionScopes.map((scope) => scope.projectionKind))],
    projectionScopes: projectionScopes.sort((left, right) =>
      buildHostedVaultShareProjectionScopeKey(left)
        .localeCompare(buildHostedVaultShareProjectionScopeKey(right))
    ),
  } satisfies HostedVaultShareActiveProjectionKindsResponse);
});

function readSupportedProjectionKinds(request: Request): Set<HostedVaultShareProjectionKind> {
  const url = new URL(request.url);
  const values = url.searchParams.getAll(
    HOSTED_VAULT_SHARE_SUPPORTED_PROJECTION_KIND_PARAM,
  );
  if (values.length === 0) {
    return HOSTED_VAULT_SHARE_DEFAULT_SUPPORTED_PROJECTION_KINDS;
  }

  const supported = new Set<HostedVaultShareProjectionKind>();
  for (const value of values) {
    if (isHostedVaultShareProjectionKind(value)) {
      supported.add(value);
    }
  }

  return supported.size === 0
    ? HOSTED_VAULT_SHARE_DEFAULT_SUPPORTED_PROJECTION_KINDS
    : supported;
}

function filterSupportedProjectionScopes(
  projectionScopes: readonly HostedVaultShareProjectionScope[],
  supportedProjectionKinds: ReadonlySet<HostedVaultShareProjectionKind>,
): HostedVaultShareProjectionScope[] {
  return projectionScopes.filter((scope) =>
    supportedProjectionKinds.has(scope.projectionKind)
  );
}
