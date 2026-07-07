import "server-only";

import type { Prisma, PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import { hostedOnboardingError } from "./errors";
import { listHostedLinqContactCardLines } from "./linq-line-store";
import {
  HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
  syncHostedLinqPhoneNumberInventory,
} from "./linq-phone-number-inventory";
import { normalizePhoneNumber } from "./phone";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingLinqConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_CONTACT_CARD_CRON_LINE_LIMIT = 50;
const MURPH_CONTACT_CARD_FIRST_NAME = "Murph";
const MURPH_CONTACT_CARD_DEFAULT_ORIGIN = "https://www.withmurph.ai";
const MURPH_CONTACT_CARD_DEFAULT_IMAGE_URL =
  "https://www.withmurph.ai/murph_headshot.png";
const MURPH_CONTACT_CARD_IMAGE_PATH = "/murph_headshot.png";

export type HostedLinqContactCard = {
  firstName: string;
  imageUrl: string | null;
  isActive: boolean;
  lastName: string | null;
  phoneNumber: string;
};

export type HostedLinqContactCardReconciliation = {
  activeCards: number;
  atRiskLines: number;
  createdCards: number;
  criticalLines: number;
  inactiveCards: number;
  lineCount: number;
  updatedCards: number;
};

type HostedLinqContactCardClient = PrismaClient | Prisma.TransactionClient;

type LinqContactCardResponse = {
  first_name?: string | null;
  image_url?: string | null;
  is_active?: boolean | null;
  last_name?: string | null;
  phone_number?: string | null;
};

type LinqContactCardsResponse = {
  contact_cards?: LinqContactCardResponse[] | null;
};

export async function reconcileHostedLinqContactCards(input: {
  maxLines?: number;
  observedAt?: Date;
  prisma: HostedLinqContactCardClient;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardReconciliation> {
  const observedAt = input.observedAt ?? new Date();
  const lines = await listHostedLinqConfiguredContactCardLines({
    maxLines: input.maxLines,
    observedAt,
    prisma: input.prisma,
    signal: input.signal,
  });
  const result: HostedLinqContactCardReconciliation = {
    activeCards: 0,
    atRiskLines: 0,
    createdCards: 0,
    criticalLines: 0,
    inactiveCards: 0,
    lineCount: lines.length,
    updatedCards: 0,
  };

  for (const line of lines) {
    if (line.providerStatus === "AT_RISK") {
      result.atRiskLines += 1;
    }
    if (line.providerStatus === "CRITICAL") {
      result.criticalLines += 1;
    }

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
  }

  return result;
}

export async function listHostedLinqContactCards(input: {
  phoneNumber?: string | null;
  signal?: AbortSignal;
} = {}): Promise<HostedLinqContactCard[]> {
  const phoneNumber = normalizePhoneNumber(input.phoneNumber);
  const payload = await fetchHostedLinqJson<LinqContactCardsResponse | LinqContactCardResponse>({
    method: "GET",
    operation: "contact card list",
    path: phoneNumber
      ? `contact_card?phone_number=${encodeURIComponent(phoneNumber)}`
      : "contact_card",
    signal: input.signal,
    timeoutMessage: "Linq contact card list timed out.",
  });

  const values = Array.isArray((payload as LinqContactCardsResponse | null)?.contact_cards)
    ? (payload as LinqContactCardsResponse).contact_cards ?? []
    : payload
      ? [payload as LinqContactCardResponse]
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
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const payload = await fetchHostedLinqJson<LinqContactCardResponse>({
    body: buildHostedLinqContactCardBody({
      firstName: input.firstName ?? MURPH_CONTACT_CARD_FIRST_NAME,
      imageUrl: input.imageUrl,
      lastName: input.lastName,
      phoneNumber: input.phoneNumber,
    }),
    method: "POST",
    operation: "contact card setup",
    path: "contact_card",
    signal: input.signal,
    timeoutMessage: "Linq contact card setup timed out.",
  });

  return requireHostedLinqContactCard(payload, "setup");
}

export async function updateHostedLinqContactCard(input: {
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCard> {
  const phoneNumber = requireNonEmptyText(input.phoneNumber, "phone number");
  const payload = await fetchHostedLinqJson<LinqContactCardResponse>({
    body: buildHostedLinqContactCardBody({
      firstName: input.firstName ?? MURPH_CONTACT_CARD_FIRST_NAME,
      imageUrl: input.imageUrl,
      lastName: input.lastName,
    }),
    method: "PATCH",
    operation: "contact card update",
    path: `contact_card?phone_number=${encodeURIComponent(phoneNumber)}`,
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
  signal?: AbortSignal;
}): Promise<Array<{
  phoneNumber: string;
  providerStatus: string | null;
}>> {
  const maxLines = normalizeLineLimit(input.maxLines);

  await syncHostedLinqPhoneNumberInventory({
    maxLines: HOSTED_LINQ_PHONE_NUMBER_INVENTORY_SYNC_LIMIT,
    observedAt: input.observedAt,
    prisma: input.prisma,
    signal: input.signal,
  });

  const lines = await listHostedLinqContactCardLines({
    limit: maxLines,
    prisma: input.prisma,
  });
  return lines.map((line) => ({
    phoneNumber: line.phoneNumber,
    providerStatus: line.providerStatus,
  }));
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
    imageUrl: null,
    phoneNumber: input.phoneNumber,
    signal: input.signal,
  });
  return updated.isActive ? "updatedCards" : "inactiveCards";
}

function isCurrentMurphContactCard(card: HostedLinqContactCard): boolean {
  if (card.firstName !== MURPH_CONTACT_CARD_FIRST_NAME || (card.lastName ?? "") !== "") {
    return false;
  }

  return card.imageUrl === null;
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

async function fetchHostedLinqJson<T>(input: {
  body?: Record<string, unknown>;
  method: "GET" | "PATCH" | "POST";
  operation: string;
  path: string;
  signal?: AbortSignal;
  timeoutMessage: string;
}): Promise<T | null> {
  const response = await fetchHostedLinqResponse(input);
  const text = await response.text();

  if (text.trim().length === 0) {
    return null;
  }

  return JSON.parse(text) as T;
}

async function fetchHostedLinqResponse(input: {
  body?: Record<string, unknown>;
  method: "GET" | "PATCH" | "POST";
  operation: string;
  path: string;
  signal?: AbortSignal;
  timeoutMessage: string;
}): Promise<Response> {
  const { apiBaseUrl, apiToken } = requireHostedOnboardingLinqConfig();

  let response: Response;
  try {
    response = await fetchLinqApi({
      apiBaseUrl,
      apiToken,
      ...(input.body ? { body: JSON.stringify(input.body) } : {}),
      method: input.method,
      path: input.path,
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof LinqApiTimeoutError) {
      throw hostedOnboardingError({
        code: "LINQ_REQUEST_TIMED_OUT",
        message: input.timeoutMessage,
        httpStatus: 502,
        retryable: true,
      });
    }

    throw error;
  }

  if (!response.ok) {
    throw hostedOnboardingError({
      code: "LINQ_REQUEST_FAILED",
      message: `Linq ${input.operation} failed with HTTP ${response.status}.`,
      httpStatus: 502,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return response;
}

function buildHostedLinqContactCardBody(input: {
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  phoneNumber?: string | null;
}): Record<string, string | null> {
  const firstName = normalizeNullableString(input.firstName);
  const imageUrl = input.imageUrl === null ? null : normalizeNullableString(input.imageUrl);
  const lastName = normalizeNullableString(input.lastName);
  const phoneNumber = normalizeNullableString(input.phoneNumber);

  return {
    ...(firstName ? { first_name: firstName } : {}),
    ...(input.imageUrl === null ? { image_url: null } : imageUrl ? { image_url: imageUrl } : {}),
    ...(lastName ? { last_name: lastName } : {}),
    ...(phoneNumber ? { phone_number: phoneNumber } : {}),
  };
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
    isActive: record.is_active === true,
    lastName: normalizeNullableString(record.last_name),
    phoneNumber,
  };
}

function requireHostedLinqContactCard(
  value: LinqContactCardResponse | null,
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
    return HOSTED_LINQ_CONTACT_CARD_CRON_LINE_LIMIT;
  }

  return Math.min(value, HOSTED_LINQ_CONTACT_CARD_CRON_LINE_LIMIT);
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
 * the vCard's `backup` slot. Reuses the contact-card cron's line listing so
 * health comes from the synced `hostedLinqLine` provider status; lines the
 * provider marks AT_RISK/CRITICAL are skipped. Fails soft to null.
 */
export async function resolveMurphHostedLinqContactCardBackupPhoneNumber(input: {
  excludePhoneNumber: string;
  prisma: HostedLinqContactCardClient;
}): Promise<string | null> {
  const excludePhoneNumber = normalizePhoneNumber(input.excludePhoneNumber);
  try {
    const lines = await listHostedLinqConfiguredContactCardLines({
      observedAt: new Date(),
      prisma: input.prisma,
    });
    return lines.find((line) =>
      line.phoneNumber !== excludePhoneNumber
      && line.providerStatus !== "AT_RISK"
      && line.providerStatus !== "CRITICAL"
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
 * returns null so the card ships without a photo instead of failing the
 * share. Defaults to the canonical headshot; pass `imageUrl` to embed a
 * different member-chosen avatar asset.
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
      signal: input.signal ?? AbortSignal.timeout(MURPH_CONTACT_CARD_VCF_PHOTO_FETCH_TIMEOUT_MS),
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
