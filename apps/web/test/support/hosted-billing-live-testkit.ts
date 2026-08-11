import { setTimeout as delay } from "node:timers/promises";

import { createHostedWebSmokeEnvironment } from "../../next-artifacts";
import {
  HOSTED_PULSE_TRIAL_POLICY_VERSION,
} from "../../src/lib/hosted-onboarding/billing-plans";

const prismaModuleSpecifier = new URL("../../src/lib/prisma.ts", import.meta.url).href;
const hostedMemberStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-store.ts",
  import.meta.url,
).href;
const hostedMemberBillingStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-billing-store.ts",
  import.meta.url,
).href;
const hostedMemberIdentityStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/hosted-member-identity-store.ts",
  import.meta.url,
).href;
const hostedCryptoDomainRootStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-crypto/domain-root-store.ts",
  import.meta.url,
).href;
const hostedInviteServiceModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/invite-service.ts",
  import.meta.url,
).href;
const hostedFamilyPlanModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/family-plan.ts",
  import.meta.url,
).href;

const DEFAULT_POLL_INTERVAL_MS = 300;
const DEFAULT_POLL_TIMEOUT_MS = 120_000;
const hostedBillingTestkitHostOnlyEnv = {
  DOCKER_BUILDKIT: process.env.DOCKER_BUILDKIT,
  DOCKER_CONFIG: process.env.DOCKER_CONFIG,
  DOCKER_DEFAULT_PLATFORM: process.env.DOCKER_DEFAULT_PLATFORM,
};

export type HostedBillingStatusForTest =
  | "active"
  | "canceled"
  | "incomplete"
  | "not_started"
  | "past_due"
  | "paused"
  | "unpaid";

export type HostedBillingPlanCodeForTest =
  | "launch_edge_monthly"
  | "launch_group_monthly"
  | "launch_monthly";

export interface HostedBillingRefSeedForTest {
  currentBillingPhase: "paid" | "trial";
  currentBillingPlanCode: HostedBillingPlanCodeForTest;
  currentCheckoutOffer: "pulse_trial_7d" | "standard";
  currentPeriodEnd?: Date | null;
  currentPeriodStart?: Date | null;
  currentTrialEndsAt?: Date | null;
  currentTrialStartedAt?: Date | null;
  pulseTrialRedeemedAt?: Date | null;
  scheduledBillingEffectiveAt?: Date | null;
  scheduledBillingPlanCode?: HostedBillingPlanCodeForTest | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeSubscriptionScheduleId?: string | null;
}

export interface HostedBillingMemberSeedForTest {
  billingRef?: HostedBillingRefSeedForTest | null;
  billingStatus: HostedBillingStatusForTest;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  privyUserId?: string | null;
  verifiedEmail?: string | null;
}

export interface HostedBillingProjectionForTest {
  billingStatus: HostedBillingStatusForTest;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  currentCheckoutOffer: string | null;
  currentPeriodEnd: Date | null;
  currentPeriodStart: Date | null;
  currentTrialEndsAt: Date | null;
  currentTrialStartedAt: Date | null;
  memberId: string;
  pulseTrialRedeemedAt: Date | null;
  scheduledBillingEffectiveAt: Date | null;
  scheduledBillingPlanCode: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionScheduleId: string | null;
}

