import { createHostedWebSmokeEnvironment } from "../../../next-artifacts";

interface HostedActiveMemberSeedInput {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}

interface HostedActiveLinqMemberSeedInput extends HostedActiveMemberSeedInput {
  homePhone: string;
  memberPhone: string;
}

interface HostedMemberSeedModules {
  createHostedMember: typeof import("./hosted-member-store").createHostedMember;
  createHostedPhoneLookupKey: typeof import("./contact-privacy").createHostedPhoneLookupKey;
  getPrisma: typeof import("../prisma").getPrisma;
  readHostedPhoneHint: typeof import("./contact-privacy").readHostedPhoneHint;
  upsertHostedMemberHomeLinqRecipientPhoneTx:
    typeof import("./hosted-member-routing-store").upsertHostedMemberHomeLinqRecipientPhoneTx;
  upsertHostedMemberIdentity:
    typeof import("./hosted-member-identity-store").upsertHostedMemberIdentity;
}

export async function seedHostedActiveMember(
  input: HostedActiveMemberSeedInput,
): Promise<void> {
  if (!input.memberId.trim()) {
    throw new Error("Hosted member seed requires MURPH_E2E_MEMBER_ID.");
  }

  const modules = await loadHostedMemberSeedModules(
    applyHostedMemberSeedEnvironment(input.environment),
  );
  const prisma = modules.getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await modules.createHostedMember({
        billingStatus: "active",
        memberId: input.memberId,
        prisma: tx,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

export async function seedHostedActiveLinqMember(
  input: HostedActiveLinqMemberSeedInput,
): Promise<void> {
  if (!input.memberId.trim() || !input.memberPhone.trim() || !input.homePhone.trim()) {
    throw new Error("Hosted Linq member seed requires member id, member phone, and home phone.");
  }

  const modules = await loadHostedMemberSeedModules(
    applyHostedMemberSeedEnvironment(input.environment),
  );
  const phoneLookupKey = modules.createHostedPhoneLookupKey(input.memberPhone);
  if (!phoneLookupKey) {
    throw new Error("Hosted Linq member seed requires a valid member phone.");
  }

  const prisma = modules.getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await modules.createHostedMember({
        billingStatus: "active",
        memberId: input.memberId,
        prisma: tx,
      });
      await modules.upsertHostedMemberIdentity({
        maskedPhoneNumberHint: modules.readHostedPhoneHint(input.memberPhone),
        memberId: input.memberId,
        phoneLookupKey,
        phoneNumber: input.memberPhone,
        phoneNumberVerifiedAt: new Date(),
        prisma: tx,
        privyUserId: null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: input.memberPhone,
        walletAddress: null,
        walletChainType: null,
        walletCreatedAt: null,
        walletProvider: null,
      });
      await modules.upsertHostedMemberHomeLinqRecipientPhoneTx({
        clearPending: true,
        memberId: input.memberId,
        prisma: tx,
        recipientPhone: input.homePhone,
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

function applyHostedMemberSeedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  Object.assign(process.env, runtimeEnv);
  clearHostedMemberSeedGlobals();
  return runtimeEnv;
}

async function loadHostedMemberSeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedMemberSeedModules> {
  const [
    prismaModule,
    contactPrivacyModule,
    hostedMemberIdentityStoreModule,
    hostedMemberRoutingStoreModule,
    hostedMemberStoreModule,
  ] = await Promise.all([
    import("../prisma"),
    import("./contact-privacy"),
    import("./hosted-member-identity-store"),
    import("./hosted-member-routing-store"),
    import("./hosted-member-store"),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  return {
    createHostedMember: hostedMemberStoreModule.createHostedMember,
    createHostedPhoneLookupKey: contactPrivacyModule.createHostedPhoneLookupKey,
    getPrisma: prismaModule.getPrisma,
    readHostedPhoneHint: contactPrivacyModule.readHostedPhoneHint,
    upsertHostedMemberHomeLinqRecipientPhoneTx:
      hostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqRecipientPhoneTx,
    upsertHostedMemberIdentity: hostedMemberIdentityStoreModule.upsertHostedMemberIdentity,
  };
}

function clearHostedMemberSeedGlobals(): void {
  const globalForHostedOnboarding = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  };

  delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
}
