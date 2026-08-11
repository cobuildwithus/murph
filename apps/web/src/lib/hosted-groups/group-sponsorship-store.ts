import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  HostedGroupSponsorshipAuthorizationStatus,
  HostedUsageCreditPurchaseStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";

import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxStrings,
} from "../hosted-crypto/secure-box";
import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import {
  HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
  type HostedGroupSponsorshipCreativeFormat,
  type HostedGroupSponsorshipCreativeRequest,
  type HostedGroupSponsorshipDraft,
  type HostedGroupFundingRecognitionConsent,
} from "./group-sponsorship-contract";
import {
  activeHostedThreadContainerParticipantWhere,
} from "./thread-container-participant-access";
import {
  getHostedGroupSponsorshipExperiencePolicy,
  isHostedGroupSponsorshipOfferCode,
} from "./group-sponsorship-policy";

export {
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
} from "./group-sponsorship-contract";
export type {
  HostedGroupSponsorshipCreativeFormat,
  HostedGroupSponsorshipCreativeRequest,
  HostedGroupSponsorshipDraft,
} from "./group-sponsorship-contract";

const SPONSORSHIP_DIGEST_DOMAIN = "murph.group-sponsorship-configuration.v1";
const SPONSORSHIP_PRIVATE_CONTENT_SCOPE =
  "hosted-group-sponsorship-moment:private-content:v1";
const SPONSORSHIP_PRIVATE_CONTENT_PURPOSE =
  "hosted-group-sponsorship-moment-private-content";
const SPONSORSHIP_CREATIVE_REQUEST_SCHEMA =
  "murph.group-sponsorship-creative.v1";
const SPONSORSHIP_PUBLIC_ALIAS_SCHEMA =
  "murph.group-sponsorship-public-alias.v1";
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;
const HOSTED_GROUP_FUNDING_ONE_TIME_CONTRIBUTION_LIMIT = 20;
const HOSTED_GROUP_FUNDING_ANONYMOUS_NAME = "Anonymous";
const HOSTED_GROUP_FUNDING_LIVE_SPONSORSHIP_STATUSES = [
  HostedGroupSponsorshipAuthorizationStatus.active,
  HostedGroupSponsorshipAuthorizationStatus.paused,
  HostedGroupSponsorshipAuthorizationStatus.recovery_required,
] as const;
const CREATIVE_FORMATS = new Set<string>(
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS,
);

type SponsorshipPrisma = PrismaClient | Prisma.TransactionClient;

type EncryptedSponsorshipDraft = {
  creativeRequestEncrypted: string | null;
  creatorMemberId: string;
  prisma: SponsorshipPrisma;
  publicAliasEncrypted: string | null;
  purchaseId: string;
  runningBitRequestEncrypted: string | null;
  sponsorMessageEncrypted: string | null;
};

export interface HostedGroupSponsorshipMomentProjection
  extends HostedGroupSponsorshipDraft {
  celebrationScale: "small" | "medium" | "large";
  expiresAt: Date | null;
}

export interface HostedGroupRunningBitProjection {
  expiresAt: string;
  publicAlias: string | null;
  requestedBit: string;
  schema: "murph.group-sponsorship-bit.v1";
}

export interface HostedGroupFundingSupportersProjection {
  monthlySponsor: {
    id: string;
    name: string;
  } | null;
  oneTimeContributions: Array<{
    id: string;
    name: string;
  }>;
}

export function parseHostedGroupSponsorshipDraft(
  value: unknown,
): HostedGroupSponsorshipDraft | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSponsorshipError();
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "creativeRequest",
    "publicAlias",
    "publicAliasRecognition",
    "runningBitRequest",
    "sponsorMessage",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw invalidSponsorshipError();
  }
  const creativeRequest = parseHostedGroupSponsorshipCreativeRequest(
    record.creativeRequest,
  );
  const sponsorMessage = normalizeOptionalPlainText(
    record.sponsorMessage,
    HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS,
  );
  if (creativeRequest && sponsorMessage) {
    throw invalidSponsorshipError();
  }
  const publicAlias = normalizeOptionalPlainText(
    record.publicAlias,
    HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  );
  const publicAliasRecognition = parseHostedGroupFundingRecognitionConsent(
    record.publicAliasRecognition,
  );
  if (publicAliasRecognition && !publicAlias) {
    throw invalidSponsorshipError();
  }
  const draft: HostedGroupSponsorshipDraft = {
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias,
    ...(publicAliasRecognition ? { publicAliasRecognition } : {}),
    runningBitRequest: normalizeOptionalPlainText(
      record.runningBitRequest,
      HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
    ),
    sponsorMessage,
  };
  return draft.creativeRequest ||
      draft.publicAlias ||
      draft.runningBitRequest ||
      draft.sponsorMessage
    ? draft
    : null;
}

