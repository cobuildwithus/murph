import { createHostedWebSmokeEnvironment } from "../../../next-artifacts";

const prismaModuleSpecifier = new URL("../prisma.ts", import.meta.url).href;
const contactPrivacyModuleSpecifier = new URL("./contact-privacy.ts", import.meta.url).href;
const hostedMemberIdentityStoreModuleSpecifier = new URL(
  "./hosted-member-identity-store.ts",
  import.meta.url,
).href;
const hostedMemberRoutingStoreModuleSpecifier = new URL(
  "./hosted-member-routing-store.ts",
  import.meta.url,
).href;
const hostedMemberStoreModuleSpecifier = new URL("./hosted-member-store.ts", import.meta.url)
  .href;

interface HostedActiveMemberSeedInput {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}

interface HostedActiveLinqMemberSeedInput extends HostedActiveMemberSeedInput {
  homePhone: string;
  memberPhone: string;
}

interface HostedMemberSeedPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

interface HostedMemberSeedPrismaModule {
  getPrisma(): HostedMemberSeedPrismaClient;
}

interface HostedMemberStoreModule {
  createHostedMember(input: {
    billingStatus: "active";
    memberId: string;
    prisma: unknown;
  }): Promise<unknown>;
}

interface ContactPrivacyModule {
  createHostedPhoneLookupKey(phoneNumber: string): string | null;
  readHostedPhoneHint(phoneNumber: string): string | null;
}

interface HostedMemberIdentityStoreModule {
  upsertHostedMemberIdentity(input: {
    maskedPhoneNumberHint: string | null;
    memberId: string;
    phoneLookupKey: string;
    phoneNumber: string;
    phoneNumberVerifiedAt: Date;
    prisma: unknown;
    privyUserId: string | null;
    signupPhoneCodeSendAttemptId: string | null;
    signupPhoneCodeSendAttemptStartedAt: Date | null;
    signupPhoneCodeSentAt: Date | null;
    signupPhoneNumber: string;
    walletAddress: string | null;
    walletChainType: string | null;
    walletCreatedAt: Date | null;
    walletProvider: string | null;
  }): Promise<unknown>;
}

interface HostedMemberRoutingStoreModule {
  upsertHostedMemberHomeLinqBindingTx(input: {
    clearPending: boolean;
    linqChatId: string;
    memberId: string;
    prisma: unknown;
    recipientPhone: string;
  }): Promise<unknown>;
  upsertHostedMemberHomeLinqRecipientPhoneTx(input: {
    clearPending: boolean;
    memberId: string;
    prisma: unknown;
    recipientPhone: string;
  }): Promise<unknown>;
}

interface HostedMemberSeedModules {
  createHostedMember: HostedMemberStoreModule["createHostedMember"];
  createHostedPhoneLookupKey: ContactPrivacyModule["createHostedPhoneLookupKey"];
  getPrisma: HostedMemberSeedPrismaModule["getPrisma"];
  readHostedPhoneHint: ContactPrivacyModule["readHostedPhoneHint"];
  upsertHostedMemberHomeLinqBindingTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqBindingTx"];
  upsertHostedMemberHomeLinqRecipientPhoneTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqRecipientPhoneTx"];
  upsertHostedMemberIdentity: HostedMemberIdentityStoreModule["upsertHostedMemberIdentity"];
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

export async function bindHostedActiveLinqHomeChat(input: {
  chatId: string;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  recipientPhone: string;
}): Promise<void> {
  if (!input.memberId.trim() || !input.chatId.trim() || !input.recipientPhone.trim()) {
    throw new Error(
      "Hosted Linq home chat binding requires member id, chat id, and recipient phone.",
    );
  }

  const modules = await loadHostedMemberSeedModules(
    applyHostedMemberSeedEnvironment(input.environment),
  );
  const prisma = modules.getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await modules.upsertHostedMemberHomeLinqBindingTx({
        clearPending: true,
        linqChatId: input.chatId,
        memberId: input.memberId,
        prisma: tx,
        recipientPhone: input.recipientPhone,
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
    import(prismaModuleSpecifier),
    import(contactPrivacyModuleSpecifier),
    import(hostedMemberIdentityStoreModuleSpecifier),
    import(hostedMemberRoutingStoreModuleSpecifier),
    import(hostedMemberStoreModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedMemberSeedPrismaModule;
  const typedContactPrivacyModule = contactPrivacyModule as ContactPrivacyModule;
  const typedHostedMemberIdentityStoreModule =
    hostedMemberIdentityStoreModule as HostedMemberIdentityStoreModule;
  const typedHostedMemberRoutingStoreModule =
    hostedMemberRoutingStoreModule as HostedMemberRoutingStoreModule;
  const typedHostedMemberStoreModule = hostedMemberStoreModule as HostedMemberStoreModule;

  return {
    createHostedMember: typedHostedMemberStoreModule.createHostedMember,
    createHostedPhoneLookupKey: typedContactPrivacyModule.createHostedPhoneLookupKey,
    getPrisma: typedPrismaModule.getPrisma,
    readHostedPhoneHint: typedContactPrivacyModule.readHostedPhoneHint,
    upsertHostedMemberHomeLinqBindingTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqBindingTx,
    upsertHostedMemberHomeLinqRecipientPhoneTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqRecipientPhoneTx,
    upsertHostedMemberIdentity: typedHostedMemberIdentityStoreModule.upsertHostedMemberIdentity,
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
