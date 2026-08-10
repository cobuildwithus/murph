import { createHostedWebSmokeEnvironment } from "../../next-artifacts";
import {
  buildJunctionProviderSourceInstanceKey,
} from "@murphai/device-syncd/connect-config";
import {
  JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS,
} from "@murphai/device-syncd/hosted-runtime";
import {
  decodeHostedDeviceRoutingIndexKey,
} from "../../src/lib/device-sync/routing-index";
import type {
  CompanionHrvRmssdObservation,
} from "@murphai/contracts";

const prismaModuleSpecifier = new URL("../../src/lib/prisma.ts", import.meta.url).href;
const deviceSyncPrismaStoreModuleSpecifier = new URL(
  "../../src/lib/device-sync/prisma-store.ts",
  import.meta.url,
).href;
const deviceSyncWakeServiceModuleSpecifier = new URL(
  "../../src/lib/device-sync/wake-service.ts",
  import.meta.url,
).href;
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
const hostedLinqLineStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/linq-line-store.ts",
  import.meta.url,
).href;
const hostedLinqDailyStateModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/linq-daily-state.ts",
  import.meta.url,
).href;
const hostedCryptoDomainRootStoreModuleSpecifier = new URL(
  "../../src/lib/hosted-crypto/domain-root-store.ts",
  import.meta.url,
).href;
const hostedAppSessionModuleSpecifier = new URL(
  "../../src/lib/hosted-onboarding/app-session.ts",
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
  recentInboundAt?: Date | string | null;
  walletAddress?: string | null;
}

interface HostedFamilySponsoredLinqMemberSeedInput {
  environment?: NodeJS.ProcessEnv;
  groupId: string;
  homePhone: string;
  memberId: string;
  memberPhone: string;
  ownerMemberId: string;
  recentInboundAt?: Date | string | null;
}

interface HostedLinqFirstContactFallbackLineSeedInput {
  environment?: NodeJS.ProcessEnv;
  fallbackPhone: string;
  incomingPhone: string;
}

interface HostedLinqFirstContactMemberStateInput {
  environment?: NodeJS.ProcessEnv;
  memberPhone: string;
}

export interface HostedLinqFirstContactMemberState {
  homeChatId: string | null;
  homeRecipientPhone: string | null;
  memberCount: number;
  memberId: string | null;
  pendingChatId: string | null;
}

interface HostedActiveTelegramMemberBindingInput {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  telegramThreadId?: string | null;
  telegramUserId: string;
}

interface HostedJunctionDeviceSyncReplayDirtyResource {
  count: number;
  jobKind: "resource";
  payload: Record<string, boolean | number | string>;
  resource: string;
  resourceCategory: "summary" | "timeseries";
  sourceProviderSlug: string;
  windowEnd: string;
  windowStart: string;
}

interface HostedJunctionDeviceSyncReplaySource {
  displayName: string;
  sourceProviderSlug: string;
}

export interface HostedJunctionDeviceSyncReplaySeedInput {
  connectedAt: string;
  dirtyAt?: string | null;
  dirtyResources: readonly HostedJunctionDeviceSyncReplayDirtyResource[];
  displayName: string;
  environment?: NodeJS.ProcessEnv;
  externalAccountId: string;
  memberId: string;
  sources: readonly HostedJunctionDeviceSyncReplaySource[];
}

export interface HostedJunctionDeviceSyncConnectionSeedInput {
  connectedAt: string;
  displayName: string;
  environment?: NodeJS.ProcessEnv;
  externalAccountId: string;
  memberId: string;
  sources: readonly HostedJunctionDeviceSyncReplaySource[];
}

export interface HostedJunctionDeviceSyncConnectionSeedResult {
  connectionId: string;
  sourceCount: number;
}

export interface HostedJunctionDeviceSyncReplaySeedResult {
  connectionId: string;
  dirtyResourceCount: number;
  sourceCount: number;
}

export interface HostedJunctionDeviceSyncReplayDrainStatusInput {
  connectionId: string;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
}

export interface HostedJunctionDeviceSyncReplayDrainStatus {
  hasPendingDirtyConnection: boolean;
  hasPendingDirtyConnectionForUser: boolean;
  historicalBackfillEmptyAttempts: number | null;
  historicalBackfillEvidence: string | null;
  historicalBackfillLastEmptyAt: string | null;
  historicalBackfillStatus: string | null;
}

export interface HostedCompanionHrvRmssdObservationSeedInput {
  acceptedAt: string;
  connectionId: string;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  observation: CompanionHrvRmssdObservation;
}

export interface HostedAppSessionForTestInput {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  privyUserId: string;
  secureCookieMode: boolean;
}

export interface HostedAppSessionForTest {
  cookieName: string;
  cookieValue: string;
  secureCookieMode: boolean;
  sessionId: string;
}

export interface HostedDeviceSyncConnectionForTestInput {
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  provider?: string;
}