export function digestHostedGroupSponsorshipDraft(
  draft: HostedGroupSponsorshipDraft | null,
): string {
  return createHmac("sha256", readHostedAppSessionHmacKey())
    .update(SPONSORSHIP_DIGEST_DOMAIN, "utf8")
    .update("\0", "utf8")
    .update(JSON.stringify(draft), "utf8")
    .digest("base64url");
}

export async function hasHostedGroupSponsorshipCustomizationAuthority(input: {
  containerMemberId: string;
  now: Date;
  participantMemberId: string;
  prisma: SponsorshipPrisma;
}): Promise<boolean> {
  const container = await input.prisma.hostedThreadContainer.findFirst({
    select: { memberId: true },
    where: {
      memberId: input.containerMemberId,
      OR: [
        { ownerMemberId: input.participantMemberId },
        {
          participants: {
            some: {
              ...activeHostedThreadContainerParticipantWhere({ now: input.now }),
              participantMemberId: input.participantMemberId,
            },
          },
        },
      ],
    },
  });
  return container !== null;
}

export async function createHostedGroupSponsorshipMomentTx(input: {
  authorizedDraft: HostedGroupSponsorshipDraft | null;
  beneficiaryMemberId: string;
  creatorMemberId: string;
  offerCode: string;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (!isHostedGroupSponsorshipOfferCode(input.offerCode)) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SPONSORSHIP_OFFER_INVALID",
      httpStatus: 400,
      message: "Choose an available group sponsorship.",
    });
  }
  const policy = getHostedGroupSponsorshipExperiencePolicy(input.offerCode);
  if (
    input.authorizedDraft?.runningBitRequest &&
    policy.runningBitDurationMs === null
  ) {
    throw hostedOnboardingError({
      code: "HOSTED_GROUP_SPONSORSHIP_BIT_NOT_AVAILABLE",
      httpStatus: 400,
      message: "This sponsorship does not include a temporary running bit.",
    });
  }

  const authorizedDraft = canonicalizeModernHostedGroupSponsorshipDraft(
    input.authorizedDraft,
  );
  const creativeRequest = authorizedDraft?.creativeRequest ?? null;
  const creativeRequestPayload = creativeRequest
    ? serializeHostedGroupSponsorshipCreativeRequest(creativeRequest)
    : null;
  const publicAliasPayload = authorizedDraft?.publicAlias
    ? serializeStoredHostedGroupSponsorshipPublicAlias({
        publicAlias: authorizedDraft.publicAlias,
        publicAliasRecognition: authorizedDraft.publicAliasRecognition ?? null,
      })
    : null;
  const plaintextEntries = [
    ["public_alias_encrypted", publicAliasPayload],
    [
      "running_bit_request_encrypted",
      authorizedDraft?.runningBitRequest ?? null,
    ],
    ["creative_request_encrypted", creativeRequestPayload],
  ].filter((entry): entry is [string, string] => entry[1] !== null);
  const encryptedValues = await sealHostedUserSecureBoxStrings({
    entries: plaintextEntries.map(([field, value]) => ({
      aad: sponsorshipAad(input.purchaseId, field),
      scope: SPONSORSHIP_PRIVATE_CONTENT_SCOPE,
      value,
    })),
    lane: "hosted-member-private-field",
    prisma: input.tx,
    userId: input.creatorMemberId,
  });
  const encryptedByField = new Map(
    plaintextEntries.map(([field], index) => [field, encryptedValues[index]]),
  );
  const encryptedCreativeRequest =
    encryptedByField.get("creative_request_encrypted") ?? null;
  if (creativeRequestPayload !== null && encryptedCreativeRequest === null) {
    throw new Error("Group sponsorship creative request was not encrypted.");
  }

  await input.tx.hostedGroupSponsorshipMoment.create({
    data: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      configurationDigest: digestHostedGroupSponsorshipDraft(
        authorizedDraft,
      ),
      creativeRequestEncrypted: encryptedCreativeRequest,
      creatorMemberId: input.creatorMemberId,
      publicAliasEncrypted:
        encryptedByField.get("public_alias_encrypted") ?? null,
      purchaseId: input.purchaseId,
      runningBitRequestEncrypted:
        encryptedByField.get("running_bit_request_encrypted") ?? null,
      sponsorMessageEncrypted: null,
    },
  });
}

