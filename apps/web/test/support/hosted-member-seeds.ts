import { createHostedWebSmokeEnvironment } from "../../next-artifacts";

const prismaModuleSpecifier = new URL("../../src/lib/prisma.ts", import.meta.url).href;
const contactPrivacyModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/contact-privacy.ts",
  import.meta.url,
).href;
const hostedMemberIdentityStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-identity-store.ts",
  import.meta.url,
).href;
const hostedMemberRoutingStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-routing-store.ts",
  import.meta.url,
).href;
const hostedMemberStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-store.ts",
  import.meta.url,
).href;
const hostedMemberBillingStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-billing-store.ts",
  import.meta.url,
).href;
const hostedCryptoDomainRootStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-crypto/domain-root-store.ts",
  import.meta.url,
).href;
const hostedMemberSeedHostOnlyEnv = {
  DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM,
};

type HostedMemberTestSeedBillingPlanCode =
  | "launch_monthly"
  | "launch_edge_monthly";

interface HostedActiveMemberSeedInput {
  billingPlanCode?: HostedMemberTestSeedBillingPlanCode;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

interface HostedActiveLinqMemberSeedInput extends HostedActiveMemberSeedInput {
  homePhone: string;
  memberPhone: string;
  privyUserId?: string | null;
  walletAddress?: string | null;
}

interface HostedMemberSeedPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T>;
}

interface HostedMemberSeedPrismaModule {
  createPrismaClient(input: {
    databaseUrl: string;
    poolMax?: number;
  }): HostedMemberSeedPrismaClient;
}

interface HostedMemberStoreModule {
  createHostedMember(input: {
    billingStatus: "active";
    memberId: string;
    prisma: unknown;
  }): Promise<unknown>;
}

interface HostedMemberBillingStoreModule {
  writeHostedMemberStripeBillingRefTx(input: {
    currentBillingPhase: "paid";
    currentBillingPlanCode: HostedMemberTestSeedBillingPlanCode;
    currentCheckoutOffer: "standard";
    memberId: string;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    tx: unknown;
  }): Promise<unknown>;
}

interface HostedCryptoDomainRootStoreModule {
  provisionHostedCryptoDomainRootsForUserTx(input: {
    reason?: string;
    tx: unknown;
    userId: string;
  }): Promise<void>;
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
  createPrismaClient: HostedMemberSeedPrismaModule["createPrismaClient"];
  createHostedMember: HostedMemberStoreModule["createHostedMember"];
  createHostedPhoneLookupKey: ContactPrivacyModule["createHostedPhoneLookupKey"];
  provisionHostedCryptoDomainRootsForUserTx:
    HostedCryptoDomainRootStoreModule["provisionHostedCryptoDomainRootsForUserTx"];
  readHostedPhoneHint: ContactPrivacyModule["readHostedPhoneHint"];
  upsertHostedMemberHomeLinqBindingTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqBindingTx"];
  upsertHostedMemberHomeLinqRecipientPhoneTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqRecipientPhoneTx"];
  upsertHostedMemberIdentity: HostedMemberIdentityStoreModule["upsertHostedMemberIdentity"];
  writeHostedMemberStripeBillingRefTx:
    HostedMemberBillingStoreModule["writeHostedMemberStripeBillingRefTx"];
}

