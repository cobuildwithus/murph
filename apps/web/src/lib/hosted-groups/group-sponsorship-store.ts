import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxStrings,
} from "../hosted-crypto/secure-box";
import { readHostedAppSessionHmacKey } from "../hosted-onboarding/app-session-config";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  activeHostedThreadContainerParticipantWhere,
} from "./thread-container-participant-access";
import {
  getHostedGroupSponsorshipExperiencePolicy,
  isHostedGroupSponsorshipOfferCode,
} from "./group-sponsorship-policy";

const SPONSORSHIP_DIGEST_DOMAIN = "murph.group-sponsorship-configuration.v1";
const SPONSORSHIP_PRIVATE_CONTENT_SCOPE =
  "hosted-group-sponsorship-moment:private-content:v1";
const SPONSORSHIP_PRIVATE_CONTENT_PURPOSE =
  "hosted-group-sponsorship-moment-private-content";
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;

export const HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS = 80;
export const HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS = 280;
export const HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS = 240;

type SponsorshipPrisma = PrismaClient | Prisma.TransactionClient;

export interface HostedGroupSponsorshipDraft {
  publicAlias: string | null;
  runningBitRequest: string | null;
  sponsorMessage: string | null;
}

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
    "publicAlias",
    "runningBitRequest",
    "sponsorMessage",
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) {
    throw invalidSponsorshipError();
  }
  const draft = {
    publicAlias: normalizeOptionalPlainText(
      record.publicAlias,
      HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
    ),
    runningBitRequest: normalizeOptionalPlainText(
      record.runningBitRequest,
      HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
    ),
    sponsorMessage: normalizeOptionalPlainText(
      record.sponsorMessage,
      HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS,
    ),
  };
  return draft.publicAlias || draft.runningBitRequest || draft.sponsorMessage
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

  const plaintextEntries = [
    ["public_alias_encrypted", input.authorizedDraft?.publicAlias ?? null],
    ["sponsor_message_encrypted", input.authorizedDraft?.sponsorMessage ?? null],
    [
      "running_bit_request_encrypted",
      input.authorizedDraft?.runningBitRequest ?? null,
    ],
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

  await input.tx.hostedGroupSponsorshipMoment.create({
    data: {
      beneficiaryMemberId: input.beneficiaryMemberId,
      configurationDigest: digestHostedGroupSponsorshipDraft(
        input.authorizedDraft,
      ),
      creatorMemberId: input.creatorMemberId,
      publicAliasEncrypted:
        encryptedByField.get("public_alias_encrypted") ?? null,
      purchaseId: input.purchaseId,
      runningBitRequestEncrypted:
        encryptedByField.get("running_bit_request_encrypted") ?? null,
      sponsorMessageEncrypted:
        encryptedByField.get("sponsor_message_encrypted") ?? null,
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
    select: { configurationDigest: true },
    where: { purchaseId: input.purchaseId },
  });
  const expected = Buffer.from(
    digestHostedGroupSponsorshipDraft(input.draft),
    "utf8",
  );
  const actual = Buffer.from(
    moment?.configurationDigest ?? digestHostedGroupSponsorshipDraft(null),
    "utf8",
  );
  return expected.byteLength === actual.byteLength
    && timingSafeEqual(expected, actual);
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
  const draft = input.customContentAuthorized
    ? await openSponsorshipDraft({
        creatorMemberId: row.creatorMemberId,
        prisma: input.prisma,
        publicAliasEncrypted: row.publicAliasEncrypted,
        purchaseId: row.purchaseId,
        runningBitRequestEncrypted: row.runningBitRequestEncrypted,
        sponsorMessageEncrypted: row.sponsorMessageEncrypted,
      })
    : null;
  return {
    celebrationScale:
      getHostedGroupSponsorshipExperiencePolicy(input.offerCode).celebrationScale,
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
    creatorMemberId: row.creatorMemberId,
    prisma: input.prisma,
    publicAliasEncrypted: row.publicAliasEncrypted,
    purchaseId: row.purchaseId,
    runningBitRequestEncrypted: row.runningBitRequestEncrypted,
    sponsorMessageEncrypted: row.sponsorMessageEncrypted,
  });
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
    const draft = await openSponsorshipDraft({
      creatorMemberId: row.creatorMemberId,
      prisma: input.prisma,
      publicAliasEncrypted: row.publicAliasEncrypted,
      purchaseId: row.purchaseId,
      runningBitRequestEncrypted: row.runningBitRequestEncrypted,
      sponsorMessageEncrypted: row.sponsorMessageEncrypted,
    });
    if (!draft?.runningBitRequest) {
      return null;
    }
    return {
      expiresAt: row.expiresAt.toISOString(),
      publicAlias: draft.publicAlias,
      requestedBit: draft.runningBitRequest,
      schema: "murph.group-sponsorship-bit.v1",
    };
  } catch {
    return null;
  }
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

async function openSponsorshipDraft(input: {
  creatorMemberId: string;
  prisma: SponsorshipPrisma;
  publicAliasEncrypted: string | null;
  purchaseId: string;
  runningBitRequestEncrypted: string | null;
  sponsorMessageEncrypted: string | null;
}): Promise<HostedGroupSponsorshipDraft | null> {
  const [publicAlias, sponsorMessage, runningBitRequest] =
    await openHostedUserSecureBoxStrings({
      entries: [
        sponsorshipOpenEntry(input, "public_alias_encrypted"),
        sponsorshipOpenEntry(input, "sponsor_message_encrypted"),
        sponsorshipOpenEntry(input, "running_bit_request_encrypted"),
      ],
      lane: "hosted-member-private-field",
      prisma: input.prisma,
    });
  return parseHostedGroupSponsorshipDraft({
    publicAlias,
    runningBitRequest,
    sponsorMessage,
  });
}

function sponsorshipOpenEntry(
  input: Parameters<typeof openSponsorshipDraft>[0],
  field:
    | "public_alias_encrypted"
    | "running_bit_request_encrypted"
    | "sponsor_message_encrypted",
) {
  const value = field === "public_alias_encrypted"
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
