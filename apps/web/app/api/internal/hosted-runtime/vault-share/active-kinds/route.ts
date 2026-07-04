import {
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
  readDeliverableHostedVaultShareProjectionKinds,
} from "@/src/lib/hosted-mailbox/vault-share-store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
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
      return jsonOk({ projectionKinds: [] } satisfies HostedVaultShareActiveProjectionKindsResponse);
    }
    throw error;
  }

  return jsonOk({
    projectionKinds: await readDeliverableHostedVaultShareProjectionKinds({
      grantorMemberId,
      prisma,
    }),
  } satisfies HostedVaultShareActiveProjectionKindsResponse);
});
