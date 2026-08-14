import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";
import type { LinqAPIV3 } from "@linqapp/sdk";
import type {
  ContactCardCreateParams,
  ContactCardUpdateParams,
} from "@linqapp/sdk/resources/contact-card";

import {
  LinqApiTimeoutError,
  readLinqApiErrorStatus,
  runLinqApiRequest,
} from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { readHostedLinqContactCardCandidacySnapshot } from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingLinqConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_CONTACT_CARD_LINE_LIMIT = 50;
const MURPH_CONTACT_CARD_FIRST_NAME = "Murph";
const MURPH_CONTACT_CARD_DEFAULT_ORIGIN = "https://www.withmurph.ai";
const MURPH_CONTACT_CARD_DEFAULT_IMAGE_URL =
  "https://www.withmurph.ai/murph_headshot.png";
const MURPH_CONTACT_CARD_IMAGE_PATH = "/murph_headshot.png";

export type HostedLinqContactCard = {
  firstName: string;
  imageUrl: string | null;
  imageUrlPresent: boolean;
  isActive: boolean;
  lastName: string | null;
  phoneNumber: string;
};

export type HostedLinqContactCardReconciliation = {
  activeCards: number;
  atRiskLines: number;
  createdCards: number;
  criticalLines: number;
  failedLines: number;
  inactiveCards: number;
  lineCount: number;
  updatedCards: number;
};

type HostedLinqContactCardClient = PrismaClient | Prisma.TransactionClient;

export async function reconcileHostedLinqContactCards(input: {
  maxLines?: number;
  observedAt?: Date;
  prisma: HostedLinqContactCardClient;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardReconciliation> {
  const observedAt = input.observedAt ?? new Date();

  // One repeatable-read snapshot of candidacy plus the configured-line total,
  // so an overlapping authoritative inventory statement cannot be observed
  // half-applied and no second read can disagree with the first.
  const { configuredLineCount, lines } = await listHostedLinqConfiguredContactCardLines({
    maxLines: input.maxLines,
    observedAt,
    prisma: input.prisma,
  });

  // Configured lines are the only ones that can own a member conversation.
  // Their health is judged on its own, never satisfied by an unrelated
  // provider-only row, and checked before any provider request so no call is
  // made for a number the account no longer owns.
  const configuredLines = lines.filter((line) => line.isConfigured);
  if (configuredLineCount > 0 && configuredLines.length === 0) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
      message: `Linq contact-card reconciliation found ${configuredLineCount} configured line(s) but none with a fresh validated inventory confirmation.`,
      httpStatus: 502,
      retryable: true,
    });
  }

  const result: HostedLinqContactCardReconciliation = {
    activeCards: 0,
    atRiskLines: 0,
    createdCards: 0,
    criticalLines: 0,
    failedLines: 0,
    inactiveCards: 0,
    lineCount: lines.length,
    updatedCards: 0,
  };

  const usableActiveLineKeys = new Set<string>();
  for (const line of lines) {
    if (line.providerReputationStatus === "AT_RISK") {
      result.atRiskLines += 1;
    }
    if (line.providerReputationStatus === "CRITICAL") {
      result.criticalLines += 1;
    }

    // One failing line must not stop contact-card upkeep for the rest of the
    // pool; count it, log it, and keep going.
    try {
      const existingCard = await getHostedLinqContactCard({
        phoneNumber: line.phoneNumber,
        signal: input.signal,
      });
      const outcome = await reconcileHostedLinqContactCardForLine({
        existingCard,
        phoneNumber: line.phoneNumber,
        signal: input.signal,
      });
      result[outcome] += 1;
      if (outcome !== "inactiveCards") {
        usableActiveLineKeys.add(line.phoneNumberLookupKey);
      }
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
      result.failedLines += 1;
      console.error("Hosted Linq contact-card line reconcile failed.", {
        errorMessage: error instanceof Error ? error.message : String(error),
        phoneNumberHint: line.phoneNumberHint,
      });
    }
  }

  // Per-line isolation covers a partially degraded pool; a run that ends
  // with zero usable active cards — every line failed or produced an
  // inactive card — leaves the native contact-card share with nothing to
  // send, so it must fail the cron and reach the scheduler and alerting
  // instead of reporting a silent success. Configured lines are judged
  // separately, so an active provider-only card can never stand in for the
  // loss of every line that can actually own a member conversation.
  const usableConfiguredCards = configuredLines.filter(
    (line) => usableActiveLineKeys.has(line.phoneNumberLookupKey),
  ).length;
  if (configuredLines.length > 0 && usableConfiguredCards === 0) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
      message: `Linq contact-card reconciliation produced no usable active contact card across ${configuredLines.length} configured line(s) (${result.failedLines} failed, ${result.inactiveCards} inactive overall).`,
      httpStatus: 502,
      retryable: true,
    });
  }

  const usableActiveCards =
    result.activeCards + result.createdCards + result.updatedCards;
  if (result.lineCount > 0 && usableActiveCards === 0) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RECONCILE_FAILED",
      message: `Linq contact-card reconciliation produced no usable active contact card across ${result.lineCount} line(s) (${result.failedLines} failed, ${result.inactiveCards} inactive).`,
      httpStatus: 502,
      retryable: true,
    });
  }

  return result;
}

