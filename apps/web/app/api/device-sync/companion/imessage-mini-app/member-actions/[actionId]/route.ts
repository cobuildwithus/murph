import { memberActionIdV1Schema } from "@murphai/contracts";
import { deviceSyncError } from "@murphai/device-syncd/errors";

import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { withJsonError } from "@/src/lib/device-sync/settings-http";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import { IMessageMiniAppService } from "@/src/lib/imessage-mini-app/service";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { readMemberActionStatus } from "@/src/lib/member-actions/outcome";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ actionId: string }> },
) => {
  const prisma = getPrisma();
  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  const credential = await miniApp.requireCredential();
  const { actionId: rawActionId } = await context.params;
  const parsedActionId = memberActionIdV1Schema.safeParse(rawActionId);
  if (!parsedActionId.success) {
    throw deviceSyncError({
      code: "IMESSAGE_MINI_APP_ACTION_INVALID",
      httpStatus: 400,
      message: "The member action identity is invalid.",
      retryable: false,
    });
  }
  const actionId = parsedActionId.data;

  await assertActiveHostedMemberAccessAllowed({
    memberId: credential.userId,
    prisma,
  });
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: credential.userId,
    prisma,
  });

  return Response.json(await readMemberActionStatus({
    actionId,
    memberId: credential.userId,
    prisma,
  }));
});