export async function assertHostedGroupSponsorshipRequestMatchesTx(input: {
  draft: HostedGroupSponsorshipDraft | null;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (await hostedGroupSponsorshipRequestMatchesTx(input)) {
    return;
  }
  throw hostedOnboardingError({
    code: "HOSTED_USAGE_CREDIT_REQUEST_KEY_CONFLICT",
    httpStatus: 409,
    message: "That request key was already used for another sponsorship.",
  });
}

export async function hostedGroupSponsorshipRequestMatchesTx(input: {
  draft: HostedGroupSponsorshipDraft | null;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<boolean> {
  const moment = await input.tx.hostedGroupSponsorshipMoment.findUnique({
    select: {
      configurationDigest: true,
      creativeRequestEncrypted: true,
    },
    where: { purchaseId: input.purchaseId },
  });
  if (!moment) {
    return false;
  }
  const actual = Buffer.from(
    moment?.configurationDigest ?? digestHostedGroupSponsorshipDraft(null),
    "utf8",
  );
  const expectedDrafts = moment.creativeRequestEncrypted === null
    ? [
        input.draft,
        canonicalizeModernHostedGroupSponsorshipDraft(input.draft),
      ]
    : [canonicalizeModernHostedGroupSponsorshipDraft(input.draft)];
  return expectedDrafts.some((draft) => {
    const expected = Buffer.from(
      digestHostedGroupSponsorshipDraft(draft),
      "utf8",
    );
    return expected.byteLength === actual.byteLength
      && timingSafeEqual(expected, actual);
  });
}

export async function activateHostedGroupSponsorshipMomentTx(input: {
  activatedAt: Date;
  customContentAuthorized: boolean;
  offerCode: string;
  purchaseId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (!isHostedGroupSponsorshipOfferCode(input.offerCode)) {
    return;
  }
  const current = await input.tx.hostedGroupSponsorshipMoment.findUnique({
    select: {
      activatedAt: true,
      publicAliasEncrypted: true,
      runningBitRequestEncrypted: true,
    },
    where: { purchaseId: input.purchaseId },
  });
  if (!current || current.activatedAt) {
    return;
  }
  const duration = getHostedGroupSponsorshipExperiencePolicy(
    input.offerCode,
  ).runningBitDurationMs;
  const expiresAt =
    input.customContentAuthorized &&
      current.runningBitRequestEncrypted &&
      duration !== null
      ? new Date(input.activatedAt.getTime() + duration)
      : null;
  await input.tx.hostedGroupSponsorshipMoment.updateMany({
    data: {
      activatedAt: input.activatedAt,
      expiresAt,
      fundingPageAliasPublishedAt:
        input.customContentAuthorized && current.publicAliasEncrypted
          ? input.activatedAt
          : null,
    },
    where: {
      activatedAt: null,
      purchaseId: input.purchaseId,
    },
  });
}

export async function readHostedGroupSponsorshipMomentForNotification(input: {
  customContentAuthorized: boolean;
  offerCode: string;
  purchaseId: string;
  prisma: SponsorshipPrisma;
}): Promise<HostedGroupSponsorshipMomentProjection | null> {
  if (!isHostedGroupSponsorshipOfferCode(input.offerCode)) {
    return null;
  }
  const row = await input.prisma.hostedGroupSponsorshipMoment.findUnique({
    where: { purchaseId: input.purchaseId },
  });
  if (!row) {
    return null;
  }
  const openedDraft = input.customContentAuthorized
    ? await openSponsorshipDraft({
        creativeRequestEncrypted: row.creativeRequestEncrypted,
        creatorMemberId: row.creatorMemberId,
        prisma: input.prisma,
        publicAliasEncrypted: row.publicAliasEncrypted,
        purchaseId: row.purchaseId,
        runningBitRequestEncrypted: row.runningBitRequestEncrypted,
        sponsorMessageEncrypted: row.sponsorMessageEncrypted,
      }, { invalidCreativeRequest: "omit" })
    : null;
  const draft = canonicalizeModernHostedGroupSponsorshipDraft(openedDraft);
  return {
    celebrationScale:
      getHostedGroupSponsorshipExperiencePolicy(input.offerCode).celebrationScale,
    ...(draft?.creativeRequest
      ? { creativeRequest: draft.creativeRequest }
      : {}),
    expiresAt: row.expiresAt,
    publicAlias: draft?.publicAlias ?? null,
    runningBitRequest: draft?.runningBitRequest ?? null,
    sponsorMessage: draft?.sponsorMessage ?? null,
  };
}

export async function readHostedGroupSponsorshipDraftForCreator(input: {
  creatorMemberId: string;
  prisma: SponsorshipPrisma;
  purchaseId: string;
}): Promise<HostedGroupSponsorshipDraft | null> {
  const row = await input.prisma.hostedGroupSponsorshipMoment.findFirst({
    where: {
      creatorMemberId: input.creatorMemberId,
      purchaseId: input.purchaseId,
    },
  });
  if (!row) {
    return null;
  }
  return await openSponsorshipDraft({
    creativeRequestEncrypted: row.creativeRequestEncrypted,
    creatorMemberId: row.creatorMemberId,
    prisma: input.prisma,
    publicAliasEncrypted: row.publicAliasEncrypted,
    purchaseId: row.purchaseId,
    runningBitRequestEncrypted: row.runningBitRequestEncrypted,
    sponsorMessageEncrypted: row.sponsorMessageEncrypted,
  });
}

export async function readHostedGroupFundingSupporters(input: {
  beneficiaryMemberId: string;
  prisma: SponsorshipPrisma;
  signal?: AbortSignal;
}): Promise<HostedGroupFundingSupportersProjection> {
  input.signal?.throwIfAborted();
  const [authorization, oneTimeContributions] = await Promise.all([
    input.prisma.hostedGroupSponsorshipAuthorization.findFirst({
      select: {
        id: true,
      },
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        status: {
          in: [...HOSTED_GROUP_FUNDING_LIVE_SPONSORSHIP_STATUSES],
        },
      },
    }),
    input.prisma.hostedUsageCreditPurchase.findMany({
      orderBy: [
        { paidAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
      },
      take: HOSTED_GROUP_FUNDING_ONE_TIME_CONTRIBUTION_LIMIT,
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        groupSponsorshipAuthorizationId: null,
        paidAt: { not: null },
        status: HostedUsageCreditPurchaseStatus.fulfilled,
      },
    }),
  ]);
  input.signal?.throwIfAborted();
  const monthlyActivation = authorization
    ? await input.prisma.hostedUsageCreditPurchase.findFirst({
        orderBy: [
          { paidAt: "desc" },
          { id: "desc" },
        ],
        select: { id: true },
        where: {
          groupSponsorshipAuthorizationId: authorization.id,
          groupSponsorshipChargeOrdinal: 0,
          status: HostedUsageCreditPurchaseStatus.fulfilled,
        },
      })
    : null;
  input.signal?.throwIfAborted();
  const purchaseIds = [
    ...(monthlyActivation ? [monthlyActivation.id] : []),
    ...oneTimeContributions.map((contribution) => contribution.id),
  ];
  const publicAliases = await readHostedGroupFundingPublicAliases({
    beneficiaryMemberId: input.beneficiaryMemberId,
    prisma: input.prisma,
    purchaseIds,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  return {
    monthlySponsor: authorization && monthlyActivation
      ? {
          id: monthlyActivation.id,
          name: publicAliases.get(monthlyActivation.id)
            ?? HOSTED_GROUP_FUNDING_ANONYMOUS_NAME,
        }
      : null,
    oneTimeContributions: oneTimeContributions.map((contribution) => ({
      id: contribution.id,
      name: publicAliases.get(contribution.id)
        ?? HOSTED_GROUP_FUNDING_ANONYMOUS_NAME,
    })),
  };
}

export async function readHostedActiveGroupRunningBit(input: {
  now: Date;
  prisma: SponsorshipPrisma;
  runtimeMemberId: string;
}): Promise<HostedGroupRunningBitProjection | null> {
  const row = await input.prisma.hostedGroupSponsorshipMoment.findFirst({
    orderBy: [{ activatedAt: "desc" }, { purchaseId: "desc" }],
    where: {
      activatedAt: { lte: input.now },
      beneficiaryMemberId: input.runtimeMemberId,
      expiresAt: { gt: input.now },
      purchase: { status: "fulfilled" },
      runningBitRequestEncrypted: { not: null },
    },
  });
  if (!row?.expiresAt) {
    return null;
  }
  const authorized = await hasHostedGroupSponsorshipCustomizationAuthority({
    containerMemberId: input.runtimeMemberId,
    now: input.now,
    participantMemberId: row.creatorMemberId,
    prisma: input.prisma,
  });
  if (!authorized) {
    return null;
  }
  try {
    const runningBit = await openSponsorshipRunningBit({
      creativeRequestEncrypted: row.creativeRequestEncrypted,
      creatorMemberId: row.creatorMemberId,
      prisma: input.prisma,
      publicAliasEncrypted: row.publicAliasEncrypted,
      purchaseId: row.purchaseId,
      runningBitRequestEncrypted: row.runningBitRequestEncrypted,
      sponsorMessageEncrypted: row.sponsorMessageEncrypted,
    });
    if (!runningBit?.runningBitRequest) {
      return null;
    }
    return {
      expiresAt: row.expiresAt.toISOString(),
      publicAlias: runningBit.publicAlias,
      requestedBit: runningBit.runningBitRequest,
      schema: "murph.group-sponsorship-bit.v1",
    };
  } catch {
    return null;
  }
}

function canonicalizeModernHostedGroupSponsorshipDraft(
  draft: HostedGroupSponsorshipDraft | null,
): HostedGroupSponsorshipDraft | null {
  if (!draft) {
    return null;
  }
  const creativeRequest = draft.creativeRequest ?? (draft.sponsorMessage
    ? {
        format: "message" as const,
        prompt: draft.sponsorMessage,
        styleRequest: null,
      }
    : null);
  const runningBitRequest = draft.runningBitRequest;
  const publicAliasRecognition =
    draft.publicAlias &&
      draft.publicAliasRecognition === HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT
      ? HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT
      : null;
  if (!creativeRequest && !runningBitRequest && !publicAliasRecognition) {
    return null;
  }
  return {
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias: draft.publicAlias,
    ...(publicAliasRecognition ? { publicAliasRecognition } : {}),
    runningBitRequest,
    sponsorMessage: null,
  };
}

function parseHostedGroupFundingRecognitionConsent(
  value: unknown,
): HostedGroupFundingRecognitionConsent | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value !== HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT) {
    throw invalidSponsorshipError();
  }
  return value;
}

function parseHostedGroupSponsorshipCreativeRequest(
  value: unknown,
): HostedGroupSponsorshipCreativeRequest | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidSponsorshipError();
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["format", "prompt", "styleRequest"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw invalidSponsorshipError();
  }
  const format = record.format;
  if (!isHostedGroupSponsorshipCreativeFormat(format)) {
    throw invalidSponsorshipError();
  }
  const prompt = normalizeOptionalPlainText(
    record.prompt,
    HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS,
  );
  const styleRequest = normalizeOptionalPlainText(
    record.styleRequest,
    HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS,
  );
  if (format !== "song" && styleRequest !== null) {
    throw invalidSponsorshipError();
  }
  return {
    format,
    prompt,
    styleRequest: format === "song" ? styleRequest : null,
  };
}

function isHostedGroupSponsorshipCreativeFormat(
  value: unknown,
): value is HostedGroupSponsorshipCreativeFormat {
  return typeof value === "string" && CREATIVE_FORMATS.has(value);
}

function normalizeOptionalPlainText(
  value: unknown,
  maxCodePoints: number,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw invalidSponsorshipError();
  }
  const normalized = value.replaceAll("\r\n", "\n").normalize("NFC").trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > maxCodePoints ||
    [...normalized].some((character) =>
      character !== "\n" && FORBIDDEN_TEXT.test(character)
    )
  ) {
    throw invalidSponsorshipError();
  }
  return normalized;
}

