import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

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
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_FORMATS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_PROMPT_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_CREATIVE_STYLE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_MESSAGE_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
  HOSTED_GROUP_SPONSORSHIP_RUNNING_BIT_MAX_CODE_POINTS,
  type HostedGroupSponsorshipCreativeFormat,
  type HostedGroupSponsorshipCreativeRequest,
  type HostedGroupSponsorshipDraft,
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
const FORBIDDEN_TEXT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}]/u;
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
  const draft: HostedGroupSponsorshipDraft = {
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias: normalizeOptionalPlainText(
      record.publicAlias,
      HOSTED_GROUP_SPONSORSHIP_PUBLIC_ALIAS_MAX_CODE_POINTS,
    ),
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
  const plaintextEntries = [
    ["public_alias_encrypted", authorizedDraft?.publicAlias ?? null],
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
  if (!creativeRequest && !runningBitRequest) {
    return null;
  }
  return {
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias: draft.publicAlias,
    runningBitRequest,
    sponsorMessage: null,
  };
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
  return parseHostedGroupSponsorshipDraft({
    ...(creativeRequest ? { creativeRequest } : {}),
    publicAlias,
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
  const draft = parseHostedGroupSponsorshipDraft({
    publicAlias,
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
