import { createBrowserVaultSessionRoute } from "@/src/lib/browser-vault/session-handler";
import {
  buildSettingsSensitiveActionBinding,
  verifyAndConsumeSensitiveActionChallenge,
} from "@/src/lib/sensitive-actions/server";

export const POST = createBrowserVaultSessionRoute({
  authorize: async ({ auth, body, prisma }) => {
    await verifyAndConsumeSensitiveActionChallenge({
      authorization: body.authorization,
      bindingHash: buildSettingsSensitiveActionBinding({
        kind: "vault.export",
        memberId: auth.member.id,
        sessionId: auth.sessionId,
      }),
      kind: "vault.export",
      memberId: auth.member.id,
      prisma,
      privyUserId: auth.privyUserId,
    });
  },
  requireActiveAccess: false,
  requireFreshReplica: true,
});
