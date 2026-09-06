import "server-only";

import {
  listHostedLinqContactCardLines,
  type HostedLinqContactCardLine,
} from "@/src/lib/hosted-onboarding/linq-line-store";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import { getPrisma } from "@/src/lib/prisma";

const CONVERSATION_PHONE_NUMBERS_ENV =
  "HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS";
// Same placeholder the homepage hero uses when no line is configured, so
// local and preview environments still render a working Messages link.
export const PUBLIC_MURPH_LINE_FALLBACK_PHONE_NUMBER = "+15555550100";
const PUBLIC_MURPH_LINE_CANDIDATE_LIMIT = 50;
const PUBLIC_MURPH_LINE_CACHE_TTL_MS = 5 * 60 * 1_000;
const PUBLIC_MURPH_LINE_FAILURE_TTL_MS = 60 * 1_000;
const PUBLIC_MURPH_LINE_LOOKUP_TIMEOUT_MS = 1_500;

export function readConfiguredMurphConversationPhoneNumbers(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  return (env[CONVERSATION_PHONE_NUMBERS_ENV] ?? "")
    .split(",")
    .map((value) => normalizePhoneNumber(value.trim()))
    .filter((value): value is string => Boolean(value));
}

/**
 * Chooses the Murph line to advertise on public pages: a configured
 * conversation number the Linq table confirms is healthy, then any healthy
 * configured line, then any healthy line, then the configured list as-is.
 */
export function selectPublicMurphLinePhoneNumber(input: {
  configuredConversationPhoneNumbers: readonly string[];
  lines: readonly HostedLinqContactCardLine[];
}): string | null {
  const healthy = input.lines.filter(isPubliclyAdvertisable);
  const verified = input.configuredConversationPhoneNumbers.find((number) =>
    healthy.some((line) => line.phoneNumber === number)
  );
  if (verified) {
    return verified;
  }

  const line = healthy.find((candidate) => candidate.isConfigured) ?? healthy[0];
  return line?.phoneNumber ?? input.configuredConversationPhoneNumbers[0] ?? null;
}

function isPubliclyAdvertisable(line: HostedLinqContactCardLine): boolean {
  return line.providerReputationStatus !== "AT_RISK"
    && line.providerReputationStatus !== "CRITICAL"
    && line.providerServiceStatus !== "FLAGGED";
}

let cached: { expiresAt: number; phoneNumber: string } | null = null;
let inFlight: Promise<string> | null = null;

/**
 * The Murph number anonymous visitors text from public goal pages. Reads the
 * Linq line table server-side, caches the answer briefly, and never throws:
 * a slow or unavailable database falls back to the configured list.
 */
export async function resolvePublicMurphLinePhoneNumber(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.phoneNumber;
  }
  if (inFlight) {
    return inFlight;
  }

  inFlight = lookupPublicMurphLinePhoneNumber()
    .then(({ ok, phoneNumber }) => {
      cached = {
        expiresAt: Date.now()
          + (ok ? PUBLIC_MURPH_LINE_CACHE_TTL_MS : PUBLIC_MURPH_LINE_FAILURE_TTL_MS),
        phoneNumber,
      };
      return phoneNumber;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function lookupPublicMurphLinePhoneNumber(): Promise<{
  ok: boolean;
  phoneNumber: string;
}> {
  const configured = readConfiguredMurphConversationPhoneNumbers();
  const fallback = configured[0] ?? PUBLIC_MURPH_LINE_FALLBACK_PHONE_NUMBER;

  try {
    const lines = await withTimeout(
      listHostedLinqContactCardLines({
        limit: PUBLIC_MURPH_LINE_CANDIDATE_LIMIT,
        prisma: getPrisma(),
      }),
      PUBLIC_MURPH_LINE_LOOKUP_TIMEOUT_MS,
    );
    return {
      ok: true,
      phoneNumber: selectPublicMurphLinePhoneNumber({
        configuredConversationPhoneNumbers: configured,
        lines,
      }) ?? fallback,
    };
  } catch {
    return { ok: false, phoneNumber: fallback };
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Public Murph line lookup timed out.")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
