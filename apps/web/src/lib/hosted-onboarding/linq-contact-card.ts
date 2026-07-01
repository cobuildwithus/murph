import type { Prisma, PrismaClient } from "@prisma/client";

import { fetchLinqApi, LinqApiTimeoutError } from "../linq/api";
import {
  createHostedPhoneLookupKey,
} from "./contact-privacy";
import { hostedOnboardingError } from "./errors";
import {
  syncHostedLinqConfiguredLinesTx,
} from "./linq-line-store";
import { normalizePhoneNumber } from "./phone";
import {
  getHostedOnboardingEnvironment,
  requireHostedOnboardingLinqConfig,
} from "./runtime";
import { normalizeNullableString } from "./shared";

const HOSTED_LINQ_CONTACT_CARD_CRON_LINE_LIMIT = 50;
const MURPH_CONTACT_CARD_FIRST_NAME = "Murph";
const MURPH_CONTACT_CARD_DEFAULT_IMAGE_URL =
  "https://www.withmurph.ai/murph_headshot.png";
const MURPH_CONTACT_CARD_IMAGE_PATH = "/murph_headshot.png";
const LINQ_CONTACT_CARD_IMAGE_CDN_HOST = "cdn.linqapp.com";

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
  });
  const murphImageUrl = getMurphContactCardImageUrl();

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
      imageUrl: murphImageUrl,
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
}): Promise<Array<{
  phoneNumber: string;
  providerStatus: string | null;
}>> {
  const environment = getHostedOnboardingEnvironment();
  const maxLines = normalizeLineLimit(input.maxLines);
  const phoneNumbers = uniqueNormalizedPhoneNumbers(
    environment.linqConversationPhoneNumbers,
  ).slice(0, maxLines);
  const lineInputs = phoneNumbers
    .map((phoneNumber) => ({
      phoneNumber,
      phoneNumberLookupKey: createHostedPhoneLookupKey(phoneNumber),
    }))
    .filter((line): line is {
      phoneNumber: string;
      phoneNumberLookupKey: string;
    } => typeof line.phoneNumberLookupKey === "string" && line.phoneNumberLookupKey.length > 0);

  if (lineInputs.length === 0) {
    return [];
  }

  await syncHostedLinqConfiguredLinesTx({
    activeMemberLimit: environment.linqMaxActiveMembersPerConversationPhone,
    observedAt: input.observedAt,
    phoneNumbers: lineInputs.map((line) => line.phoneNumber),
    prisma: input.prisma,
  });

  const rows = await input.prisma.hostedLinqLine.findMany({
    where: {
      phoneNumberLookupKey: {
        in: lineInputs.map((line) => line.phoneNumberLookupKey),
      },
    },
    select: {
      phoneNumberLookupKey: true,
      providerStatus: true,
    },
    take: maxLines,
  });
  const providerStatusByLookupKey = new Map(
    rows.map((row) => [row.phoneNumberLookupKey, row.providerStatus]),
  );

  return lineInputs.map((line) => ({
    phoneNumber: line.phoneNumber,
    providerStatus: providerStatusByLookupKey.get(line.phoneNumberLookupKey) ?? null,
  }));
}

async function reconcileHostedLinqContactCardForLine(input: {
  existingCard: HostedLinqContactCard | null;
  imageUrl: string | null;
  phoneNumber: string;
  signal?: AbortSignal;
}): Promise<HostedLinqContactCardOutcome> {
  if (!input.existingCard) {
    const created = await setupHostedLinqContactCard({
      firstName: MURPH_CONTACT_CARD_FIRST_NAME,
      imageUrl: input.imageUrl,
      phoneNumber: input.phoneNumber,
      signal: input.signal,
    });
    return created.isActive ? "createdCards" : "inactiveCards";
  }

  if (isCurrentMurphContactCard(input.existingCard, input.imageUrl)) {
    return input.existingCard.isActive ? "activeCards" : "inactiveCards";
  }

  const updated = await updateHostedLinqContactCard({
    firstName: MURPH_CONTACT_CARD_FIRST_NAME,
    imageUrl: input.imageUrl,
    phoneNumber: input.phoneNumber,
    signal: input.signal,
  });
  return updated.isActive ? "updatedCards" : "inactiveCards";
}

function isCurrentMurphContactCard(
  card: HostedLinqContactCard,
  imageUrl: string | null,
): boolean {
  if (card.firstName !== MURPH_CONTACT_CARD_FIRST_NAME || (card.lastName ?? "") !== "") {
    return false;
  }

  if (!imageUrl) {
    return true;
  }

  // Linq rewrites accepted contact-card images to its own CDN URL.
  return card.imageUrl === imageUrl || isHostedLinqContactCardImageUrl(card.imageUrl);
}

function isHostedLinqContactCardImageUrl(value: string | null): boolean {
  const imageUrl = normalizeNullableString(value);
  if (!imageUrl) {
    return false;
  }

  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:"
      && url.hostname === LINQ_CONTACT_CARD_IMAGE_CDN_HOST
      && url.search === ""
      && url.pathname.includes("/contact-card/")
      && /\/image-[^/]+\.png$/i.test(url.pathname);
  } catch {
    return false;
  }
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
}): Record<string, string> {
  const firstName = normalizeNullableString(input.firstName);
  const imageUrl = normalizeNullableString(input.imageUrl);
  const lastName = normalizeNullableString(input.lastName);
  const phoneNumber = normalizeNullableString(input.phoneNumber);

  return {
    ...(firstName ? { first_name: firstName } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
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

function uniqueNormalizedPhoneNumbers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const phoneNumbers: string[] = [];

  for (const value of values) {
    const phoneNumber = normalizePhoneNumber(value);
    if (!phoneNumber || seen.has(phoneNumber)) {
      continue;
    }

    seen.add(phoneNumber);
    phoneNumbers.push(phoneNumber);
  }

  return phoneNumbers;
}