export async function listHostedLinqContactCards(input: {
  phoneNumber?: string | null;
  signal?: AbortSignal;
} = {}): Promise<HostedLinqContactCard[]> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const payload: unknown = await requestHostedLinqContactCardSdkOrThrow({
    operation: "contact card list",
    request: (client) => client.contactCard.retrieve(
      phoneNumber ? { phone_number: phoneNumber } : {},
      { signal: input.signal },
    ),
    signal: input.signal,
    timeoutMessage: "Linq contact card list timed out.",
  });

  const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  const values: unknown[] = Array.isArray(payloadRecord?.contact_cards)
    ? payloadRecord.contact_cards
    : payloadRecord
      ? [payloadRecord]
      : [];

  return values
    .map(parseHostedLinqContactCard)
    .filter((value): value is HostedLinqContactCard => value !== null);
}

export async function getHostedLinqContactCard(input: {
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard | null> {
  const [card] = await listHostedLinqContactCards({
    phoneNumber: input.phoneNumber,
    signal: input.signal,
  });
  return card ?? null;
}

export async function setupHostedLinqContactCard(input: {
  firstName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const body: ContactCardCreateParams = {
    first_name: requireNonEmptyText(
      input.firstName ?? MURPH_CONTACT_CARD_FIRST_NAME,
      "contact card first name",
    ),
    phone_number: requireNonEmptyText(input.phoneNumber, "phone number"),
  };
  const payload = await requestHostedLinqContactCardSdkOrThrow({
    operation: "contact card setup",
    request: (client) => client.contactCard.create(body, { signal: input.signal }),
    signal: input.signal,
    timeoutMessage: "Linq contact card setup timed out.",
  });

  return requireHostedLinqContactCard(payload, "setup");
}

export async function updateHostedLinqContactCard(input: {
  firstName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const params: ContactCardUpdateParams = {
    first_name: requireNonEmptyText(
      input.firstName ?? MURPH_CONTACT_CARD_FIRST_NAME,
      "contact card first name",
    ),
    phone_number: requireNonEmptyText(input.phoneNumber, "phone number"),
  };
  const payload = await requestHostedLinqContactCardSdkOrThrow({
    operation: "contact card update",
    request: (client) => client.contactCard.update(params, { signal: input.signal }),
    signal: input.signal,
    timeoutMessage: "Linq contact card update timed out.",
  });

  return requireHostedLinqContactCard(payload, "update");
}
type HostedLinqContactCardOutcome =
  | "activeCards"
  | "createdCards"
  | "inactiveCards"
  | "updatedCards";

async function listHostedLinqConfiguredContactCardLines(input: {
  maxLines?: number;
  observedAt: Date;
  prisma: HostedLinqContactCardClient;
}): Promise<{
  configuredLineCount: number;
  lines: Array<{
    isConfigured: boolean;
    phoneNumber: string;
    phoneNumberHint: string;
    phoneNumberLookupKey: string;
    providerReputationStatus: string | null;
  }>;
}> {
  const maxLines = normalizeLineLimit(input.maxLines);

  // Provider inventory refresh has exactly one scheduled owner: the
  // five-minute health cron. Reconciliation reads that projection instead of
  // issuing a second minute-zero inventory fetch, so two crons can never
  // apply provider snapshots out of order and publish a relinquished line
  // into a member's saved vCard.
  const snapshot = await readHostedLinqContactCardCandidacySnapshot({
    limit: maxLines,
    observedAt: input.observedAt,
    prisma: input.prisma,
  });
  return {
    configuredLineCount: snapshot.configuredLineCount,
    lines: snapshot.lines.map((line) => ({
      isConfigured: line.isConfigured,
      phoneNumber: line.phoneNumber,
      phoneNumberHint: line.phoneNumberHint,
      phoneNumberLookupKey: line.phoneNumberLookupKey,
      providerReputationStatus: line.providerReputationStatus,
    })),
  };
}

async function reconcileHostedLinqContactCardForLine(input: {
  existingCard: HostedLinqContactCard | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardOutcome> {
  if (!input.existingCard) {
    const created = await setupHostedLinqContactCard({
      firstName: MURPH_CONTACT_CARD_FIRST_NAME,
      phoneNumber: input.phoneNumber,
      signal: input.signal,
    });
    return created.isActive ? "createdCards" : "inactiveCards";
  }

  if (isCurrentMurphContactCard(input.existingCard)) {
    return input.existingCard.isActive ? "activeCards" : "inactiveCards";
  }

  const updated = await updateHostedLinqContactCard({
    firstName: MURPH_CONTACT_CARD_FIRST_NAME,
    phoneNumber: input.phoneNumber,
    signal: input.signal,
  });
  return updated.isActive ? "updatedCards" : "inactiveCards";
}

function isCurrentMurphContactCard(card: HostedLinqContactCard): boolean {
  return card.firstName === MURPH_CONTACT_CARD_FIRST_NAME;
}

/**
 * Absolute URL for one of our own public contact-card avatar assets. Anchored
 * to the operator-configured public base URL (canonical production host as
 * the fallback), never to request-derived origins, so a hostile Host header
 * can not steer the server-side photo fetch.
 */
export function resolveMurphContactCardAssetUrl(assetPath: string): string {
  const publicBaseUrl = getHostedOnboardingEnvironment().publicBaseUrl
    ?? MURPH_CONTACT_CARD_DEFAULT_ORIGIN;
  return new URL(assetPath, `${publicBaseUrl}/`).toString();
}

function getMurphContactCardImageUrl(): string | null {
  const publicBaseUrl = getHostedOnboardingEnvironment().publicBaseUrl;
  if (!publicBaseUrl) {
    return MURPH_CONTACT_CARD_DEFAULT_IMAGE_URL;
  }

  const url = new URL(MURPH_CONTACT_CARD_IMAGE_PATH, `${publicBaseUrl}/`);
  return url.protocol === "https:" ? url.toString() : MURPH_CONTACT_CARD_DEFAULT_IMAGE_URL;
}

async function requestHostedLinqContactCardSdkOrThrow<T>(input: {
  operation: string;
  request: (client: LinqAPIV3) => Promise<T>;
  signal?: AbortSignal;
  timeoutMessage: string;
}): Promise<T> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();
  try {
    return await runLinqApiRequest({
      apiBaseUrl,
      apiToken,
      request: input.request,
      signal: input.signal,
      timeoutMessage: input.timeoutMessage,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_REQUEST_TIMED_OUT",
        message: input.timeoutMessage,
        httpStatus: 502,
        retryable: true,
      });
    }
    const status = readLinqApiErrorStatus(error);
    if (status !== null) {
      throw hostedOnboardingError({
        cause: error,
        code: "LINQ_REQUEST_FAILED",
        message: `Linq ${input.operation} failed with HTTP ${status}.`,
        httpStatus: 502,
        retryable: status === 429 || status >= 500,
      });
    }
    throw error;
  }
}

function parseHostedLinqContactCard(value: unknown): HostedLinqContactCard | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const firstName = normalizeNullableString(record.first_name);
  const phoneNumber = normalizeNullableString(record.phone_number);

  if (!firstName || !phoneNumber) {
    return null;
  }

  return {
    firstName,
    imageUrl: normalizeNullableString(record.image_url),
    imageUrlPresent: "image_url" in record,
    isActive: record.is_active === true,
    lastName: normalizeNullableString(record.last_name),
    phoneNumber,
  };
}

function requireHostedLinqContactCard(
  value: unknown,
  operation: "setup" | "update",
): HostedLinqContactCard {
  const card = parseHostedLinqContactCard(value);
  if (!card) {
    throw hostedOnboardingError({
      code: "LINQ_CONTACT_CARD_RESPONSE_INVALID",
      message: `Linq contact card ${operation} returned an invalid response.`,
      httpStatus: 502,
      retryable: true,
    });
  }

  return card;
}

function requireNonEmptyText(value: unknown, label: string): string {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    throw new TypeError(`Linq ${label} must be a non-empty string.`);
  }

  return normalized;
}

function normalizeLineLimit(value: number | null | undefined): number {
  if (!Number.isInteger(value) || value === undefined || value === null || value < 1) {
    return HOSTED_LINQ_CONTACT_CARD_LINE_LIMIT;
  }

  return Math.min(value, HOSTED_LINQ_CONTACT_CARD_LINE_LIMIT);
}

const MURPH_CONTACT_CARD_VCF_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const MURPH_CONTACT_CARD_VCF_PHOTO_FETCH_TIMEOUT_MS = 5_000;
const MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS = 75;

export const MURPH_CONTACT_CARD_VCF_FILE_NAME = "Murph.vcf";
export const MURPH_CONTACT_CARD_VCF_CONTENT_TYPE = "text/vcard";

export type MurphHostedLinqContactCardVcfPhoto = {
  base64: string;
  type: "JPEG" | "PNG";
};

/**
 * vCard 3.0 with CRLF line endings and 75-char folding so iMessage renders it
 * as a native tappable contact bubble rather than a generic file. The chat's
 * own line is the `mobile` number; a second healthy pool line, when
 * available, rides along under a `backup` label so members keep a way to
 * reach Murph if the primary line degrades.
 */
export function buildMurphHostedLinqContactCardVcf(input: {
  backupPhoneNumber?: string | null;
  phoneNumber: string;
  photo?: MurphHostedLinqContactCardVcfPhoto | null;
}): string {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  if (!phoneNumber) {
    throw new TypeError("Murph contact-card vCard requires a line phone number.");
  }
  const backupPhoneNumber = normalizePhoneNumber(input.backupPhoneNumber ?? null);

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:;${MURPH_CONTACT_CARD_FIRST_NAME};;;`,
    `FN:${MURPH_CONTACT_CARD_FIRST_NAME}`,
    `TEL;TYPE=CELL:${phoneNumber}`,
    ...(backupPhoneNumber && backupPhoneNumber !== phoneNumber
      ? [
          `item1.TEL:${backupPhoneNumber}`,
          "item1.X-ABLabel:backup",
        ]
      : []),
    ...(input.photo
      ? [`PHOTO;ENCODING=b;TYPE=${input.photo.type}:${input.photo.base64}`]
      : []),
    "END:VCARD",
  ];

  return lines.map(foldMurphContactCardVcfLine).join("\r\n") + "\r\n";
}

/**
 * Second healthy configured conversation line (excluding the chat's own) for
 * the vCard's `backup` slot. Reads the independent provider service and
 * reputation projection; FLAGGED, AT_RISK, and CRITICAL lines are skipped.
 * Fails soft to null.
 */
export async function resolveMurphHostedLinqContactCardBackupPhoneNumber(input: {
  excludePhoneNumber: string;
  prisma: HostedLinqContactCardClient;
}): Promise<string | null> {
  const excludePhoneNumber = normalizePhoneNumber(input.excludePhoneNumber);
  try {
    // Same repeatable-read snapshot the reconciler uses, so the two-query read
    // cannot straddle a committing ownership move and return a just-revoked
    // line for a member's saved vCard.
    const snapshot = await readHostedLinqContactCardCandidacySnapshot({
      limit: HOSTED_LINQ_CONTACT_CARD_LINE_LIMIT,
      prisma: input.prisma,
    });
    const { lines } = snapshot;
    return lines.find((line) =>
      line.phoneNumber !== excludePhoneNumber
      && line.providerServiceStatus !== "FLAGGED"
      && line.providerReputationStatus !== "AT_RISK"
      && line.providerReputationStatus !== "CRITICAL"
    )?.phoneNumber ?? null;
  } catch {
    return null;
  }
}

function foldMurphContactCardVcfLine(line: string): string {
  if (line.length <= MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS) {
    return line;
  }
  const folded: string[] = [line.slice(0, MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS)];
  for (
    let index = MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS;
    index < line.length;
    index += MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS - 1
  ) {
    folded.push(` ${line.slice(index, index + MURPH_CONTACT_CARD_VCF_LINE_MAX_CHARS - 1)}`);
  }
  return folded.join("\r\n");
}

/**
 * Best-effort fetch of a Murph contact-card photo for embedding; any failure
 * returns null. Canonical callers may continue without a photo; personalized
 * callers can require it and fail before send. Defaults to the canonical
 * headshot; pass `imageUrl` to embed a different member-chosen avatar asset.
 */
export async function fetchMurphHostedLinqContactCardVcfPhoto(input: {
  fetchImpl?: typeof fetch;
  imageUrl?: string | null;
  signal?: AbortSignal;
} = {}): Promise<MurphHostedLinqContactCardVcfPhoto | null> {
  const imageUrl = input.imageUrl ?? getMurphContactCardImageUrl();
  if (!imageUrl) {
    return null;
  }

  try {
    const fetchImpl = input.fetchImpl ?? fetch;
    const response = await fetchImpl(imageUrl, {
      // Own-asset fetch only; a redirect means the asset boundary was crossed.
      redirect: "error",
      signal: input.signal
        ? AbortSignal.any([
            input.signal,
            AbortSignal.timeout(MURPH_CONTACT_CARD_VCF_PHOTO_FETCH_TIMEOUT_MS),
          ])
        : AbortSignal.timeout(MURPH_CONTACT_CARD_VCF_PHOTO_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return null;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const type = contentType.includes("png")
      ? "PNG" as const
      : contentType.includes("jpeg") || contentType.includes("jpg")
        ? "JPEG" as const
        : imageUrl.toLowerCase().endsWith(".png")
          ? "PNG" as const
          : null;
    if (!type) {
      return null;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MURPH_CONTACT_CARD_VCF_PHOTO_MAX_BYTES) {
      return null;
    }
    return {
      base64: Buffer.from(bytes).toString("base64"),
      type,
    };
  } catch {
    return null;
  }
}