export interface HostedDeviceSyncConnectionSourceForTest {
  sourceProviderSlug: string;
  status: string;
}

export interface HostedDeviceSyncConnectionForTest {
  connectionId: string;
  provider: string;
  status: string;
  setupPhase: string | null;
  setupExpiresAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  sources: HostedDeviceSyncConnectionSourceForTest[];
}

interface HostedMemberSeedTransactionClient {
  hostedAccountGroup: {
    create(input: { data: Record<string, unknown> }): Promise<unknown>;
  };
  hostedMember: {
    update(input: {
      data: Record<string, unknown>;
      where: { id: string };
    }): Promise<unknown>;
  };
  hostedMemberIdentity: {
    findMany(input: {
      select: { memberId: true };
      where: { phoneLookupKey: { in: readonly string[] } };
    }): Promise<Array<{ memberId: string }>>;
  };
}

interface HostedMemberSeedPrismaClient {
  $disconnect(): Promise<void>;
  $transaction<T>(
    callback: (tx: HostedMemberSeedTransactionClient) => Promise<T>,
  ): Promise<T>;
}

interface HostedMemberSeedPrismaModule {
  createPrismaClient(input: {
    databaseUrl: string;
    poolMax?: number;
  }): HostedMemberSeedPrismaClient;
}