export interface HostedFamilyProjectionForTest {
  billingActive: boolean;
  billingStatus: HostedBillingStatusForTest | null;
  billedSeatCount: number | null;
  currentBillingPhase: string | null;
  currentBillingPlanCode: string | null;
  groupId: string | null;
  memberPlanCode: string | null;
  memberRole: string | null;
  memberStatus: string | null;
  members: readonly {
    isOwner: boolean;
    memberId: string;
    planCode: string;
    role: string;
    status: string;
  }[];
  ownerMemberId: string | null;
  seats: {
    active: number;
    billed: number;
    invited: number;
    remaining: number;
    used: number;
  } | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface HostedBillingTestReader {
  hostedMember: {
    findUnique(input: unknown): Promise<{
      billingStatus: HostedBillingStatusForTest;
      id: string;
    } | null>;
  };
}

interface HostedBillingTestPrisma extends HostedBillingTestReader {
  $disconnect(): Promise<void>;
  $transaction<T>(
    run: (tx: HostedBillingTestTransaction) => Promise<T>,
  ): Promise<T>;
}

interface HostedBillingTestTransaction extends HostedBillingTestReader {
  hostedMember: HostedBillingTestReader["hostedMember"] & {
    update(input: unknown): Promise<unknown>;
  };
}

interface HostedPrismaModule {
  createPrismaClient(input: {
    databaseUrl: string;
    poolMax?: number;
  }): HostedBillingTestPrisma;
}

interface HostedMemberStoreModule {
  createHostedMember(input: {
    billingStatus: "active" | "not_started";
    memberId: string;
    prisma: HostedBillingTestTransaction;
  }): Promise<unknown>;
  upsertHostedMemberEmailAuthorization(input: {
    directPublicSender: {
      address: string;
      authorizedAt: Date;
    };
    memberId: string;
    prisma: HostedBillingTestTransaction;
    verifiedEmail: {
      address: string;
      verifiedAt: Date;
    };
  }): Promise<unknown>;
}

interface HostedMemberBillingStoreModule {
  readHostedMemberStripeBillingRef(input: {
    memberId: string;
    prisma: HostedBillingTestPrisma;
  }): Promise<{
    currentBillingPhase?: string | null;
    currentBillingPlanCode?: string | null;
    currentCheckoutOffer?: string | null;
    currentPeriodEnd?: Date | null;
    currentPeriodStart?: Date | null;
    currentTrialEndsAt?: Date | null;
    currentTrialStartedAt?: Date | null;
    memberId: string;
    pulseTrialRedeemedAt?: Date | null;
    scheduledBillingEffectiveAt?: Date | null;
    scheduledBillingPlanCode?: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripeSubscriptionScheduleId?: string | null;
  } | null>;
  writeHostedMemberStripeBillingRefTx(input: {
    currentBillingPhase: "paid" | "trial";
    currentBillingPlanCode: HostedBillingPlanCodeForTest;
    currentCheckoutOffer: "pulse_trial_7d" | "standard";
    currentPeriodEnd?: Date | null;
    currentPeriodStart?: Date | null;
    currentTrialEndsAt?: Date | null;
    currentTrialStartedAt?: Date | null;
    memberId: string;
    pulseTrialPolicyVersion?: string | null;
    pulseTrialRedeemedAt?: Date | null;
    pulseTrialStartSource?: "checkout" | null;
    scheduledBillingEffectiveAt?: Date | null;
    scheduledBillingPlanCode?: HostedBillingPlanCodeForTest | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    stripeSubscriptionScheduleId?: string | null;
    tx: HostedBillingTestTransaction;
  }): Promise<unknown>;
}

interface HostedMemberIdentityStoreModule {
  upsertHostedMemberIdentity(input: {
    maskedPhoneNumberHint: string | null;
    memberId: string;
    phoneLookupKey: string | null;
    phoneNumber: string | null;
    phoneNumberVerifiedAt: Date | null;
    prisma: HostedBillingTestTransaction;
    privyUserId: string | null;
    signupPhoneCodeSendAttemptId: string | null;
    signupPhoneCodeSendAttemptStartedAt: Date | null;
    signupPhoneCodeSentAt: Date | null;
    signupPhoneNumber: string | null;
    walletAddress: string | null;
    walletChainType: string | null;
    walletCreatedAt: Date | null;
    walletProvider: string | null;
  }): Promise<unknown>;
}

interface HostedCryptoDomainRootStoreModule {
  provisionHostedCryptoDomainRootsForUserTx(input: {
    reason: string;
    tx: HostedBillingTestTransaction;
    userId: string;
  }): Promise<void>;
}

interface HostedInviteServiceModule {
  issueHostedInvite(input: {
    channel: "web";
    memberId: string;
    prisma: HostedBillingTestPrisma;
  }): Promise<{ inviteCode: string }>;
}

interface HostedFamilyPlanModule {
  readHostedAccountGroupStripeBillingRef(input: {
    groupId: string;
    prisma: HostedBillingTestPrisma;
  }): Promise<{
    billedSeatCount: number | null;
    currentBillingPhase: string | null;
    currentBillingPlanCode: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  } | null>;
  readHostedFamilyAccessForMember(input: {
    memberId: string;
    prisma: HostedBillingTestPrisma;
  }): Promise<{
    group: {
      billingStatus: HostedBillingStatusForTest;
      id: string;
      ownerMemberId: string;
    };
    groupId: string;
    planCode: string;
    role: string;
    status: string;
  } | null>;
  readHostedFamilyOwnerSnapshotForMember(input: {
    memberId: string;
    prisma: HostedBillingTestPrisma;
  }): Promise<{
    billingActive: boolean;
    billingStatus: HostedBillingStatusForTest;
    groupId: string;
    members: readonly {
      isOwner: boolean;
      memberId: string;
      planCode: string;
      role: string;
      status: string;
    }[];
    ownerMemberId: string;
    seats: {
      active: number;
      billed: number;
      invited: number;
      remaining: number;
      used: number;
    };
  } | null>;
}

interface HostedBillingTestModules {
  createHostedMember: HostedMemberStoreModule["createHostedMember"];
  createPrismaClient: HostedPrismaModule["createPrismaClient"];
  issueHostedInvite: HostedInviteServiceModule["issueHostedInvite"];
  provisionHostedCryptoDomainRootsForUserTx:
    HostedCryptoDomainRootStoreModule["provisionHostedCryptoDomainRootsForUserTx"];
  readHostedAccountGroupStripeBillingRef:
    HostedFamilyPlanModule["readHostedAccountGroupStripeBillingRef"];
  readHostedFamilyAccessForMember:
    HostedFamilyPlanModule["readHostedFamilyAccessForMember"];
  readHostedFamilyOwnerSnapshotForMember:
    HostedFamilyPlanModule["readHostedFamilyOwnerSnapshotForMember"];
  readHostedMemberStripeBillingRef:
    HostedMemberBillingStoreModule["readHostedMemberStripeBillingRef"];
  upsertHostedMemberIdentity:
    HostedMemberIdentityStoreModule["upsertHostedMemberIdentity"];
  upsertHostedMemberEmailAuthorization:
    HostedMemberStoreModule["upsertHostedMemberEmailAuthorization"];
  writeHostedMemberStripeBillingRefTx:
    HostedMemberBillingStoreModule["writeHostedMemberStripeBillingRefTx"];
}

export async function seedHostedBillingMemberForTest(
  input: HostedBillingMemberSeedForTest,
): Promise<void> {
  if (!input.memberId.trim()) {
    throw new TypeError("Hosted billing member seed requires a member id.");
  }

  await withHostedBillingTestkit(input.environment, async ({ modules, prisma }) => {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.hostedMember.findUnique({
        select: { id: true },
        where: { id: input.memberId },
      });
      if (!existing) {
        const privyUserId = input.privyUserId?.trim() || null;
        if (!privyUserId) {
          throw new TypeError(
            "A new hosted billing member seed requires a Privy user id.",
          );
        }
        await modules.createHostedMember({
          billingStatus: input.billingStatus === "active" ? "active" : "not_started",
          memberId: input.memberId,
          prisma: tx,
        });
        await modules.provisionHostedCryptoDomainRootsForUserTx({
          reason: "hosted-billing-live.test-seed",
          tx,
          userId: input.memberId,
        });
        await modules.upsertHostedMemberIdentity({
          maskedPhoneNumberHint: null,
          memberId: input.memberId,
          phoneLookupKey: null,
          phoneNumber: null,
          phoneNumberVerifiedAt: null,
          prisma: tx,
          privyUserId,
          signupPhoneCodeSendAttemptId: null,
          signupPhoneCodeSendAttemptStartedAt: null,
          signupPhoneCodeSentAt: null,
          signupPhoneNumber: null,
          walletAddress: null,
          walletChainType: null,
          walletCreatedAt: null,
          walletProvider: null,
        });
      }

      await tx.hostedMember.update({
        data: {
          billingStatus: input.billingStatus,
          initialOnboardingCompletedAt: new Date(),
          suspendedAt: null,
        },
        where: { id: input.memberId },
      });

      const verifiedEmail = input.verifiedEmail?.trim().toLowerCase() || null;
      if (verifiedEmail) {
        const verifiedAt = new Date();
        await modules.upsertHostedMemberEmailAuthorization({
          directPublicSender: {
            address: verifiedEmail,
            authorizedAt: verifiedAt,
          },
          memberId: input.memberId,
          prisma: tx,
          verifiedEmail: {
            address: verifiedEmail,
            verifiedAt,
          },
        });
      }

      if (input.billingRef) {
        const trial = input.billingRef.currentCheckoutOffer === "pulse_trial_7d";
        await modules.writeHostedMemberStripeBillingRefTx({
          ...input.billingRef,
          memberId: input.memberId,
          ...(trial
            ? {
                pulseTrialPolicyVersion: HOSTED_PULSE_TRIAL_POLICY_VERSION,
                pulseTrialRedeemedAt:
                  input.billingRef.pulseTrialRedeemedAt
                  ?? input.billingRef.currentTrialStartedAt
                  ?? new Date(),
                pulseTrialStartSource: "checkout" as const,
              }
            : {}),
          tx,
        });
      }
    });
  });
}

