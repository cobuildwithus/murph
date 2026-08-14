import "server-only";

import { Buffer } from "node:buffer";

import type { Prisma, PrismaClient } from "@prisma/client";

import { getHostedWebCryptoConfig } from "../hosted-crypto/env";
import type { HostedGcpKmsClient } from "../hosted-crypto/gcp-kms";
import {
  openHostedUserSecureBoxStrings,
  sealHostedUserSecureBoxStrings,
} from "../hosted-crypto/secure-box";
import {
  hostedOnboardingError,
  isHostedOnboardingError,
} from "../hosted-onboarding/errors";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import { normalizePhoneNumber } from "../hosted-onboarding/phone";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
  type HostedOnboardingReadClient,
} from "../hosted-onboarding/shared";
import { assertHostedLaunchRequiredConsentGranted } from "../legal/consent";

export const HOSTED_ADDRESS_BOOK_SCHEMA_VERSION = 1;
export const HOSTED_ADDRESS_BOOK_MAX_CONTACTS = 1_000;
export const HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES = 16;
export const HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS = 2_000;
export const HOSTED_ADDRESS_BOOK_REPLACEMENT_BODY_MAX_BYTES = 192 * 1024;
export const HOSTED_ADDRESS_BOOK_DELETE_BODY_MAX_BYTES = 1024;

const HOSTED_ADDRESS_BOOK_NAME_MAX_CODE_POINTS = 48;
const HOSTED_ADDRESS_BOOK_NAME_MAX_BYTES = 96;
const HOSTED_ADDRESS_BOOK_NAME_SCOPE = "hosted-address-book-advisory-name:v1";
const HOSTED_ADDRESS_BOOK_NAME_FIELD = "advisory_name";
const HOSTED_ADDRESS_BOOK_MEMBER_SEED_DOMAIN = "murph.address-book.member-seed.v1";
const HOSTED_ADDRESS_BOOK_PHONE_TOKEN_DOMAIN = "murph.address-book.phone-token.v1";
const HOSTED_ADDRESS_BOOK_MAC_KEYRING_ENV =
  "HOSTED_CRYPTO_GCP_ADDRESS_BOOK_MAC_KEYRING_JSON";
const HOSTED_ADDRESS_BOOK_REPLACEMENT_GATE =
  "HOSTED_ADDRESS_BOOK_REPLACEMENT_ENABLED";
const HOSTED_ADDRESS_BOOK_ADVISORY_GATE =
  "HOSTED_ADDRESS_BOOK_ADVISORY_NAMES_ENABLED";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const KMS_KEY_VERSION_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/([1-9][0-9]*)$/u;