interface HostedMemberStoreModule {
  createHostedMember(input: {
    billingStatus: "active" | "not_started";
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
  createHostedPhoneLookupKeyReadCandidates(phoneNumber: string): string[];
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
  readHostedMemberRoutingState(input: {
    memberId: string;
    prisma: unknown;
  }): Promise<{
    linqChatId: string | null;
    linqRecipientPhone: string | null;
    pendingLinqChatId: string | null;
  } | null>;
  upsertHostedMemberHomeLinqBindingTx(input: {
    clearPending: boolean;
    linqChatId: string;
    memberId: string;
    participantContact?: {
      kind: "phone";
      lookupKey: string;
    } | null;
    prisma: unknown;
    recipientPhone: string;
  }): Promise<unknown>;
  upsertHostedMemberHomeLinqRecipientPhoneTx(input: {
    clearPending: boolean;
    memberId: string;
    prisma: unknown;
    recipientPhone: string;
  }): Promise<unknown>;
  upsertHostedMemberTelegramRoutingBindingTx(input: {
    memberId: string;
    prisma: unknown;
    telegramThreadId?: string | null;
    telegramUserId: string;
  }): Promise<unknown>;
}

interface HostedLinqLineStoreModule {
  projectHostedLinqLineForDeliveryReceiptTx(input: {
    deliveryStatus: "delivered" | "failed";
    eventId: string;
    failureCode: string | null;
    failureReason: string | null;
    lineLookupKey: string;
    prisma: unknown;
    providerCreatedAt: Date;
  }): Promise<boolean>;
  upsertHostedLinqLineForPhoneTx(input: {
    activeMemberLimit?: number | null;
    observedAt: Date;
    phoneNumber: string;
    prisma: unknown;
    providerStatus?: string | null;
    source: "configured";
  }): Promise<{ phoneNumberLookupKey: string }>;
}

interface HostedLinqDailyStateModule {
  incrementHostedLinqInboundDailyState(input: {
    memberId: string;
    occurredAt: Date | string;
    prisma: unknown;
  }): Promise<unknown>;
}

interface HostedDeviceSyncControlPlaneStore {
  getStoredConnectionAccountForUser(
    userId: string,
    connectionId: string,
  ): Promise<{
    id: string;
    metadata: Record<string, unknown>;
    provider: string;
  } | null>;
  listConnectionsForUser(userId: string): Promise<Array<{
    id: string;
    provider: string;
    status: string;
    setupPhase?: string | null;
    setupExpiresAt?: string | null;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
  }>>;
  listConnectionSources(connectionId: string): Promise<Array<{
    sourceProviderSlug: string;
    status: string;
  }>>;
  upsertConnection(input: {
    connectedAt: string;
    credential: {
      kind: "provider_config";
      providerConfigKey: "junction";
    };
    displayName: string;
    existingAccountPolicy: "replace";
    externalAccountId: string;
    metadata?: Record<string, unknown>;
    nextReconcileAt?: string | null;
    ownerId: string;
    provider: "junction";
    scopes?: string[];
    setupPhase?: "source_confirmed";
    status: "active";
  }): Promise<{ id: string }>;
  upsertConnectionSource(input: {
    connectionId: string;
    displayName: string;
    firstSeenAt: string;
    lastSeenAt: string;
    sourceInstanceKey: string;
    sourceProviderSlug: string;
    status: "connected";
  }): Promise<unknown>;
  upsertDirtyConnection(input: {
    connectionId: string;
    dirtyAt: string;
    eventType?: string | null;
    provider: "junction";
    resources: readonly HostedJunctionDeviceSyncReplayDirtyResource[];
    traceId?: string | null;
    userId: string;
  }): Promise<unknown>;
  hasPendingDirtyConnection(connectionId: string): Promise<boolean>;
  hasPendingDirtyConnectionForUser(userId: string): Promise<boolean>;
}

interface HostedDeviceSyncPrismaStoreModule {
  PrismaDeviceSyncControlPlaneStore: new(input: {
    prisma: HostedMemberSeedPrismaClient;
    providerAccountBlindIndexKey?: Buffer | null;
  }) => HostedDeviceSyncControlPlaneStore;
}

interface HostedMemberSeedModules {
  createPrismaClient: HostedMemberSeedPrismaModule["createPrismaClient"];
  createHostedMember: HostedMemberStoreModule["createHostedMember"];
  createHostedPhoneLookupKey: ContactPrivacyModule["createHostedPhoneLookupKey"];
  createHostedPhoneLookupKeyReadCandidates:
    ContactPrivacyModule["createHostedPhoneLookupKeyReadCandidates"];
  provisionHostedCryptoDomainRootsForUserTx:
    HostedCryptoDomainRootStoreModule["provisionHostedCryptoDomainRootsForUserTx"];
  readHostedPhoneHint: ContactPrivacyModule["readHostedPhoneHint"];
  readHostedMemberRoutingState:
    HostedMemberRoutingStoreModule["readHostedMemberRoutingState"];
  upsertHostedMemberHomeLinqBindingTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqBindingTx"];
  upsertHostedMemberHomeLinqRecipientPhoneTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberHomeLinqRecipientPhoneTx"];
  upsertHostedMemberTelegramRoutingBindingTx:
    HostedMemberRoutingStoreModule["upsertHostedMemberTelegramRoutingBindingTx"];
  upsertHostedMemberIdentity: HostedMemberIdentityStoreModule["upsertHostedMemberIdentity"];
  incrementHostedLinqInboundDailyState:
    HostedLinqDailyStateModule["incrementHostedLinqInboundDailyState"];
  projectHostedLinqLineForDeliveryReceiptTx:
    HostedLinqLineStoreModule["projectHostedLinqLineForDeliveryReceiptTx"];
  upsertHostedLinqLineForPhoneTx:
    HostedLinqLineStoreModule["upsertHostedLinqLineForPhoneTx"];
  writeHostedMemberStripeBillingRefTx:
    HostedMemberBillingStoreModule["writeHostedMemberStripeBillingRefTx"];
}

interface HostedJunctionDeviceSyncReplaySeedModules {
  createPrismaClient: HostedMemberSeedPrismaModule["createPrismaClient"];
  PrismaDeviceSyncControlPlaneStore:
    HostedDeviceSyncPrismaStoreModule["PrismaDeviceSyncControlPlaneStore"];
}

interface HostedCompanionHrvRmssdSeedModules
  extends HostedJunctionDeviceSyncReplaySeedModules {
  acceptHostedCompanionHrvRmssdObservation(input: {
    acceptedAt: string;
    account: { id: string; provider: string };
    resource: unknown;
    store: HostedDeviceSyncControlPlaneStore;
    userId: string;
  }): Promise<void>;
  buildHostedCompanionHrvRmssdDirtyResource(
    observation: CompanionHrvRmssdObservation,
  ): unknown;
}

interface HostedAppSessionModule {
  issueHostedAppSession(input: {
    memberId: string;
    now?: Date;
    privyUserId: string;
  }): Promise<{ cookie: string; sessionId: string }>;
}

export async function seedHostedActiveMember(
  input: HostedActiveMemberSeedInput,
): Promise<void> {
  if (!input.memberId.trim()) {
    throw new Error("Hosted member seed requires MURPH_E2E_MEMBER_ID.");
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
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
  });
}

export async function seedHostedActiveLinqMember(
  input: HostedActiveLinqMemberSeedInput,
): Promise<void> {
  if (!input.memberId.trim() || !input.memberPhone.trim() || !input.homePhone.trim()) {
    throw new Error("Hosted Linq member seed requires member id, member phone, and home phone.");
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
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
        // A member's assigned home phone must exist in the hosted_linq_line
        // inventory; route binding rejects lines the DB does not know.
        await modules.upsertHostedLinqLineForPhoneTx({
          observedAt: new Date(),
          phoneNumber: input.homePhone,
          prisma: tx,
          source: "configured",
        });
        await modules.upsertHostedMemberHomeLinqRecipientPhoneTx({
          clearPending: true,
          memberId: input.memberId,
          prisma: tx,
          recipientPhone: input.homePhone,
        });
        const recentInboundAt = input.recentInboundAt === undefined
          ? null
          : normalizeHostedMemberSeedDate(input.recentInboundAt);
        if (recentInboundAt) {
          await seedHostedMemberLinqRecentInboundAtTx({
            memberId: input.memberId,
            modules,
            tx,
            value: recentInboundAt,
          });
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function seedHostedFamilySponsoredLinqMember(
  input: HostedFamilySponsoredLinqMemberSeedInput,
): Promise<void> {
  if (
    !input.groupId.trim()
    || !input.ownerMemberId.trim()
    || input.ownerMemberId === input.memberId
  ) {
    throw new Error(
      "Hosted family-sponsored Linq member seed requires distinct owner, member, and group ids.",
    );
  }

  await seedHostedActiveLinqMember({
    environment: input.environment,
    homePhone: input.homePhone,
    memberId: input.memberId,
    memberPhone: input.memberPhone,
    recentInboundAt: input.recentInboundAt,
  });

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedMemberSeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });
    const now = new Date();
    const currentPeriodStart = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
    const currentPeriodEnd = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1_000);

    try {
      await prisma.$transaction(async (tx) => {
        await modules.createHostedMember({
          billingStatus: "active",
          memberId: input.ownerMemberId,
          prisma: tx,
        });
        await tx.hostedMember.update({
          data: {
            billingStatus: "not_started",
          },
          where: {
            id: input.memberId,
          },
        });
        await tx.hostedAccountGroup.create({
          data: {
            billingRef: {
              create: {
                billedSeatCount: 2,
                currentBillingPhase: "paid",
                currentBillingPlanCode: "launch_family_monthly",
                currentPeriodEnd,
                currentPeriodStart,
              },
            },
            billingStatus: "active",
            displayName: "Hosted local family fixture",
            id: input.groupId,
            memberships: {
              create: [
                {
                  id: `membership_${input.groupId}_owner`,
                  joinedAt: now,
                  memberId: input.ownerMemberId,
                  role: "owner",
                  status: "active",
                },
                {
                  id: `membership_${input.groupId}_member`,
                  joinedAt: now,
                  memberId: input.memberId,
                  role: "member",
                  status: "active",
                },
              ],
            },
            ownerMemberId: input.ownerMemberId,
          },
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function seedHostedLinqFirstContactFallbackLines(
  input: HostedLinqFirstContactFallbackLineSeedInput,
): Promise<void> {
  if (
    !input.incomingPhone.trim()
    || !input.fallbackPhone.trim()
    || input.incomingPhone.trim() === input.fallbackPhone.trim()
  ) {
    throw new Error(
      "Hosted Linq first-contact fallback seed requires distinct incoming and fallback phones.",
    );
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedMemberSeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });

    try {
      await prisma.$transaction(async (tx) => {
        const observedAt = new Date();
        const incomingLine = await modules.upsertHostedLinqLineForPhoneTx({
          observedAt,
          phoneNumber: input.incomingPhone,
          prisma: tx,
          source: "configured",
        });
        const fallbackLine = await modules.upsertHostedLinqLineForPhoneTx({
          observedAt,
          phoneNumber: input.fallbackPhone,
          prisma: tx,
          source: "configured",
        });
        await modules.projectHostedLinqLineForDeliveryReceiptTx({
          deliveryStatus: "failed",
          eventId: "e2e-incoming-line-delivery-failed",
          failureCode: "e2e_seed",
          failureReason: null,
          lineLookupKey: incomingLine.phoneNumberLookupKey,
          prisma: tx,
          providerCreatedAt: observedAt,
        });
        await modules.projectHostedLinqLineForDeliveryReceiptTx({
          deliveryStatus: "delivered",
          eventId: "e2e-fallback-line-delivered",
          failureCode: null,
          failureReason: null,
          lineLookupKey: fallbackLine.phoneNumberLookupKey,
          prisma: tx,
          providerCreatedAt: observedAt,
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function readHostedLinqFirstContactMemberState(
  input: HostedLinqFirstContactMemberStateInput,
): Promise<HostedLinqFirstContactMemberState> {
  if (!input.memberPhone.trim()) {
    throw new Error("Hosted Linq first-contact member-state read requires a member phone.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedMemberSeedModules(environment);
    const phoneLookupKeys = modules.createHostedPhoneLookupKeyReadCandidates(
      input.memberPhone,
    );
    if (phoneLookupKeys.length === 0) {
      throw new Error("Hosted Linq first-contact member-state read requires a valid phone.");
    }
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });

    try {
      return await prisma.$transaction(async (tx) => {
        const identities = await tx.hostedMemberIdentity.findMany({
          select: {
            memberId: true,
          },
          where: {
            phoneLookupKey: {
              in: phoneLookupKeys,
            },
          },
        });
        const memberIds = [...new Set(identities.map((identity) => identity.memberId))];
        const memberId = memberIds.length === 1 ? memberIds[0] ?? null : null;
        const routing = memberId
          ? await modules.readHostedMemberRoutingState({
              memberId,
              prisma: tx,
            })
          : null;

        return {
          homeChatId: routing?.linqChatId ?? null,
          homeRecipientPhone: routing?.linqRecipientPhone ?? null,
          memberCount: memberIds.length,
          memberId,
          pendingChatId: routing?.pendingLinqChatId ?? null,
        };
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function seedHostedMemberLinqRecentInboundAtTx(input: {
  memberId: string;
  modules: HostedMemberSeedModules;
  tx: unknown;
  value: Date;
}): Promise<void> {
  await input.modules.incrementHostedLinqInboundDailyState({
    memberId: input.memberId,
    occurredAt: input.value,
    prisma: input.tx,
  });
}

function normalizeHostedMemberSeedDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Hosted member Linq recent inbound seed timestamp must be valid.");
  }
  return date;
}

export async function bindHostedActiveLinqHomeChat(input: {
  chatId: string;
  environment?: NodeJS.ProcessEnv;
  memberId: string;
  participantPhone?: string;
  recentInboundAt?: Date | string | null;
  recipientPhone: string;
}): Promise<void> {
  if (!input.memberId.trim() || !input.chatId.trim() || !input.recipientPhone.trim()) {
    throw new Error(
      "Hosted Linq home chat binding requires member id, chat id, and recipient phone.",
    );
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedMemberSeedModules(environment);
    const participantLookupKey = input.participantPhone
      ? modules.createHostedPhoneLookupKey(input.participantPhone)
      : null;
    if (input.participantPhone && !participantLookupKey) {
      throw new Error("Hosted Linq home chat binding requires a valid participant phone.");
    }
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
          participantContact: participantLookupKey
            ? { kind: "phone", lookupKey: participantLookupKey }
            : null,
          prisma: tx,
          recipientPhone: input.recipientPhone,
        });
        const recentInboundAt = input.recentInboundAt === undefined
          ? null
          : normalizeHostedMemberSeedDate(input.recentInboundAt);
        if (recentInboundAt) {
          await seedHostedMemberLinqRecentInboundAtTx({
            memberId: input.memberId,
            modules,
            tx,
            value: recentInboundAt,
          });
        }
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function bindHostedActiveTelegramMember(
  input: HostedActiveTelegramMemberBindingInput,
): Promise<void> {
  if (!input.memberId.trim() || !input.telegramUserId.trim()) {
    throw new Error("Hosted Telegram binding requires member id and Telegram user id.");
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedMemberSeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });

    try {
      await prisma.$transaction(async (tx) => {
        await modules.upsertHostedMemberTelegramRoutingBindingTx({
          memberId: input.memberId,
          prisma: tx,
          telegramThreadId: input.telegramThreadId,
          telegramUserId: input.telegramUserId,
        });
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function seedHostedJunctionDeviceSyncConnection(
  input: HostedJunctionDeviceSyncConnectionSeedInput,
): Promise<HostedJunctionDeviceSyncConnectionSeedResult> {
  if (!input.memberId.trim() || !input.externalAccountId.trim()) {
    throw new Error("Hosted Junction connection seed requires member id and external account id.");
  }
  if (input.sources.length === 0) {
    throw new Error("Hosted Junction connection seed requires source records.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedJunctionDeviceSyncReplaySeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });
    const store = new modules.PrismaDeviceSyncControlPlaneStore({
      prisma,
      providerAccountBlindIndexKey: readHostedJunctionReplayProviderAccountBlindIndexKey(environment),
    });

    try {
      return await seedHostedJunctionDeviceSyncConnectionWithStore({
        input,
        store,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function seedHostedCompanionHrvRmssdObservation(
  input: HostedCompanionHrvRmssdObservationSeedInput,
): Promise<void> {
  if (!input.memberId.trim() || !input.connectionId.trim()) {
    throw new Error(
      "Hosted companion HRV seed requires member id and connection id.",
    );
  }

  await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedCompanionHrvRmssdSeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({ environment, modules });
    const store = new modules.PrismaDeviceSyncControlPlaneStore({
      prisma,
      providerAccountBlindIndexKey:
        readHostedJunctionReplayProviderAccountBlindIndexKey(environment),
    });

    try {
      const account = await store.getStoredConnectionAccountForUser(
        input.memberId,
        input.connectionId,
      );
      if (
        !account
        || account.id !== input.connectionId
        || account.provider !== "junction"
      ) {
        throw new Error(
          "Hosted companion HRV seed requires one matching Junction connection.",
        );
      }
      await modules.acceptHostedCompanionHrvRmssdObservation({
        acceptedAt: input.acceptedAt,
        account,
        resource: modules.buildHostedCompanionHrvRmssdDirtyResource(
          input.observation,
        ),
        store,
        userId: input.memberId,
      });
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function seedHostedJunctionDeviceSyncReplay(
  input: HostedJunctionDeviceSyncReplaySeedInput,
): Promise<HostedJunctionDeviceSyncReplaySeedResult> {
  if (!input.memberId.trim() || !input.externalAccountId.trim()) {
    throw new Error("Hosted Junction replay seed requires member id and external account id.");
  }
  if (input.dirtyResources.length === 0) {
    throw new Error("Hosted Junction replay seed requires dirty resources.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedJunctionDeviceSyncReplaySeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });
    const store = new modules.PrismaDeviceSyncControlPlaneStore({
      prisma,
      providerAccountBlindIndexKey: readHostedJunctionReplayProviderAccountBlindIndexKey(environment),
    });

    try {
      const connection = await seedHostedJunctionDeviceSyncConnectionWithStore({
        input,
        store,
      });

      await store.upsertDirtyConnection({
        connectionId: connection.connectionId,
        dirtyAt: input.dirtyAt ?? input.connectedAt,
        eventType: "junction.fixture.replay",
        provider: "junction",
        resources: input.dirtyResources,
        traceId: `junction-fixture-${connection.connectionId}`,
        userId: input.memberId,
      });

      return {
        connectionId: connection.connectionId,
        dirtyResourceCount: input.dirtyResources.length,
        sourceCount: connection.sourceCount,
      };
    } finally {
      await prisma.$disconnect();
    }
  });
}

export async function readHostedJunctionDeviceSyncReplayDrainStatus(
  input: HostedJunctionDeviceSyncReplayDrainStatusInput,
): Promise<HostedJunctionDeviceSyncReplayDrainStatus> {
  if (!input.memberId.trim() || !input.connectionId.trim()) {
    throw new Error("Hosted Junction replay drain status requires member id and connection id.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedJunctionDeviceSyncReplaySeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });
    const store = new modules.PrismaDeviceSyncControlPlaneStore({
      prisma,
      providerAccountBlindIndexKey: readHostedJunctionReplayProviderAccountBlindIndexKey(environment),
    });

    try {
      const [
        hasPendingDirtyConnection,
        hasPendingDirtyConnectionForUser,
        account,
      ] = await Promise.all([
        store.hasPendingDirtyConnection(input.connectionId),
        store.hasPendingDirtyConnectionForUser(input.memberId),
        store.getStoredConnectionAccountForUser(input.memberId, input.connectionId),
      ]);
      const metadata = account?.metadata ?? {};
      const historicalBackfillEmptyAttempts =
        metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.emptyAttempts];
      const historicalBackfillEvidence =
        metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.evidence];
      const historicalBackfillLastEmptyAt =
        metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.lastEmptyAt];
      const historicalBackfillStatus =
        metadata[JUNCTION_HISTORICAL_BACKFILL_METADATA_KEYS.status];

      return {
        hasPendingDirtyConnection,
        hasPendingDirtyConnectionForUser,
        historicalBackfillEmptyAttempts:
          typeof historicalBackfillEmptyAttempts === "number"
          && Number.isInteger(historicalBackfillEmptyAttempts)
          && historicalBackfillEmptyAttempts >= 0
            ? historicalBackfillEmptyAttempts
            : null,
        historicalBackfillEvidence:
          typeof historicalBackfillEvidence === "string"
            ? historicalBackfillEvidence
            : null,
        historicalBackfillLastEmptyAt:
          typeof historicalBackfillLastEmptyAt === "string"
            ? historicalBackfillLastEmptyAt
            : null,
        historicalBackfillStatus:
          typeof historicalBackfillStatus === "string"
            ? historicalBackfillStatus
            : null,
      };
    } finally {
      await prisma.$disconnect();
    }
  });
}

/**
 * Issues a real hosted app session for a seeded member by running the
 * production `issueHostedAppSession` in-process against the harness database.
 * The caller must supply the same `HOSTED_APP_SESSION_HMAC_KEY` the hosted web
 * process runs with (the full-stack harness exposes it) so the minted cookie
 * verifies against the session row over HTTP.
 */
export async function issueHostedAppSessionForTest(
  input: HostedAppSessionForTestInput,
): Promise<HostedAppSessionForTest> {
  if (!input.memberId.trim() || !input.privyUserId.trim()) {
    throw new Error("Hosted app session issuance requires member id and privy user id.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async () => {
    const appSessionModule = await import(hostedAppSessionModuleSpecifier) as HostedAppSessionModule;
    const issued = await appSessionModule.issueHostedAppSession({
      memberId: input.memberId,
      privyUserId: input.privyUserId,
    });
    const [cookiePair] = issued.cookie.split(";");
    const separatorIndex = cookiePair?.indexOf("=") ?? -1;
    if (!cookiePair || separatorIndex <= 0) {
      throw new Error("Hosted app session issuance returned an unparsable cookie.");
    }

    const issuedCookieName = cookiePair.slice(0, separatorIndex).trim();
    const unprefixedCookieName = issuedCookieName.startsWith("__Host-")
      ? issuedCookieName.slice("__Host-".length)
      : issuedCookieName;

    return {
      cookieName: input.secureCookieMode
        ? `__Host-${unprefixedCookieName}`
        : unprefixedCookieName,
      cookieValue: decodeURIComponent(cookiePair.slice(separatorIndex + 1)),
      secureCookieMode: input.secureCookieMode,
      sessionId: issued.sessionId,
    };
  });
}

/**
 * Reads the persisted device-sync connection state (connection row + source
 * rows) the way production reads it, so hosted E2E specs can assert the final
 * lifecycle outcome of a connect flow.
 */
export async function readHostedDeviceSyncConnectionForTest(
  input: HostedDeviceSyncConnectionForTestInput,
): Promise<HostedDeviceSyncConnectionForTest> {
  if (!input.memberId.trim()) {
    throw new Error("Hosted device-sync connection read requires a member id.");
  }

  return await withHostedMemberSeedEnvironment(input.environment, async (environment) => {
    const modules = await loadHostedJunctionDeviceSyncReplaySeedModules(environment);
    const prisma = createHostedMemberSeedPrisma({
      environment,
      modules,
    });
    const store = new modules.PrismaDeviceSyncControlPlaneStore({
      prisma,
      providerAccountBlindIndexKey: readHostedJunctionReplayProviderAccountBlindIndexKey(environment),
    });

    try {
      const connections = (await store.listConnectionsForUser(input.memberId))
        .filter((connection) => !input.provider || connection.provider === input.provider);
      const [connection] = connections;
      if (!connection || connections.length !== 1) {
        throw new Error(
          `Expected exactly one hosted device-sync connection for the member, found ${connections.length}.`,
        );
      }

      const sources = await store.listConnectionSources(connection.id);
      return {
        connectionId: connection.id,
        provider: connection.provider,
        status: connection.status,
        setupPhase: connection.setupPhase ?? null,
        setupExpiresAt: connection.setupExpiresAt ?? null,
        lastErrorCode: connection.lastErrorCode,
        lastErrorMessage: connection.lastErrorMessage,
        sources: sources.map((source) => ({
          sourceProviderSlug: source.sourceProviderSlug,
          status: source.status,
        })),
      };
    } finally {
      await prisma.$disconnect();
    }
  });
}

async function seedHostedJunctionDeviceSyncConnectionWithStore(input: {
  input: HostedJunctionDeviceSyncConnectionSeedInput;
  store: HostedDeviceSyncControlPlaneStore;
}): Promise<HostedJunctionDeviceSyncConnectionSeedResult> {
  const connection = await input.store.upsertConnection({
    connectedAt: input.input.connectedAt,
    credential: {
      kind: "provider_config",
      providerConfigKey: "junction",
    },
    displayName: input.input.displayName,
    externalAccountId: input.input.externalAccountId,
    metadata: {
      fixture: "junction-wearable-hosted-replay",
    },
    nextReconcileAt: null,
    ownerId: input.input.memberId,
    existingAccountPolicy: "replace",
    provider: "junction",
    scopes: [],
    setupPhase: "source_confirmed",
    status: "active",
  });

  for (const source of input.input.sources) {
    const sourceInstanceKey = buildJunctionProviderSourceInstanceKey({
      connectionId: connection.id,
      sourceProviderSlug: source.sourceProviderSlug,
    });
    if (!sourceInstanceKey) {
      throw new Error("Hosted Junction connection seed could not build a source instance key.");
    }

    await input.store.upsertConnectionSource({
      connectionId: connection.id,
      displayName: source.displayName,
      firstSeenAt: input.input.connectedAt,
      lastSeenAt: input.input.connectedAt,
      sourceInstanceKey,
      sourceProviderSlug: source.sourceProviderSlug,
      status: "connected",
    });
  }

  return {
    connectionId: connection.id,
    sourceCount: input.input.sources.length,
  };
}

async function withHostedMemberSeedEnvironment<T>(
  source: NodeJS.ProcessEnv | undefined,
  operation: (environment: NodeJS.ProcessEnv) => Promise<T>,
): Promise<T> {
  const scope = applyHostedMemberSeedEnvironment(source);
  try {
    return await operation(scope.environment);
  } finally {
    scope.restore();
  }
}

function applyHostedMemberSeedEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): { environment: NodeJS.ProcessEnv; restore(): void } {
  const runtimeEnv = createHostedWebSmokeEnvironment(source);
  const keysToRestore = new Set([
    ...Object.keys(runtimeEnv),
    ...Object.keys(hostedMemberSeedHostOnlyEnv),
  ]);
  const previousValues = new Map(
    [...keysToRestore].map((key) => [key, process.env[key]] as const),
  );

  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  restoreHostedMemberSeedHostOnlyEnv();
  clearHostedMemberSeedGlobals();
  return {
    environment: runtimeEnv,
    restore: () => {
      for (const [key, value] of previousValues) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      clearHostedMemberSeedGlobals();
    },
  };
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
    hostedLinqDailyStateModule,
    hostedLinqLineStoreModule,
  ] = await Promise.all([
    import(prismaModuleSpecifier),
    import(contactPrivacyModuleSpecifier),
    import(hostedCryptoDomainRootStoreModuleSpecifier),
    import(hostedMemberIdentityStoreModuleSpecifier),
    import(hostedMemberRoutingStoreModuleSpecifier),
    import(hostedMemberStoreModuleSpecifier),
    import(hostedMemberBillingStoreModuleSpecifier),
    import(hostedLinqDailyStateModuleSpecifier),
    import(hostedLinqLineStoreModuleSpecifier),
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
  const typedHostedLinqDailyStateModule =
    hostedLinqDailyStateModule as HostedLinqDailyStateModule;
  const typedHostedLinqLineStoreModule =
    hostedLinqLineStoreModule as HostedLinqLineStoreModule;

  return {
    createPrismaClient: typedPrismaModule.createPrismaClient,
    createHostedMember: typedHostedMemberStoreModule.createHostedMember,
    createHostedPhoneLookupKey: typedContactPrivacyModule.createHostedPhoneLookupKey,
    createHostedPhoneLookupKeyReadCandidates:
      typedContactPrivacyModule.createHostedPhoneLookupKeyReadCandidates,
    provisionHostedCryptoDomainRootsForUserTx:
      typedHostedCryptoDomainRootStoreModule.provisionHostedCryptoDomainRootsForUserTx,
    readHostedPhoneHint: typedContactPrivacyModule.readHostedPhoneHint,
    readHostedMemberRoutingState:
      typedHostedMemberRoutingStoreModule.readHostedMemberRoutingState,
    upsertHostedMemberHomeLinqBindingTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqBindingTx,
    upsertHostedMemberHomeLinqRecipientPhoneTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberHomeLinqRecipientPhoneTx,
    upsertHostedMemberTelegramRoutingBindingTx:
      typedHostedMemberRoutingStoreModule.upsertHostedMemberTelegramRoutingBindingTx,
    upsertHostedMemberIdentity: typedHostedMemberIdentityStoreModule.upsertHostedMemberIdentity,
    incrementHostedLinqInboundDailyState:
      typedHostedLinqDailyStateModule.incrementHostedLinqInboundDailyState,
    projectHostedLinqLineForDeliveryReceiptTx:
      typedHostedLinqLineStoreModule.projectHostedLinqLineForDeliveryReceiptTx,
    upsertHostedLinqLineForPhoneTx:
      typedHostedLinqLineStoreModule.upsertHostedLinqLineForPhoneTx,
    writeHostedMemberStripeBillingRefTx:
      typedHostedMemberBillingStoreModule.writeHostedMemberStripeBillingRefTx,
  };
}

async function loadHostedJunctionDeviceSyncReplaySeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedJunctionDeviceSyncReplaySeedModules> {
  const [prismaModule, deviceSyncPrismaStoreModule] = await Promise.all([
    import(prismaModuleSpecifier),
    import(deviceSyncPrismaStoreModuleSpecifier),
  ]);

  if (environment.DATABASE_URL) {
    process.env.DATABASE_URL = environment.DATABASE_URL;
  }

  const typedPrismaModule = prismaModule as HostedMemberSeedPrismaModule;
  const typedDeviceSyncPrismaStoreModule =
    deviceSyncPrismaStoreModule as HostedDeviceSyncPrismaStoreModule;

  return {
    createPrismaClient: typedPrismaModule.createPrismaClient,
    PrismaDeviceSyncControlPlaneStore:
      typedDeviceSyncPrismaStoreModule.PrismaDeviceSyncControlPlaneStore,
  };
}

async function loadHostedCompanionHrvRmssdSeedModules(
  environment: NodeJS.ProcessEnv,
): Promise<HostedCompanionHrvRmssdSeedModules> {
  const [modules, wakeServiceModule] = await Promise.all([
    loadHostedJunctionDeviceSyncReplaySeedModules(environment),
    import(deviceSyncWakeServiceModuleSpecifier),
  ]);
  const typedWakeServiceModule =
    wakeServiceModule as Pick<
      HostedCompanionHrvRmssdSeedModules,
      | "acceptHostedCompanionHrvRmssdObservation"
      | "buildHostedCompanionHrvRmssdDirtyResource"
    >;
  return {
    ...modules,
    acceptHostedCompanionHrvRmssdObservation:
      typedWakeServiceModule.acceptHostedCompanionHrvRmssdObservation,
    buildHostedCompanionHrvRmssdDirtyResource:
      typedWakeServiceModule.buildHostedCompanionHrvRmssdDirtyResource,
  };
}

function createHostedMemberSeedPrisma(input: {
  environment: NodeJS.ProcessEnv;
  modules: {
    createPrismaClient: HostedMemberSeedPrismaModule["createPrismaClient"];
  };
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

function readHostedJunctionReplayProviderAccountBlindIndexKey(
  environment: NodeJS.ProcessEnv,
): Buffer {
  const value = environment.HOSTED_DEVICE_ROUTING_INDEX_KEY?.trim();
  if (!value) {
    throw new Error("Hosted Junction replay seed requires HOSTED_DEVICE_ROUTING_INDEX_KEY.");
  }

  return decodeHostedDeviceRoutingIndexKey(value);
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
