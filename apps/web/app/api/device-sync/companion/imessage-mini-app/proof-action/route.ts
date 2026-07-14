import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import {
  IMessageMiniAppService,
  validateIMessageMiniAppProofAction,
} from "@/src/lib/imessage-mini-app/service";
import { assertHostedLaunchRequiredConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  const credential = await miniApp.requireCredential();

  // Credential issuance is not permanent account authority. Re-check the
  // owning member and current launch consent on every extension action.
  await assertActiveHostedMemberAccessAllowed({
    memberId: credential.userId,
    prisma,
  });
  await assertHostedLaunchRequiredConsentGranted({
    memberId: credential.userId,
    prisma,
  });

  const action = validateIMessageMiniAppProofAction(await readJsonObject(request));
  return jsonOk({
    schemaVersion: 1,
    authenticated: true,
    cardId: action.cardId,
    choice: action.choice,
  });
});