async function readHostedGroupFundingPublicAliases(input: {
  beneficiaryMemberId: string;
  prisma: SponsorshipPrisma;
  purchaseIds: readonly string[];
  signal?: AbortSignal;
}): Promise<Map<string, string>> {
  const purchaseIds = [...new Set(input.purchaseIds)];
  if (purchaseIds.length === 0) {
    return new Map();
  }

  try {
    const moments = await input.prisma.hostedGroupSponsorshipMoment.findMany({
      select: {
        creatorMemberId: true,
        publicAliasEncrypted: true,
        purchaseId: true,
      },
      where: {
        beneficiaryMemberId: input.beneficiaryMemberId,
        fundingPageAliasPublishedAt: { not: null },
        publicAliasEncrypted: { not: null },
        purchaseId: { in: purchaseIds },
      },
    });
    if (moments.length === 0) {
      return new Map();
    }
    const decryptedAliases = await openHostedUserSecureBoxStrings({
      entries: moments.map((moment) => ({
        aad: sponsorshipAad(moment.purchaseId, "public_alias_encrypted"),
        scope: SPONSORSHIP_PRIVATE_CONTENT_SCOPE,
        userId: moment.creatorMemberId,
        value: moment.publicAliasEncrypted,
      })),
      lane: "hosted-member-private-field",
      prisma: input.prisma,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const aliases = new Map<string, string>();
    for (const [index, moment] of moments.entries()) {
      try {
        const storedAlias = parseStoredHostedGroupSponsorshipPublicAlias(
          decryptedAliases[index],
        );
        if (
          storedAlias?.publicAliasRecognition ===
            HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT
        ) {
          aliases.set(moment.purchaseId, storedAlias.publicAlias);
        }
      } catch {
        // A malformed optional alias should not make the funding page fail.
      }
    }
    return aliases;
  } catch {
    input.signal?.throwIfAborted();
    // Public attribution is best effort. Funding remains available even when
    // an old encrypted alias can no longer be opened.
    return new Map();
  }
}

function serializeStoredHostedGroupSponsorshipPublicAlias(input: {
  publicAlias: string;
  publicAliasRecognition: HostedGroupFundingRecognitionConsent | null;
}): string {
  if (
    input.publicAliasRecognition !==
      HOSTED_GROUP_FUNDING_RECOGNITION_CONSENT
  ) {
    return input.publicAlias;
  }
  return JSON.stringify({
    publicAlias: input.publicAlias,
    recognition: input.publicAliasRecognition,
    schema: SPONSORSHIP_PUBLIC_ALIAS_SCHEMA,
  });
}

function parseStoredHostedGroupSponsorshipPublicAlias(
  value: string | null,
): {
  publicAlias: string;
  publicAliasRecognition: HostedGroupFundingRecognitionConsent | null;
} | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    parsed = null;
  }
  if (
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).schema ===
      SPONSORSHIP_PUBLIC_ALIAS_SCHEMA
  ) {
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (
      keys.length !== 3 ||
      keys[0] !== "publicAlias" ||
      keys[1] !== "recognition" ||
      keys[2] !== "schema"
    ) {
      throw invalidSponsorshipError();
    }
    const publicAlias = normalizeOptionalPlainText(
      record.publicAlias,
      HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
    );
    const publicAliasRecognition =
      parseHostedGroupFundingRecognitionConsent(record.recognition);
    if (!publicAlias || !publicAliasRecognition) {
      throw invalidSponsorshipError();
    }
    return { publicAlias, publicAliasRecognition };
  }
  const publicAlias = normalizeOptionalPlainText(
    value,
    HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  );
  return publicAlias
    ? { publicAlias, publicAliasRecognition: null }
    : null;
}

