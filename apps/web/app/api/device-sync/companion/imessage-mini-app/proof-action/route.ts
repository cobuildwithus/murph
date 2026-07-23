import { PrismaHostedAgentSessionStore } from "@/src/lib/device-sync/prisma-store/agent-sessions";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { readJsonObject } from "@/src/lib/http";
import { assertActiveHostedMemberAccessAllowed } from "@/src/lib/hosted-onboarding/member-access";
import {
  IMessageMiniAppService,
  validateIMessageMiniAppProofAction,
} from "@/src/lib/imessage-mini-app/service";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const POST = withJsonError(async (request: Request) => {
  const prisma = getPrisma();
  const miniApp = new IMessageMiniAppService({
    request,
    store: new PrismaHostedAgentSessionStore(prisma),
  });
  const credential = await miniApp.requireCredential();

  // Credential issuance is not permanent account authority. Re-check the
  // owning member and launch consent on every extension action. Proof taps
  // happen inside the iMessage extension with no consent UI, so stale
  // launch-document acceptance must not break them; members with no grant at
  // all still fail closed. Enrollment keeps requiring the current versions.
  await assertActiveHostedMemberAccessAllowed({
    memberId: credential.userId,
    prisma,
  });
  await assertHostedHistoricalLaunchConsentGranted({
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