export async function issueHostedWebInviteForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<{ inviteCode: string }> {
  return withHostedBillingTestkit(input.environment, async ({ modules, prisma }) => {
    const invite = await modules.issueHostedInvite({
      channel: "web",
      memberId: input.memberId,
      prisma,
    });
    return { inviteCode: invite.inviteCode };
  });
}

export async function readHostedBillingProjectionForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<HostedBillingProjectionForTest> {
  return withHostedBillingTestkit(input.environment, async ({ modules, prisma }) => {
    const [member, billingRef] = await Promise.all([
      prisma.hostedMember.findUnique({
        select: { billingStatus: true, id: true },
        where: { id: input.memberId },
      }),
      modules.readHostedMemberStripeBillingRef({
        memberId: input.memberId,
        prisma,
      }),
    ]);
    if (!member) {
      throw new Error("Hosted billing projection member was not found.");
    }
    return {
      billingStatus: member.billingStatus,
      currentBillingPhase: billingRef?.currentBillingPhase ?? null,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode ?? null,
      currentCheckoutOffer: billingRef?.currentCheckoutOffer ?? null,
      currentPeriodEnd: billingRef?.currentPeriodEnd ?? null,
      currentPeriodStart: billingRef?.currentPeriodStart ?? null,
      currentTrialEndsAt: billingRef?.currentTrialEndsAt ?? null,
      currentTrialStartedAt: billingRef?.currentTrialStartedAt ?? null,
      memberId: member.id,
      pulseTrialRedeemedAt: billingRef?.pulseTrialRedeemedAt ?? null,
      scheduledBillingEffectiveAt: billingRef?.scheduledBillingEffectiveAt ?? null,
      scheduledBillingPlanCode: billingRef?.scheduledBillingPlanCode ?? null,
      stripeCustomerId: billingRef?.stripeCustomerId ?? null,
      stripeSubscriptionId: billingRef?.stripeSubscriptionId ?? null,
      stripeSubscriptionScheduleId:
        billingRef?.stripeSubscriptionScheduleId ?? null,
    };
  });
}

