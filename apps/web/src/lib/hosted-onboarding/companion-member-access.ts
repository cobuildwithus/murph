import { HostedBillingStatus, type PrismaClient } from "@prisma/client";
import { readHostedNativeMemberAuth } from "../better-auth/native-auth";
import { getPrisma } from "../prisma";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";
import { readHostedAuthenticationCompletion } from "./authentication-completion";
import { updateHostedMemberPendingActivationTimeZoneIfActivationPending } from "./hosted-member-store";
import { ensureHostedStarterUsageEnrollment, retryPendingHostedStarterUsageActivationRuntimeWake } from "./starter-usage-enrollment-service";
import { hostedOnboardingError } from "./errors";
import { assertActiveHostedMemberAccessAllowed, readActiveHostedMemberAccess } from "./member-access";

// Authentication owns signup; companion admission reuses canonical consent,
// billing and activation without a second native identity owner.
export async function requireHostedCompanionMemberIdFromRequest(input: {
  prisma?: PrismaClient;
  request: Request;
  timeZone?: string | null;
}): Promise<string> {
  const prisma = input.prisma ?? getPrisma();
  const auth = await readHostedNativeMemberAuth(input.request, prisma);
  await assertHostedHistoricalLaunchConsentGranted({ memberId: auth.member.id, prisma });
  if (input.timeZone) await updateHostedMemberPendingActivationTimeZoneIfActivationPending({ memberId: auth.member.id, pendingActivationTimeZone: input.timeZone, prisma });
  // Existing active members do not need acquisition data or a new invite.
  if (await readActiveHostedMemberAccess({ memberId: auth.member.id, prisma })) {
    await requireHostedCompanionActivationRuntimeWake({ memberId: auth.member.id, prisma });
    return auth.member.id;
  }

  // Only untouched acquisition state may enter Starter enrollment. Lapsed and
  // incomplete billing retain their existing recovery owner.
  if (auth.member.billingStatus === HostedBillingStatus.not_started) {
    const completion = await readHostedAuthenticationCompletion({ member: auth.member, prisma });
    await ensureHostedStarterUsageEnrollment({
      inviteCode: completion.inviteCode,
      member: { id: auth.member.id, suspendedAt: auth.member.suspendedAt },
      now: new Date(),
      prisma,
      source: "companion_onboarding",
    });
  }

  await assertActiveHostedMemberAccessAllowed({ memberId: auth.member.id, prisma });
  return auth.member.id;
}

async function requireHostedCompanionActivationRuntimeWake(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<void> {
  const runtimeWake =
    await retryPendingHostedStarterUsageActivationRuntimeWake(input);
  if (runtimeWake && !runtimeWake.accepted) {
    throw hostedOnboardingError({
      code: "HOSTED_STARTER_USAGE_RUNTIME_WAKE_REQUIRED",
      httpStatus: 503,
      message: "Murph account setup is waiting for runtime recovery.",
      retryable: true,
    });
  }
}
