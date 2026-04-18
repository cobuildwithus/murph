import { getPrisma } from "../src/lib/prisma";
import {
  createHostedPhoneLookupKey,
  readHostedPhoneHint,
} from "../src/lib/hosted-onboarding/contact-privacy";
import { upsertHostedMemberIdentity } from "../src/lib/hosted-onboarding/hosted-member-identity-store";
import { createHostedMember } from "../src/lib/hosted-onboarding/hosted-member-store";
import { upsertHostedMemberHomeLinqRecipientPhoneTx } from "../src/lib/hosted-onboarding/hosted-member-routing-store";
import { createHostedWebSmokeEnvironment } from "../next-artifacts";

const runtimeEnv = createHostedWebSmokeEnvironment(process.env);

Object.assign(process.env, runtimeEnv);

const memberId = runtimeEnv.MURPH_E2E_MEMBER_ID?.trim() || "";
const memberPhone = runtimeEnv.MURPH_E2E_MEMBER_PHONE?.trim() || "";
const homePhone = runtimeEnv.MURPH_E2E_HOME_PHONE?.trim() || "";
const phoneLookupKey = createHostedPhoneLookupKey(memberPhone);

async function main(): Promise<void> {
  if (!memberId || !memberPhone || !homePhone || !phoneLookupKey) {
    throw new Error("Hosted Linq member seed requires member id, member phone, and home phone.");
  }

  const prisma = getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await createHostedMember({
        billingStatus: "active",
        memberId,
        prisma: tx,
      });
      await upsertHostedMemberIdentity({
        maskedPhoneNumberHint: readHostedPhoneHint(memberPhone),
        memberId,
        phoneLookupKey,
        phoneNumber: memberPhone,
        phoneNumberVerifiedAt: new Date(),
        prisma: tx,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: memberPhone,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      });
      await upsertHostedMemberHomeLinqRecipientPhoneTx({
        clearPending: true,
        memberId,
        prisma: tx,
        recipientPhone: homePhone,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

void main();