function serializeHostedGroupSponsorshipCreativeRequest(
  request: HostedGroupSponsorshipCreativeRequest,
): string {
  return JSON.stringify({
    request,
    schema: SPONSORSHIP_CREATIVE_REQUEST_SCHEMA,
  });
}

function parseStoredHostedGroupSponsorshipCreativeRequest(
  value: string | null,
): HostedGroupSponsorshipCreativeRequest | null {
  if (value === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidSponsorshipError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw invalidSponsorshipError();
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "request" ||
    keys[1] !== "schema" ||
    record.schema !== SPONSORSHIP_CREATIVE_REQUEST_SCHEMA
  ) {
    throw invalidSponsorshipError();
  }
  const request = parseHostedGroupSponsorshipCreativeRequest(record.request);
  if (!request) {
    throw invalidSponsorshipError();
  }
  return request;
}

async function openSponsorshipDraft(
  input: EncryptedSponsorshipDraft,
  options: { invalidCreativeRequest: "omit" | "reject" } = {
    invalidCreativeRequest: "reject",
  },
): Promise<HostedGroupSponsorshipDraft | null> {
  const hasEncryptedCreativeRequest =
    input.creativeRequestEncrypted !== null;
  const [
    publicAlias,
    sponsorMessage,
    runningBitRequest,
    creativeRequestPayload = null,
  ] = await openHostedUserSecureBoxStrings({
    entries: [
      sponsorshipOpenEntry(input, "public_alias_encrypted"),
      sponsorshipOpenEntry(input, "sponsor_message_encrypted"),
      sponsorshipOpenEntry(input, "running_bit_request_encrypted"),
      ...(hasEncryptedCreativeRequest
        ? [sponsorshipOpenEntry(input, "creative_request_encrypted")]
        : []),
    ],
    lane: "hosted-member-private-field",
    prisma: input.prisma,
  });
  const creativeRequest = options.invalidCreativeRequest === "omit"
    ? parseStoredHostedGroupSponsorshipCreativeRequestForNotification(
        creativeRequestPayload,
      )
    : parseStoredHostedGroupSponsorshipCreativeRequest(creativeRequestPayload);
  const storedPublicAlias = parseStoredHostedGroupSponsorshipPublicAlias(
    publicAlias,
  );
  return parseHostedGroupSponsorshipDraft({
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias: storedPublicAlias?.publicAlias ?? null,
    ...(storedPublicAlias?.publicAliasRecognition
      ? { publicAliasRecognition: storedPublicAlias.publicAliasRecognition }
      : {}),
    runningBitRequest,
    sponsorMessage,
  });
}

