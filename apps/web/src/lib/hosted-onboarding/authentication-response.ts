import "server-only";
import type { PrismaClient } from "@prisma/client";
import { readHostedConsentStatus } from "../legal/consent";
import { getHostedInviteStatus } from "./invite-service";
import type { readHostedAuthenticationCompletion } from "./authentication-completion";

export async function readHostedAuthenticationResponse(
  result: Awaited<ReturnType<typeof readHostedAuthenticationCompletion>>,
  prisma: PrismaClient,
) {
  const [status, consent] = await Promise.all([
    getHostedInviteStatus({ authenticatedMember: result.member, inviteCode: result.inviteCode, prisma }),
    // An unavailable consent projection must never be interpreted as a grant.
    readHostedConsentStatus({ memberId: result.memberId, prisma }).catch(() => null),
  ]);
  return {
    ok: true,
    inviteCode: result.inviteCode,
    joinUrl: `/join/${encodeURIComponent(result.inviteCode)}`,
    launchConsentGranted: consent?.launchGranted ?? false,
    ...(consent && !consent.launchGranted ? { launchConsentStatus: consent } : {}),
    messagingSetupRequired: result.messagingSetupRequired,
    stage: result.stage,
    status,
  };
}