export async function readHostedFamilyProjectionForTest(input: {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}): Promise<HostedFamilyProjectionForTest> {
  return withHostedBillingTestkit(input.environment, async ({ modules, prisma }) => {
    const [ownerSnapshot, membership] = await Promise.all([
      modules.readHostedFamilyOwnerSnapshotForMember({
        memberId: input.memberId,
        prisma,
      }),
      modules.readHostedFamilyAccessForMember({
        memberId: input.memberId,
        prisma,
      }),
    ]);
    const groupId = ownerSnapshot?.groupId ?? membership?.groupId ?? null;
    const billingRef = groupId
      ? await modules.readHostedAccountGroupStripeBillingRef({ groupId, prisma })
      : null;
    return {
      billingActive: ownerSnapshot?.billingActive
        ?? (membership?.group.billingStatus === "active"),
      billingStatus: ownerSnapshot?.billingStatus
        ?? membership?.group.billingStatus
        ?? null,
      billedSeatCount: billingRef?.billedSeatCount ?? null,
      currentBillingPhase: billingRef?.currentBillingPhase ?? null,
      currentBillingPlanCode: billingRef?.currentBillingPlanCode ?? null,
      groupId,
      memberPlanCode: membership?.planCode ?? null,
      memberRole: membership?.role ?? null,
      memberStatus: membership?.status ?? null,
      members: ownerSnapshot?.members ?? [],
      ownerMemberId: ownerSnapshot?.ownerMemberId
        ?? membership?.group.ownerMemberId
        ?? null,
      seats: ownerSnapshot?.seats ?? null,
      stripeCustomerId: billingRef?.stripeCustomerId ?? null,
      stripeSubscriptionId: billingRef?.stripeSubscriptionId ?? null,
    };
  });
}