export async function seedHostedActiveMember(
  input: HostedActiveMemberSeedInput,
): Promise<void> {
  if (!input.memberId.trim()) {
    throw new Error("Hosted member seed requires MURPH_E2E_MEMBER_ID.");
  }

  const environment = applyHostedMemberSeedEnvironment(input.environment);
  const modules = await loadHostedMemberSeedModules(environment);
  const prisma = createHostedMemberSeedPrisma({
    environment,
    modules,
  });

  try {
    await prisma.$transaction(async (tx) => {
      await modules.createHostedMember({
        billingStatus: "active",
        memberId: input.memberId,
        prisma: tx,
      });
      await modules.provisionHostedCryptoDomainRootsForUserTx({
        reason: "hosted-member.test-seed",
        tx,
        userId: input.memberId,
      });
      await seedHostedMemberBillingRefTx({
        billingPlanCode: input.billingPlanCode,
        memberId: input.memberId,
        modules,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        tx,
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

  const environment = applyHostedMemberSeedEnvironment(input.environment);
  const modules = await loadHostedMemberSeedModules(environment);
  const phoneLookupKey = modules.createHostedPhoneLookupKey(input.memberPhone);
  if (!phoneLookupKey) {
    throw new Error("Hosted Linq member seed requires a valid member phone.");
  }

  const prisma = createHostedMemberSeedPrisma({
    environment,
    modules,
  });

  try {
    await prisma.$transaction(async (tx) => {
      await modules.createHostedMember({
        billingStatus: "active",
        memberId: input.memberId,
        prisma: tx,
      });
      await modules.provisionHostedCryptoDomainRootsForUserTx({
        reason: "hosted-member.test-seed",
        tx,
        userId: input.memberId,
      });
      await seedHostedMemberBillingRefTx({
        billingPlanCode: input.billingPlanCode,
        memberId: input.memberId,
        modules,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        tx,
      });
      await modules.upsertHostedMemberIdentity({
        maskedPhoneNumberHint: modules.readHostedPhoneHint(input.memberPhone),
        memberId: input.memberId,
        phoneLookupKey,
        phoneNumber: input.memberPhone,
        phoneNumberVerifiedAt: new Date(),
        prisma: tx,
        privyUserId: input.privyUserId ?? null,
        signupPhoneCodeSendAttemptId: null,
        signupPhoneCodeSendAttemptStartedAt: null,
        signupPhoneCodeSentAt: null,
        signupPhoneNumber: input.memberPhone,
        walletAddress: input.walletAddress ?? null,
        walletChainType: input.walletAddress ? "ethereum" : null,
        walletCreatedAt: input.walletAddress ? new Date() : null,
        walletProvider: input.walletAddress ? "privy" : null,
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

  const environment = applyHostedMemberSeedEnvironment(input.environment);
  const modules = await loadHostedMemberSeedModules(environment);
  const prisma = createHostedMemberSeedPrisma({
    environment,
    modules,
  });

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
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreHostedMemberSeedHostOnlyEnv();
  clearHostedMemberSeedGlobals();
  return runtimeEnv;
}

function restoreHostedMemberSeedHostOnlyEnv(): void {
  for (const [key, value] of Object.entries(hostedMemberSeedHostOnlyEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function loadHostedMemberSeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedMemberSeedModules> {
  const [
    prismaModule,
    contactPrivacyModule,
    hostedCryptoDomainRootStoreModule,
    hostedMemberIdentityStoreModule,
    hostedMemberRoutingStoreModule,
    hostedMemberStoreModule,
    hostedMemberBillingStoreModule,
  ] = await Promise.all([
    import(prismaModuleSpecifier),
    import(contactPrivacyModuleSpecifier),
    import(hostedCryptoDomainRootStoreModuleSpecifier),
    import(hostedMemberIdentityStoreModuleSpecifier),
    import(hostedMemberRoutingStoreModuleSpecifier),
    import(hostedMemberStoreModuleSpecifier),
    import(hostedMemberBillingStoreModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedMemberSeedPrismaModule;
  const typedContactPrivacyModule = contactPrivacyModule as ContactPrivacyModule;
  const typedHostedCryptoDomainRootStoreModule =
    hostedCryptoDomainRootStoreModule as HostedCryptoDomainRootStoreModule;
  const typedHostedMemberIdentityStoreModule =
    hostedMemberIdentityStoreModule as HostedMemberIdentityStoreModule;
  const typedHostedMemberRoutingStoreModule =
    hostedMemberRoutingStoreModule as HostedMemberRoutingStoreModule;
  const typedHostedMemberStoreModule = hostedMemberStoreModule as HostedMemberStoreModule;
  const typedHostedMemberBillingStoreModule =
    hostedMemberBillingStoreModule as HostedMemberBillingStoreModule;

  return {
    createPrismaClient: typedPrismaModule.createPrismaClient,
    createHostedMember: typedHostedMemberStoreModule.createHostedMember,
    createHostedPhoneLookupKey: typedContactPrivacyModule.createHostedPhoneLookupKey,
    provisionHostedCryptoDomainRootsForUserTx:
      typedHostedCryptoDomainRootStoreModule.provisionHostedCryptoDomainRootsForUserTx,
    readHostedPhoneHint: typedContactPrivacyModule.readHostedPhoneHint,
    upsertHostedMemberHomeLinqBindingTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqBindingTx,
    upsertHostedMemberHomeLinqRecipientPhoneTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqRecipientPhoneTx,
    upsertHostedMemberIdentity: typedHostedMemberIdentityStoreModule.upsertHostedMemberIdentity,
    writeHostedMemberStripeBillingRefTx:
      typedHostedMemberBillingStoreModule.writeHostedMemberStripeBillingRefTx,
  };
}

function createHostedMemberSeedPrisma(input: {
  environment: NodeJS.ProcessEnv;
  modules: HostedMemberSeedModules;
}): HostedMemberSeedPrismaClient {
  const databaseUrl = input.environment.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Hosted member seed helpers require DATABASE_URL.");
  }

  return input.modules.createPrismaClient({
    databaseUrl,
    poolMax: 1,
  });
}

async function seedHostedMemberBillingRefTx(input: {
  billingPlanCode?: HostedMemberTestSeedBillingPlanCode;
  memberId: string;
  modules: HostedMemberSeedModules;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  tx: unknown;
}): Promise<void> {
  if (!input.billingPlanCode) {
    return;
  }

  await input.modules.writeHostedMemberStripeBillingRefTx({
    currentBillingPhase: "paid",
    currentBillingPlanCode: input.billingPlanCode,
    currentCheckoutOffer: "standard",
    memberId: input.memberId,
    stripeCustomerId: input.stripeCustomerId,
    stripeSubscriptionId: input.stripeSubscriptionId,
    tx: input.tx,
  });
}

function clearHostedMemberSeedGlobals(): void {
  const globalForHostedOnboarding = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  };

  delete globalForHostedOnboarding.__murphHostedOnboardingEnv;
  delete globalForHostedOnboarding.__murphHostedOnboardingStripe;
}
