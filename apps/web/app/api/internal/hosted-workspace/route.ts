import {
  parseHostedWorkspaceReadResponse,
} from "@murphai/hosted-execution/parsers";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  hasHostedMemberActiveAccess,
} from "@/src/lib/hosted-onboarding/entitlement";
import {
  hostedOnboardingError,
} from "@/src/lib/hosted-onboarding/errors";
import {
  readHostedMemberCoreState,
} from "@/src/lib/hosted-onboarding/hosted-member-store";
import { readHostedWorkspace } from "@/src/lib/hosted-workspace/store";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES = 0;

export const GET = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_WORKSPACE_READ_CALLBACK_BODY_LIMIT_BYTES,
  });
  await requireHostedRuntimeWorkspaceReadActiveAccess(userId);
  const workspace = await readHostedWorkspace({ userId });

  return jsonOk(parseHostedWorkspaceReadResponse({
    fetchedAt: new Date().toISOString(),
    workspace: workspace
      ? {
          browserVaultReplicaRef: workspace.browserVaultReplicaRef,
          checkpointedAt: workspace.checkpointedAt,
          createdAt: workspace.createdAt,
          nextWakeAt: workspace.nextWakeAt,
          nextWakeReason: workspace.nextWakeReason,
          redactedStatus: workspace.redactedStatusJson,
          snapshotRef: workspace.snapshotRef,
          updatedAt: workspace.updatedAt,
          userId: workspace.userId,
          version: workspace.version,
        }
      : null,
  }));
});

async function requireHostedRuntimeWorkspaceReadActiveAccess(userId: string): Promise<void> {
  const member = await readHostedMemberCoreState({
    memberId: userId,
    prisma: getPrisma(),
  });

  if (member && hasHostedMemberActiveAccess(member)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_RUNTIME_WORKSPACE_USER_INACTIVE",
    httpStatus: 403,
    message: "Hosted runtime workspace access is not active.",
  });
}
