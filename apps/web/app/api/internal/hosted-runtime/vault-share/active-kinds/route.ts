import {
  buildHostedVaultShareProjectionScopeKey,
  type HostedVaultShareActiveProjectionKindsResponse,
} from "@murphai/hosted-execution/vault-share";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  isHostedRuntimeInactiveAccessError,
  requireHostedRuntimeActiveAccess,
} from "@/src/lib/hosted-mailbox/runtime-access";
import {
  readDeliverableHostedVaultShareProjectionScopeGenerations,
} from "@/src/lib/hosted-vault-share/projection-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import {
  filterHostedVaultShareProjectionScopesBySupportedKeys,
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest,
} from "@/src/lib/hosted-vault-share/supported-projection-scopes";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_VAULT_SHARE_ACTIVE_KINDS_BODY_LIMIT_BYTES = 0;

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

  const supportedProjectionScopeKeys =
    readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request);
  const generations = await readDeliverableHostedVaultShareProjectionScopeGenerations({
      grantorMemberId,
      prisma,
    });
  const projectionScopes = filterHostedVaultShareProjectionScopesBySupportedKeys(
    generations.map((generation) => generation.projectionScope),
    supportedProjectionScopeKeys,
  );
  const supportedScopeKeys = new Set(
    projectionScopes.map(buildHostedVaultShareProjectionScopeKey),
  );

  return jsonOk({
    projectionKinds: [...new Set(projectionScopes.map((scope) => scope.projectionKind))],
    projectionScopes: projectionScopes.sort((left, right) =>
      buildHostedVaultShareProjectionScopeKey(left)
        .localeCompare(buildHostedVaultShareProjectionScopeKey(right))
    ),
    generationTokensByProjectionScopeKey: Object.fromEntries(
      generations
        .filter((generation) =>
          supportedScopeKeys.has(
            buildHostedVaultShareProjectionScopeKey(generation.projectionScope),
          )
        )
        .map((generation) => [
          buildHostedVaultShareProjectionScopeKey(generation.projectionScope),
          generation.generationToken,
        ]),
    ),
  } satisfies HostedVaultShareActiveProjectionKindsResponse);
});
