import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import {
  createHostedVaultSyncSession,
  listHostedVaultSyncSessions,
} from "@/src/lib/vault-sync/session-service";

export const GET = withJsonError(async (request: Request) => {
  const auth = await requireActivePrivyMemberAuth(request);
  return jsonOk({
    ok: true,
    sessions: await listHostedVaultSyncSessions({ memberId: auth.member.id }),
  });
});

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActivePrivyMemberAuth(request);
  const result = await createHostedVaultSyncSession({ memberId: auth.member.id });
  return jsonOk({
    ok: true,
    pairingCode: result.pairingCode,
    session: result.session,
  });
});