function parseStoredHostedGroupSponsorshipCreativeRequestForNotification(
  value: string | null,
): HostedGroupSponsorshipCreativeRequest | null {
  try {
    return parseStoredHostedGroupSponsorshipCreativeRequest(value);
  } catch (error) {
    if (
      isHostedOnboardingError(error) &&
      error.code === "HOSTED_GROUP_SPONSORSHIP_INVALID"
    ) {
      return null;
    }
    throw error;
  }
}

async function openSponsorshipRunningBit(
  input: EncryptedSponsorshipDraft,
): Promise<
  Pick<HostedGroupSponsorshipDraft, "publicAlias" | "runningBitRequest"> | null
> {
  const [publicAlias, runningBitRequest] =
    await openHostedUserSecureBoxStrings({
      entries: [
        sponsorshipOpenEntry(input, "public_alias_encrypted"),
        sponsorshipOpenEntry(input, "running_bit_request_encrypted"),
      ],
      lane: "hosted-member-private-field",
      prisma: input.prisma,
    });
  const storedPublicAlias = parseStoredHostedGroupSponsorshipPublicAlias(
    publicAlias,
  );
  const draft = parseHostedGroupSponsorshipDraft({
    publicAlias: storedPublicAlias?.publicAlias ?? null,
    ...(storedPublicAlias?.publicAliasRecognition
      ? { publicAliasRecognition: storedPublicAlias.publicAliasRecognition }
      : {}),
    runningBitRequest,
  });
  return draft
    ? {
        publicAlias: draft.publicAlias,
        runningBitRequest: draft.runningBitRequest,
      }
    : null;
}

function sponsorshipOpenEntry(
  input: EncryptedSponsorshipDraft,
  field:
    | "creative_request_encrypted"
    | "public_alias_encrypted"
    | "running_bit_request_encrypted"
    | "sponsor_message_encrypted",
) {
  const value = field === "creative_request_encrypted"
    ? input.creativeRequestEncrypted
    : field === "public_alias_encrypted"
      ? input.publicAliasEncrypted
      : field === "running_bit_request_encrypted"
        ? input.runningBitRequestEncrypted
        : input.sponsorMessageEncrypted;
  return {
    aad: sponsorshipAad(input.purchaseId, field),
    scope: SPONSORSHIP_PRIVATE_CONTENT_SCOPE,
    userId: input.creatorMemberId,
    value,
  };
}

function sponsorshipAad(purchaseId: string, field: string) {
  return {
    field,
    purpose: SPONSORSHIP_PRIVATE_CONTENT_PURPOSE,
    rowId: purchaseId,
    table: "hosted_group_sponsorship_moment",
  } as const;
}

function invalidSponsorshipError() {
  return hostedOnboardingError({
    code: "HOSTED_GROUP_SPONSORSHIP_INVALID",
    httpStatus: 400,
    message: "Sponsorship details must be short plain text.",
  });
}