export async function waitForHostedBillingProjectionForTest(input: {
  environment?: NodeJS.ProcessEnv;
  label: string;
  memberId: string;
  ready: (projection: HostedBillingProjectionForTest) => boolean;
  timeoutMs?: number;
}): Promise<HostedBillingProjectionForTest> {
  return pollHostedProjection({
    label: input.label,
    read: () => readHostedBillingProjectionForTest(input),
    ready: input.ready,
    timeoutMs: input.timeoutMs,
  });
}

export async function waitForHostedFamilyProjectionForTest(input: {
  environment?: NodeJS.ProcessEnv;
  label: string;
  memberId: string;
  ready: (projection: HostedFamilyProjectionForTest) => boolean;
  timeoutMs?: number;
}): Promise<HostedFamilyProjectionForTest> {
  return pollHostedProjection({
    label: input.label,
    read: () => readHostedFamilyProjectionForTest(input),
    ready: input.ready,
    timeoutMs: input.timeoutMs,
  });
}

async function pollHostedProjection<T>(input: {
  label: string;
  read: () => Promise<T>;
  ready: (projection: T) => boolean;
  timeoutMs?: number;
}): Promise<T> {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);
  let projection = await input.read();
  while (!input.ready(projection) && Date.now() < deadline) {
    await delay(DEFAULT_POLL_INTERVAL_MS);
    projection = await input.read();
  }
  if (!input.ready(projection)) {
    throw new Error(`Timed out waiting for local billing projection: ${input.label}.`);
  }
  return projection;
}

