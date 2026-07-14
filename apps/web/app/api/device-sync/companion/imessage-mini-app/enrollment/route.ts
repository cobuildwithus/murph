import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { requirePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import {
  issueIMessageMiniAppEnrollment,
  IMessageMiniAppService,
  validateIMessageMiniAppEnrollmentBody,
} from "@/src/lib/imessage-mini-app/service";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  validateIMessageMiniAppEnrollmentBody(await readJsonObject(request, {
    limitBytes: 1_024,
  }));
  const prisma = getPrisma();
  const auth = await requirePrivyMemberAuthFromBearerToken(request, prisma);

  return jsonOk(await issueIMessageMiniAppEnrollment({
    memberId: auth.member.id,
    prisma,
  }));
});

export const DELETE = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  const credential = await miniApp.requireCredential();

  return jsonOk(await miniApp.revoke(credential));
});
