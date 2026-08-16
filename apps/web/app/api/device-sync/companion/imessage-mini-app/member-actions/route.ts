import { deviceSyncError } from "@murphai/device-syncd/errors";

import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import {
  IMessageMiniAppService,
  validateIMessageMiniAppMemberAction,
} from "@/src/lib/imessage-mini-app/service";
import { submitMemberAction } from "@/src/lib/member-actions/submit";
import { getPrisma } from "@/src/lib/prisma";

const IMESSAGE_MEMBER_ACTION_BODY_LIMIT_BYTES = 24 * 1_024;

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  const credential = await miniApp.requireCredential();
  const action = validateIMessageMiniAppMemberAction(
    await readJsonObject(request, {
      limitBytes: IMESSAGE_MEMBER_ACTION_BODY_LIMIT_BYTES,
    }),
  );
  const result = await submitMemberAction({
    memberId: credential.userId,
    prisma,
    request: action,
  });

  if (result.dedupeConflict) {
    throw deviceSyncError({
      code: "IMESSAGE_MINI_APP_ACTION_CONFLICT",
      httpStatus: 409,
      message: "This action identity was already used for a different request.",
      retryable: false,
    });
  }

  return Response.json({
    accepted: result.accepted,
    actionId: result.actionId,
    duplicate: result.duplicate,
    schemaVersion: result.schemaVersion,
  }, { status: 202 });
});