async function withHostedBillingTestkit<T>(
  source: NodeJS.ProcessEnv | undefined,
  run: (input: {
    modules: HostedBillingTestModules;
    prisma: HostedBillingTestPrisma;
  }) => Promise<T>,
): Promise<T> {
  const scope = applyHostedBillingTestkitEnvironment(source);
  let prisma: HostedBillingTestPrisma | null = null;
  try {
    const modules = await loadHostedBillingTestModules(scope.environment);
    const databaseUrl = scope.environment.DATABASE_URL?.trim();
    if (!databaseUrl) {
      throw new Error("Hosted billing testkit requires DATABASE_URL.");
    }
    prisma = modules.createPrismaClient({ databaseUrl, poolMax: 1 });
    return await run({ modules, prisma });
  } finally {
    await prisma?.$disconnect();
    scope.restore();
  }
}

function applyHostedBillingTestkitEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): { environment: NodeJS.ProcessEnv; restore(): void } {
  const environment = createHostedWebSmokeEnvironment(source);
  const keys = new Set([
    ...Object.keys(environment),
    ...Object.keys(hostedBillingTestkitHostOnlyEnv),
  ]);
  const previous = new Map(
    [...keys].map((key) => [key, process.env[key]] as const),
  );
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(hostedBillingTestkitHostOnlyEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  clearHostedBillingTestkitGlobals();
  return {
    environment,
    restore: () => {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      clearHostedBillingTestkitGlobals();
    },
  };
}

async function loadHostedBillingTestModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedBillingTestModules> {
  const [
    prismaModule,
    memberStoreModule,
    memberBillingStoreModule,
    memberIdentityStoreModule,
    cryptoDomainRootStoreModule,
    inviteServiceModule,
    familyPlanModule,
  ] = await Promise.all([
    import(prismaModuleSpecifier),
    import(hostedMemberStoreModuleSpecifier),
    import(hostedMemberBillingStoreModuleSpecifier),
    import(hostedMemberIdentityStoreModuleSpecifier),
    import(hostedCryptoDomainRootStoreModuleSpecifier),
    import(hostedInviteServiceModuleSpecifier),
    import(hostedFamilyPlanModuleSpecifier),
  ]);
  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }
  const prisma = prismaModule as HostedPrismaModule;
  const memberStore = memberStoreModule as HostedMemberStoreModule;
  const memberBillingStore = memberBillingStoreModule as HostedMemberBillingStoreModule;
  const memberIdentityStore = memberIdentityStoreModule as HostedMemberIdentityStoreModule;
  const cryptoDomainRootStore =
    cryptoDomainRootStoreModule as HostedCryptoDomainRootStoreModule;
  const inviteService = inviteServiceModule as HostedInviteServiceModule;
  const familyPlan = familyPlanModule as HostedFamilyPlanModule;
  return {
    createHostedMember: memberStore.createHostedMember,
    createPrismaClient: prisma.createPrismaClient,
    issueHostedInvite: inviteService.issueHostedInvite,
    provisionHostedCryptoDomainRootsForUserTx:
      cryptoDomainRootStore.provisionHostedCryptoDomainRootsForUserTx,
    readHostedAccountGroupStripeBillingRef:
      familyPlan.readHostedAccountGroupStripeBillingRef,
    readHostedFamilyAccessForMember: familyPlan.readHostedFamilyAccessForMember,
    readHostedFamilyOwnerSnapshotForMember:
      familyPlan.readHostedFamilyOwnerSnapshotForMember,
    readHostedMemberStripeBillingRef:
      memberBillingStore.readHostedMemberStripeBillingRef,
    upsertHostedMemberIdentity: memberIdentityStore.upsertHostedMemberIdentity,
    upsertHostedMemberEmailAuthorization:
      memberStore.upsertHostedMemberEmailAuthorization,
    writeHostedMemberStripeBillingRefTx:
      memberBillingStore.writeHostedMemberStripeBillingRefTx,
  };
}

function clearHostedBillingTestkitGlobals(): void {
  const globalState = globalThis as typeof globalThis & {
    __murphHostedOnboardingEnv?: unknown;
    __murphHostedOnboardingStripe?: unknown;
  };
  delete globalState.__murphHostedOnboardingEnv;
  delete globalState.__murphHostedOnboardingStripe;
}