const ADVISORY_NAME_COMPONENT_PATTERN =
  /^[\p{L}\p{M}]+(?:[.'\u2019-][\p{L}\p{M}]+)*(?: [\p{L}\p{M}]\p{M}*\.)?$/u;
const ADVISORY_NAME_ALIAS_SEPARATOR = " / ";
const ADVISORY_NAME_ALIAS_LIMIT = 4;
const RELATIONSHIP_OR_ROLE_WORDS = new Set([
  "aunt",
  "boss",
  "brother",
  "coach",
  "dad",
  "daddy",
  "doctor",
  "dr",
  "father",
  "friend",
  "girlfriend",
  "grandma",
  "grandmother",
  "grandpa",
  "grandfather",
  "husband",
  "landlord",
  "lawyer",
  "manager",
  "mom",
  "mommy",
  "mother",
  "nurse",
  "partner",
  "roommate",
  "sister",
  "therapist",
  "uncle",
  "wife",
]);

type AddressBookMutationOperation = "delete" | "replace";
export type HostedAddressBookAdvisoryLookupOutcome =
  | "consent_unavailable"
  | "container_missing"
  | "disabled"
  | "matched"
  | "no_canonical_handles"
  | "no_contact_match"
  | "no_safe_unique_label"
  | "owner_suspended"
  | "projection_disabled";

export interface HostedOwnerAddressBookAdvisoryNamesResult {
  canonicalHandleCount: number;
  contactMatchCount: number;
  names: ReadonlyMap<string, string>;
  outcome: HostedAddressBookAdvisoryLookupOutcome;
  requestedHandleCount: number;
}

export interface HostedAddressBookStatus {
  enabled: boolean;
  lastReplacedAt: string | null;
  revision: number;
  schemaVersion: typeof HOSTED_ADDRESS_BOOK_SCHEMA_VERSION;
  storedContactCount: number;
  writeCapability: "disabled" | "enabled";
}

export interface HostedAddressBookReplaceRequest {
  baseRevision: number;
  contacts: Array<{
    advisoryName: string;
    phoneNumber: string;
  }>;
  mutationId: string;
  schemaVersion: typeof HOSTED_ADDRESS_BOOK_SCHEMA_VERSION;
}

export interface HostedAddressBookDeleteRequest {
  baseRevision: number;
  mutationId: string;
  schemaVersion: typeof HOSTED_ADDRESS_BOOK_SCHEMA_VERSION;
}

interface HostedAddressBookMacKeyring {
  currentVersion: number;
  keyVersionNames: ReadonlyMap<number, string>;
  readVersions: readonly number[];
}

interface HostedAddressBookCrypto {
  environment: string;
  keyring: HostedAddressBookMacKeyring;
  kms: HostedGcpKmsClient;
}

type HostedAddressBookPrismaClient = PrismaClient | Prisma.TransactionClient;

export function parseHostedAddressBookReplaceRequest(
  body: Record<string, unknown>,
): HostedAddressBookReplaceRequest {
  assertExactKeys(body, ["baseRevision", "contacts", "mutationId", "schemaVersion"]);
  assertSchemaVersion(body.schemaVersion);
  const contacts = requireArray(body.contacts, "Address-book contacts");
  if (contacts.length > HOSTED_ADDRESS_BOOK_MAX_CONTACTS) {
    throw invalidAddressBookRequest(
      `Address-book projections may contain at most ${HOSTED_ADDRESS_BOOK_MAX_CONTACTS} contacts.`,
    );
  }

  const byPhone = new Map<string, string>();
  for (const rawContact of contacts) {
    const record = requireObject(rawContact, "Address-book contact");
    assertExactKeys(record, ["advisoryName", "phoneNumber"]);
    const phoneNumber = requireCanonicalPhoneNumber(record.phoneNumber);
    const advisoryName = requireSafeAdvisoryName(record.advisoryName);
    const existingName = byPhone.get(phoneNumber);
    if (existingName && existingName !== advisoryName) {
      throw invalidAddressBookRequest(
        "A phone number cannot have conflicting advisory names.",
      );
    }
    byPhone.set(phoneNumber, advisoryName);
  }

  return {
    baseRevision: requireRevision(body.baseRevision),
    contacts: [...byPhone].map(([phoneNumber, advisoryName]) => ({
      advisoryName,
      phoneNumber,
    })),
    mutationId: requireMutationId(body.mutationId),
    schemaVersion: HOSTED_ADDRESS_BOOK_SCHEMA_VERSION,
  };
}

export function parseHostedAddressBookDeleteRequest(
  body: Record<string, unknown>,
): HostedAddressBookDeleteRequest {
  assertExactKeys(body, ["baseRevision", "mutationId", "schemaVersion"]);
  assertSchemaVersion(body.schemaVersion);
  return {
    baseRevision: requireRevision(body.baseRevision),
    mutationId: requireMutationId(body.mutationId),
    schemaVersion: HOSTED_ADDRESS_BOOK_SCHEMA_VERSION,
  };
}

export async function readHostedAddressBookStatus(input: {
  memberId: string;
  prisma: HostedAddressBookPrismaClient;
  source?: NodeJS.ProcessEnv;
}): Promise<HostedAddressBookStatus> {
  const projection = await input.prisma.hostedAddressBookProjection.findUnique({
    include: {
      _count: { select: { contacts: true } },
    },
    where: { memberId: input.memberId },
  });
  return projectAddressBookStatus({
    projection,
    replacementEnabled: isFeatureEnabled(
      input.source ?? process.env,
      HOSTED_ADDRESS_BOOK_REPLACEMENT_GATE,
    ),
  });
}

export async function replaceHostedAddressBookProjection(input: {
  crypto?: HostedAddressBookCrypto;
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  request: HostedAddressBookReplaceRequest;
  signal?: AbortSignal;
  source?: NodeJS.ProcessEnv;
}): Promise<HostedAddressBookStatus> {
  const source = input.source ?? process.env;
  if (!isFeatureEnabled(source, HOSTED_ADDRESS_BOOK_REPLACEMENT_GATE)) {
    throw hostedOnboardingError({
      code: "HOSTED_ADDRESS_BOOK_REPLACEMENT_DISABLED",
      httpStatus: 503,
      message: "Contact sharing is temporarily unavailable. Try again later.",
      retryable: true,
    });
  }

  const now = input.now ?? new Date();
  const crypto = input.crypto ?? readHostedAddressBookCrypto(source);
  const currentVersion = crypto.keyring.currentVersion;
  const phoneTokens = await deriveHostedAddressBookPhoneTokens({
    crypto,
    memberId: input.memberId,
    phoneNumbers: input.request.contacts.map((contact) => contact.phoneNumber),
    signal: input.signal,
    versions: [currentVersion],
  });
  const rows = input.request.contacts.map((contact, index) => {
    const phoneToken = phoneTokens.get(currentVersion)?.[index];
    if (!phoneToken) {
      throw new Error("Address-book phone-token derivation returned no token.");
    }
    return {
      advisoryName: contact.advisoryName,
      phoneToken,
      phoneTokenVersion: currentVersion,
    };
  });
  const encryptedNames = await sealHostedUserSecureBoxStrings({
    entries: rows.map((row) => ({
      aad: buildAddressBookAdvisoryNameAad({
        phoneToken: row.phoneToken,
        phoneTokenVersion: row.phoneTokenVersion,
      }),
      scope: HOSTED_ADDRESS_BOOK_NAME_SCOPE,
      value: row.advisoryName,
    })),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    signal: input.signal,
    userId: input.memberId,
  });
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await assertActiveHostedMemberAccessAllowed({
      memberId: input.memberId,
      prisma: tx,
    });
    await assertHostedLaunchRequiredConsentGranted({
      memberId: input.memberId,
      prisma: tx,
    });
    const existing = await tx.hostedAddressBookProjection.findUnique({
      where: { memberId: input.memberId },
    });
    const replay = resolveMutationReplay({
      existing,
      mutationId: input.request.mutationId,
      operation: "replace",
    });
    if (!replay && (existing?.revision ?? 0) !== input.request.baseRevision) {
      throw revisionConflict(existing?.revision ?? 0);
    }
    if (!replay && rows.length === 0) {
      throw invalidAddressBookRequest(
        "New address-book projections must contain at least one contact.",
      );
    }
    if (!replay) {
      const revision = input.request.baseRevision + 1;
      await tx.hostedAddressBookContact.deleteMany({
        where: { memberId: input.memberId },
      });
      await tx.hostedAddressBookProjection.upsert({
        create: {
          createdAt: now,
          disabledAt: null,
          enabled: true,
          lastMutationId: input.request.mutationId,
          lastMutationOperation: "replace",
          lastReplacedAt: now,
          memberId: input.memberId,
          revision,
          updatedAt: now,
        },
        update: {
          disabledAt: null,
          enabled: true,
          lastMutationId: input.request.mutationId,
          lastMutationOperation: "replace",
          lastReplacedAt: now,
          revision,
          updatedAt: now,
        },
        where: { memberId: input.memberId },
      });
      if (rows.length > 0) {
        await tx.hostedAddressBookContact.createMany({
          data: rows.map((row, index) => ({
            advisoryNameEncrypted: requireEncryptedName(encryptedNames[index]),
            memberId: input.memberId,
            phoneToken: row.phoneToken,
            phoneTokenVersion: row.phoneTokenVersion,
          })),
        });
      }
      await clearHostedOwnerPendingGroupEventContextTx({
        memberId: input.memberId,
        tx,
      });
    }
    return readHostedAddressBookStatus({
      memberId: input.memberId,
      prisma: tx,
      source,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function deleteHostedAddressBookProjection(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  request: HostedAddressBookDeleteRequest;
  source?: NodeJS.ProcessEnv;
}): Promise<HostedAddressBookStatus> {
  const now = input.now ?? new Date();
  const source = input.source ?? process.env;
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const existing = await tx.hostedAddressBookProjection.findUnique({
      where: { memberId: input.memberId },
    });
    const replay = resolveMutationReplay({
      existing,
      mutationId: input.request.mutationId,
      operation: "delete",
    });
    if (!replay && (existing?.revision ?? 0) !== input.request.baseRevision) {
      throw revisionConflict(existing?.revision ?? 0);
    }
    if (!replay) {
      const revision = input.request.baseRevision + 1;
      await tx.hostedAddressBookContact.deleteMany({
        where: { memberId: input.memberId },
      });
      await tx.hostedAddressBookProjection.upsert({
        create: {
          createdAt: now,
          disabledAt: now,
          enabled: false,
          lastMutationId: input.request.mutationId,
          lastMutationOperation: "delete",
          lastReplacedAt: null,
          memberId: input.memberId,
          revision,
          updatedAt: now,
        },
        update: {
          disabledAt: now,
          enabled: false,
          lastMutationId: input.request.mutationId,
          lastMutationOperation: "delete",
          revision,
          updatedAt: now,
        },
        where: { memberId: input.memberId },
      });
      await clearHostedOwnerPendingGroupEventContextTx({
        memberId: input.memberId,
        tx,
      });
    }
    return readHostedAddressBookStatus({
      memberId: input.memberId,
      prisma: tx,
      source,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function clearHostedOwnerPendingGroupEventContextTx(input: {
  memberId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  await input.tx.hostedThreadRoute.updateMany({
    data: {
      pendingGroupReactionContextEncrypted: null,
    },
    where: {
      container: {
        ownerMemberId: input.memberId,
      },
    },
  });
}

export async function readHostedOwnerAddressBookAdvisoryNames(input: {
  containerMemberId: string;
  crypto?: HostedAddressBookCrypto;
  phoneHandles: readonly string[];
  prisma: HostedOnboardingReadClient;
  source?: NodeJS.ProcessEnv;
}): Promise<HostedOwnerAddressBookAdvisoryNamesResult> {
  const source = input.source ?? process.env;
  const requestedHandleCount = Math.min(
    input.phoneHandles.length,
    HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
  );
  let canonicalHandleCount = 0;
  const finish = (
    outcome: HostedAddressBookAdvisoryLookupOutcome,
    names: ReadonlyMap<string, string> = new Map<string, string>(),
    contactMatchCount = 0,
  ): HostedOwnerAddressBookAdvisoryNamesResult => ({
    canonicalHandleCount,
    contactMatchCount: Math.min(
      contactMatchCount,
      HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES,
    ),
    names,
    outcome,
    requestedHandleCount,
  });

  if (!isFeatureEnabled(source, HOSTED_ADDRESS_BOOK_ADVISORY_GATE)) {
    return finish("disabled");
  }
  const phoneHandles = [...new Set(input.phoneHandles)]
    .filter((handle) => isCanonicalPhoneNumber(handle))
    .slice(0, HOSTED_ADDRESS_BOOK_LOOKUP_MAX_HANDLES);
  canonicalHandleCount = phoneHandles.length;
  if (phoneHandles.length === 0) {
    return finish("no_canonical_handles");
  }

  const signal = AbortSignal.timeout(HOSTED_ADDRESS_BOOK_LOOKUP_TIMEOUT_MS);
  const container = await input.prisma.hostedThreadContainer.findUnique({
    select: {
      owner: {
        select: { suspendedAt: true },
      },
      ownerMemberId: true,
    },
    where: { memberId: input.containerMemberId },
  });
  if (!container) {
    return finish("container_missing");
  }
  if (container.owner.suspendedAt !== null) {
    return finish("owner_suspended");
  }
  try {
    await assertHostedLaunchRequiredConsentGranted({
      memberId: container.ownerMemberId,
      prisma: input.prisma,
    });
  } catch (error) {
    if (
      isHostedOnboardingError(error) &&
      error.code === "HOSTED_CONSENT_REQUIRED"
    ) {
      return finish("consent_unavailable");
    }
    throw error;
  }

  const projection = await input.prisma.hostedAddressBookProjection.findUnique({
    select: { enabled: true },
    where: { memberId: container.ownerMemberId },
  });
  if (!projection?.enabled) {
    return finish("projection_disabled");
  }

  const crypto = input.crypto ?? readHostedAddressBookCrypto(source);
  const phoneTokens = await deriveHostedAddressBookPhoneTokens({
    crypto,
    memberId: container.ownerMemberId,
    phoneNumbers: phoneHandles,
    signal,
    versions: crypto.keyring.readVersions,
  });
  const tokenInputs = crypto.keyring.readVersions.flatMap((version) =>
    (phoneTokens.get(version) ?? []).map((phoneToken, index) => ({
      phoneNumber: phoneHandles[index],
      phoneToken,
      phoneTokenVersion: version,
    }))
  );
  const tokenInputByKey = new Map(tokenInputs.map((candidate) => [
    createTokenReference(candidate.phoneTokenVersion, candidate.phoneToken),
    candidate,
  ]));
  const rows = await input.prisma.hostedAddressBookContact.findMany({
    select: {
      advisoryNameEncrypted: true,
      phoneToken: true,
      phoneTokenVersion: true,
    },
    where: {
      memberId: container.ownerMemberId,
      OR: crypto.keyring.readVersions.map((phoneTokenVersion) => ({
        phoneToken: { in: phoneTokens.get(phoneTokenVersion) ?? [] },
        phoneTokenVersion,
      })),
    },
  });
  if (rows.length === 0) {
    return finish("no_contact_match");
  }

  const names = await openHostedUserSecureBoxStrings({
    entries: rows.map((row) => ({
      aad: buildAddressBookAdvisoryNameAad({
        phoneToken: row.phoneToken,
        phoneTokenVersion: row.phoneTokenVersion,
      }),
      scope: HOSTED_ADDRESS_BOOK_NAME_SCOPE,
      userId: container.ownerMemberId,
      value: row.advisoryNameEncrypted,
    })),
    lane: "hosted-member-private-field",
    prisma: input.prisma,
    signal,
  });
  const candidateNames = new Map<string, string>();
  rows.forEach((row, index) => {
    const candidate = tokenInputByKey.get(
      createTokenReference(row.phoneTokenVersion, row.phoneToken),
    );
    const name = names[index];
    if (candidate && name && requireSafeAdvisoryName(name) === name) {
      candidateNames.set(candidate.phoneNumber, name);
    }
  });

  const phonesByName = new Map<string, Set<string>>();
  for (const [phoneNumber, name] of candidateNames) {
    const phones = phonesByName.get(name) ?? new Set<string>();
    phones.add(phoneNumber);
    phonesByName.set(name, phones);
  }
  const namesByPhone = new Map(
    [...candidateNames].filter(([, name]) => phonesByName.get(name)?.size === 1),
  );
  return finish(
    namesByPhone.size === 0 ? "no_safe_unique_label" : "matched",
    namesByPhone,
    rows.length,
  );
}

function readHostedAddressBookCrypto(
  source: NodeJS.ProcessEnv,
): HostedAddressBookCrypto {
  const config = getHostedWebCryptoConfig(source);
  return {
    environment: config.env,
    keyring: parseHostedAddressBookMacKeyring(
      source[HOSTED_ADDRESS_BOOK_MAC_KEYRING_ENV],
    ),
    kms: config.gcpKms,
  };
}

export function parseHostedAddressBookMacKeyring(
  raw: unknown,
): HostedAddressBookMacKeyring {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    throw new TypeError(`${HOSTED_ADDRESS_BOOK_MAC_KEYRING_ENV} must be configured.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new TypeError(`${HOSTED_ADDRESS_BOOK_MAC_KEYRING_ENV} must be valid JSON.`);
  }
  const record = requirePlainObject(value, HOSTED_ADDRESS_BOOK_MAC_KEYRING_ENV);
  assertExactTypeKeys(record, ["currentVersion", "keyVersionNames", "readVersions"]);
  const currentVersion = requireTokenVersion(record.currentVersion);
  const readVersions = requireTypeArray(
    record.readVersions,
    "Address-book MAC readVersions",
  )
    .map(requireTokenVersion);
  if (
    readVersions.length < 1
    || readVersions.length > 2
    || new Set(readVersions).size !== readVersions.length
    || !readVersions.includes(currentVersion)
  ) {
    throw new TypeError(
      "Address-book MAC readVersions must contain the current version and at most one prior version.",
    );
  }
  const keyVersionRecord = requirePlainObject(
    record.keyVersionNames,
    "Address-book MAC keyVersionNames",
  );
  const expectedKeys = [...new Set(readVersions)].map(String).sort();
  if (
    Object.keys(keyVersionRecord).sort().join("\u0000")
    !== expectedKeys.join("\u0000")
  ) {
    throw new TypeError(
      "Address-book MAC keyVersionNames must contain exactly the read versions.",
    );
  }
  const keyVersionNames = new Map<number, string>();
  for (const version of readVersions) {
    const keyVersionName = keyVersionRecord[String(version)];
    if (typeof keyVersionName !== "string") {
      throw new TypeError(
        "Address-book MAC keys must be full matching Cloud KMS CryptoKeyVersion names.",
      );
    }
    const match = KMS_KEY_VERSION_PATTERN.exec(keyVersionName);
    if (!match || Number(match[1]) !== version) {
      throw new TypeError(
        "Address-book MAC keys must be full matching Cloud KMS CryptoKeyVersion names.",
      );
    }
    keyVersionNames.set(version, keyVersionName);
  }
  return { currentVersion, keyVersionNames, readVersions };
}

async function deriveHostedAddressBookPhoneTokens(input: {
  crypto: HostedAddressBookCrypto;
  memberId: string;
  phoneNumbers: readonly string[];
  signal?: AbortSignal;
  versions: readonly number[];
}): Promise<ReadonlyMap<number, string[]>> {
  const result = new Map<number, string[]>();
  for (const version of input.versions) {
    input.signal?.throwIfAborted();
    const keyVersionName = input.crypto.keyring.keyVersionNames.get(version);
    if (!keyVersionName) {
      throw new Error("Address-book MAC key version is unavailable.");
    }
    const memberSeedInput = utf8([
      HOSTED_ADDRESS_BOOK_MEMBER_SEED_DOMAIN,
      input.crypto.environment,
      String(version),
      input.memberId,
    ].join("\u0000"));
    let memberSeed: Uint8Array | null = null;
    let memberSeedBuffer: ArrayBuffer | null = null;
    try {
      memberSeed = (await input.crypto.kms.macSign({
        data: memberSeedInput,
        keyVersionName,
        signal: input.signal,
      })).mac;
      memberSeedBuffer = toArrayBuffer(memberSeed);
      const hmacKey = await crypto.subtle.importKey(
        "raw",
        memberSeedBuffer,
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign"],
      );
      result.set(version, await Promise.all(input.phoneNumbers.map(async (phoneNumber) => {
        const phoneTokenInput = utf8(
          `${HOSTED_ADDRESS_BOOK_PHONE_TOKEN_DOMAIN}\u0000${phoneNumber}`,
        );
        const phoneTokenInputBuffer = toArrayBuffer(phoneTokenInput);
        let token: Uint8Array | null = null;
        try {
          token = new Uint8Array(await crypto.subtle.sign(
            "HMAC",
            hmacKey,
            phoneTokenInputBuffer,
          ));
          return Buffer.from(token).toString("base64url");
        } finally {
          phoneTokenInput.fill(0);
          new Uint8Array(phoneTokenInputBuffer).fill(0);
          token?.fill(0);
        }
      })));
    } finally {
      memberSeedInput.fill(0);
      memberSeed?.fill(0);
      if (memberSeedBuffer) {
        new Uint8Array(memberSeedBuffer).fill(0);
      }
    }
  }
  return result;
}

function projectAddressBookStatus(input: {
  projection: {
    _count: { contacts: number };
    enabled: boolean;
    lastReplacedAt: Date | null;
    revision: number;
  } | null;
  replacementEnabled: boolean;
}): HostedAddressBookStatus {
  const enabled = input.projection?.enabled ?? false;
  return {
    enabled,
    lastReplacedAt: input.projection?.lastReplacedAt?.toISOString() ?? null,
    revision: input.projection?.revision ?? 0,
    schemaVersion: HOSTED_ADDRESS_BOOK_SCHEMA_VERSION,
    storedContactCount: enabled ? input.projection?._count.contacts ?? 0 : 0,
    writeCapability: input.replacementEnabled ? "enabled" : "disabled",
  };
}

function resolveMutationReplay(input: {
  existing: {
    lastMutationId: string;
    lastMutationOperation: string;
  } | null;
  mutationId: string;
  operation: AddressBookMutationOperation;
}): boolean {
  if (input.existing?.lastMutationId !== input.mutationId) {
    return false;
  }
  if (input.existing.lastMutationOperation !== input.operation) {
    throw hostedOnboardingError({
      code: "HOSTED_ADDRESS_BOOK_MUTATION_ID_CONFLICT",
      httpStatus: 409,
      message: "This contact-sharing change identifier was already used.",
    });
  }
  return true;
}

function revisionConflict(currentRevision: number) {
  return hostedOnboardingError({
    code: "HOSTED_ADDRESS_BOOK_REVISION_CONFLICT",
    details: { currentRevision },
    httpStatus: 409,
    message: "Contact sharing changed elsewhere. Refresh before trying again.",
  });
}

function buildAddressBookAdvisoryNameAad(input: {
  phoneToken: string;
  phoneTokenVersion: number;
}) {
  return {
    field: HOSTED_ADDRESS_BOOK_NAME_FIELD,
    purpose: "hosted-address-book-advisory-name",
    rowId: createTokenReference(input.phoneTokenVersion, input.phoneToken),
    table: "hosted_address_book_contact",
  } as const;
}

function createTokenReference(version: number, token: string): string {
  return `${version}:${token}`;
}

function requireCanonicalPhoneNumber(value: unknown): string {
  if (typeof value !== "string" || !isCanonicalPhoneNumber(value)) {
    throw invalidAddressBookRequest(
      "Contact phone numbers must be canonical international numbers.",
    );
  }
  return value;
}

function isCanonicalPhoneNumber(value: string): boolean {
  return value.startsWith("+") && normalizePhoneNumber(value) === value;
}

function requireSafeAdvisoryName(value: unknown): string {
  if (typeof value !== "string") {
    throw invalidAddressBookRequest("Contact advisory names are invalid.");
  }
  const normalized = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  const codePoints = [...normalized];
  if (
    normalized.length === 0
    || codePoints.length > HOSTED_ADDRESS_BOOK_NAME_MAX_CODE_POINTS
    || Buffer.byteLength(normalized, "utf8") > HOSTED_ADDRESS_BOOK_NAME_MAX_BYTES
    || /(?:https?:|www\.|@)/iu.test(normalized)
  ) {
    throw invalidAddressBookRequest("Contact advisory names are invalid.");
  }
  const words = normalized
    .toLocaleLowerCase("en-US")
    .split(/[ /.'\u2019-]+/u)
    .filter(Boolean);
  if (words.some((word) => RELATIONSHIP_OR_ROLE_WORDS.has(word))) {
    throw invalidAddressBookRequest(
      "Contact advisory names cannot contain relationships or roles.",
    );
  }
  const advisoryNames = normalized.split(ADVISORY_NAME_ALIAS_SEPARATOR);
  const distinctAdvisoryNames = new Set(
    advisoryNames.map((name) => name.toLocaleLowerCase("en-US")),
  );
  if (
    advisoryNames.length > ADVISORY_NAME_ALIAS_LIMIT
    || distinctAdvisoryNames.size !== advisoryNames.length
    || advisoryNames.some((name) => !ADVISORY_NAME_COMPONENT_PATTERN.test(name))
  ) {
    throw invalidAddressBookRequest("Contact advisory names are invalid.");
  }
  return normalized;
}

function assertSchemaVersion(value: unknown): void {
  if (value !== HOSTED_ADDRESS_BOOK_SCHEMA_VERSION) {
    throw invalidAddressBookRequest("Address-book schema version is unsupported.");
  }
}

function requireRevision(value: unknown): number {
  if (
    !Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > 2_147_483_646
  ) {
    throw invalidAddressBookRequest("Address-book revision is invalid.");
  }
  return Number(value);
}

function requireMutationId(value: unknown): string {
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw invalidAddressBookRequest("Address-book mutation ID must be a canonical UUIDv4.");
  }
  return value;
}

function requireTokenVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new TypeError("Address-book MAC token version is invalid.");
  }
  return Number(value);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidAddressBookRequest(`${label} must be an array.`);
  }
  return value;
}

function requireTypeArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value;
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidAddressBookRequest(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requirePlainObject(value: unknown, label: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (Object.keys(record).sort().join("\u0000") !== [...expected].sort().join("\u0000")) {
    throw invalidAddressBookRequest("Address-book request fields are invalid.");
  }
}

function assertExactTypeKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  if (Object.keys(record).sort().join("\u0000") !== [...expected].sort().join("\u0000")) {
    throw new TypeError("Address-book MAC keyring fields are invalid.");
  }
}

function requireEncryptedName(value: string | undefined): string {
  if (!value) {
    throw new Error("Address-book advisory-name encryption returned no value.");
  }
  return value;
}

function invalidAddressBookRequest(message: string) {
  return hostedOnboardingError({
    code: "HOSTED_ADDRESS_BOOK_REQUEST_INVALID",
    httpStatus: 400,
    message,
  });
}

function isFeatureEnabled(source: NodeJS.ProcessEnv, name: string): boolean {
  return source[name]?.trim() === "1";
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(
    value.byteOffset,
    value.byteOffset + value.byteLength,
  ) as ArrayBuffer;
}
