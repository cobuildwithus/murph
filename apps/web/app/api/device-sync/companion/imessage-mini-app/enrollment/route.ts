import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { requireActivePrivyMemberAuthFromBearerToken } from "@/src/lib/hosted-onboarding/request-auth";
import { IMessageMiniAppService, validateIMessageMiniAppEnrollmentBody } from "@/src/lib/imessage-mini-app/service";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuthFromBearerToken(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  validateIMessageMiniAppEnrollmentBody(await readJsonObject(request));

  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  return jsonOk(await miniApp.enroll(auth.member.id));
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
