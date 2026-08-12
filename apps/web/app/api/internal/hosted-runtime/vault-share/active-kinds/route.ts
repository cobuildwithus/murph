import {
  buildHostedVaultShareProjectionScopeKey,
  HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE,
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
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  filterHostedVaultShareProjectionScopesBySupportedKeys,
  readHostedVaultShareProjectionModeFromRequest,
  readHostedVaultShareSupportedProjectionScopeKeysFromRequest,
  supportsHostedVaultShareDeferredProjectionWork,
} from "@/src/lib/hosted-vault-share/supported-projection-scopes";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_VAULT_SHARE_ACTIVE_KINDS_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const grantorMemberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_VAULT_SHARE_ACTIVE_KINDS_BODY_LIMIT_BYTES,
  });
  const prisma = getPrisma();
  const projectionMode = readHostedVaultShareProjectionModeFromRequest(request);

  try {
    await requireHostedRuntimeActiveAccess(grantorMemberId, { prisma });
  } catch (error) {
    if (isHostedRuntimeInactiveAccessError(error)) {
      return jsonOk({
        hasDeferredProjectionWork: false,
        ...(projectionMode ? { projectionMode } : {}),
        projectionKinds: [],
        projectionScopes: [],
      } satisfies HostedVaultShareActiveProjectionKindsResponse);
    }
    throw error;
  }

  const supportedProjectionScopeKeys =
    readHostedVaultShareSupportedProjectionScopeKeysFromRequest(request);
  const projectionWork = await readDeliverableHostedVaultShareProjectionScopeGenerations({
    grantorMemberId,
    prisma,
    projectionMode,
    supportedProjectionScopeKeys,
  });
  const generations = projectionWork.generations;
  const projectionScopes = filterHostedVaultShareProjectionScopesBySupportedKeys(
    generations.map((generation) => generation.projectionScope),
    supportedProjectionScopeKeys,
  );
  const supportedScopeKeys = new Set(
    projectionScopes.map(buildHostedVaultShareProjectionScopeKey),
  );
  const hasDeferredProjectionWork = projectionWork.hasDeferredProjectionWork;
  if (
    hasDeferredProjectionWork
    && !supportsHostedVaultShareDeferredProjectionWork(request)
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_VAULT_SHARE_DEFERRED_WORK_CAPABILITY_REQUIRED",
      httpStatus: 503,
      message: "Hosted vault-share projection work requires a compatible runtime. Retry the request.",
      retryable: true,
    });
  }

  return jsonOk({
    hasDeferredProjectionWork,
    ...(projectionMode === HOSTED_VAULT_SHARE_FIRST_MATERIALIZATION_MODE
      ? { projectionMode }
      : {}),
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
