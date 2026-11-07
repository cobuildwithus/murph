import "server-only";

import type { PrismaClient } from "@prisma/client";
import { memberActionIdV1Schema, type MemberActionRequestV1 } from "@murphai/contracts";
import { assertHostedNativeMemberAuthCurrentTx, type HostedNativeMemberAuth } from "../better-auth/native-auth";
import { assertBrowserVaultMemberAuthority } from "../browser-vault/authority";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { requireActiveHostedMemberAuthFromBearerToken } from "../hosted-onboarding/request-auth";
import { readMemberActionStatus } from "../member-actions/outcome";
import { submitMemberAction } from "../member-actions/submit";
import { getPrisma } from "../prisma";

export async function submitCompanionMemberAction(input: {
  auth: HostedNativeMemberAuth;
  prisma: PrismaClient;
  request: MemberActionRequestV1;
}) {
  const { auth, prisma, request } = input;
  const result = await submitMemberAction({
    memberId: auth.member.id, prisma, request,
    assertCurrentAuthorityTx: async tx => {
      await assertHostedNativeMemberAuthCurrentTx(auth, tx);
      await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: tx });
    },
  });
  if (result.dedupeConflict) {
    throw hostedOnboardingError({
      code: "MEMBER_ACTION_ID_CONFLICT", httpStatus: 409,
      message: "That action identity already belongs to a different request.", retryable: false,
    });
  }
  return { accepted: true as const, actionId: result.actionId };
}

export async function readCompanionMemberAction(request: Request, rawActionId: string) {
  const prisma = getPrisma();
  const auth = await requireActiveHostedMemberAuthFromBearerToken(request, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  const parsed = memberActionIdV1Schema.safeParse(rawActionId);
  if (!parsed.success || new URL(request.url).searchParams.size !== 0) {
    throw hostedOnboardingError({ code: "MEMBER_ACTION_INVALID_REQUEST", httpStatus: 400, message: "The member action identity is invalid.", retryable: false });
  }
  const result = await readMemberActionStatus({ actionId: parsed.data, memberId: auth.member.id, prisma });
  await assertHostedNativeMemberAuthCurrentTx(auth, prisma);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma });
  return result;
}
