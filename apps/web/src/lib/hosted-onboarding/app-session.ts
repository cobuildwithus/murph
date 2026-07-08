import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { type Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { cache } from "react";

import {
  normalizeComputerHandoffViewportSize,
  type ComputerHandoffViewportSize,
} from "../computer-use/viewport";
import { getPrisma } from "../prisma";
import {
  assertActiveHostedMemberAccessAllowed,
} from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";

export interface HostedAppSession {
  computerHandoffViewportSize: ComputerHandoffViewportSize | null;
  expiresAt: Date;
  member: HostedMemberCoreState;
  privyUserId: string;
  sessionId: string;
}

const HOSTED_APP_SESSION_COOKIE_NAME_PRODUCTION = "__Host-murph-session";
const HOSTED_APP_SESSION_COOKIE_NAME_DEVELOPMENT = "murph-session";
const HOSTED_APP_SESSION_TOKEN_PREFIX = "murph_session_";
const HOSTED_APP_SESSION_ID_PREFIX = "hws_";
const HOSTED_APP_SESSION_TOKEN_BYTES = 32;
const HOSTED_APP_SESSION_ID_BYTES = 16;
const HOSTED_APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const HOSTED_APP_SESSION_ROW_LIMIT = 20;

const HOSTED_APP_SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? HOSTED_APP_SESSION_COOKIE_NAME_PRODUCTION
    : HOSTED_APP_SESSION_COOKIE_NAME_DEVELOPMENT;

const resolveHostedAppSessionFromCookies = cache(async (): Promise<HostedAppSession | null> => {
  const cookieStore = await cookies();
  return resolveHostedAppSessionFromToken(cookieStore.get(HOSTED_APP_SESSION_COOKIE_NAME)?.value);
});

export async function getHostedAppSession(): Promise<HostedAppSession | null> {
  return resolveHostedAppSessionFromCookies();
}

export async function requireHostedAppSession(): Promise<HostedAppSession> {
  const session = await getHostedAppSession();
  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    });
  }

  return session;
}

export async function requireActiveHostedAppSession(): Promise<HostedAppSession> {
  const session = await requireHostedAppSession();
  await assertActiveHostedMemberAccessAllowed({
    memberId: session.member.id,
  });
  return session;
}

export async function getHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession | null> {
  return resolveHostedAppSessionFromToken(readCookieFromRequest(request, HOSTED_APP_SESSION_COOKIE_NAME));
}

export async function requireHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession> {
  const session = await getHostedAppSessionFromRequest(request);
  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      message: "Sign in to continue.",
    });
  }

  return session;
}

export async function requireActiveHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession> {
  const session = await requireHostedAppSessionFromRequest(request);
  await assertActiveHostedMemberAccessAllowed({
    memberId: session.member.id,
  });
  return session;
}

export async function issueHostedAppSession(input: {
  memberId: string;
  now?: Date;
  privyUserId: string;
}): Promise<{ cookie: string; sessionId: string }> {
  const now = input.now ?? new Date();
  const token = generateHostedAppSessionToken();
  const sessionId = generateHostedAppSessionId();
  const expiresAt = new Date(now.getTime() + HOSTED_APP_SESSION_MAX_AGE_SECONDS * 1000);

  await getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedWebSession.create({
      data: {
        id: sessionId,
        memberId: input.memberId,
        privyUserId: input.privyUserId,
        tokenHash: hashHostedAppSessionToken(token),
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        expiresAt,
      },
    });
    await deleteHostedAppSessionOverflowTx({
      memberId: input.memberId,
      privyUserId: input.privyUserId,
      sessionId,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    cookie: buildHostedAppSessionCookie(token, HOSTED_APP_SESSION_MAX_AGE_SECONDS),
    sessionId,
  };
}

export async function revokeHostedAppSessionFromRequest(input: {
  now?: Date;
  reason: string;
  request: Request;
}): Promise<string> {
  const token = readCookieFromRequest(input.request, HOSTED_APP_SESSION_COOKIE_NAME);
  const now = input.now ?? new Date();

  if (token) {
    await getPrisma().hostedWebSession.updateMany({
      where: {
        revokedAt: null,
        tokenHash: hashHostedAppSessionToken(token),
      },
      data: {
        revokedAt: now,
        revokeReason: input.reason,
        updatedAt: now,
      },
    });
  }

  return buildHostedAppSessionClearCookie();
}

function buildHostedAppSessionClearCookie(): string {
  return buildCookie({
    maxAgeSeconds: 0,
    name: HOSTED_APP_SESSION_COOKIE_NAME,
    value: "",
  });
}

async function resolveHostedAppSessionFromToken(value: string | null | undefined): Promise<HostedAppSession | null> {
  const token = normalizeHostedAppSessionToken(value);
  if (!token) {
    return null;
  }

  const now = new Date();
  const record = await getPrisma().hostedWebSession.findUnique({
    where: {
      tokenHash: hashHostedAppSessionToken(token),
    },
  });

  if (!record || record.revokedAt || record.expiresAt <= now) {
    return null;
  }

  const member = await readHostedMemberCoreState({
    memberId: record.memberId,
    prisma: getPrisma(),
  });

  if (!member) {
    return null;
  }

  return {
    computerHandoffViewportSize: readComputerHandoffViewportSizeFromSessionRecord(record),
    expiresAt: record.expiresAt,
    member,
    privyUserId: record.privyUserId,
    sessionId: record.id,
  };
}

function readComputerHandoffViewportSizeFromSessionRecord(
  record: {
    computerHandoffViewportHeight?: number | null;
    computerHandoffViewportWidth?: number | null;
  },
): ComputerHandoffViewportSize | null {
  return normalizeComputerHandoffViewportSize({
    height: record.computerHandoffViewportHeight,
    width: record.computerHandoffViewportWidth,
  });
}

function generateHostedAppSessionToken(): string {
  return `${HOSTED_APP_SESSION_TOKEN_PREFIX}${randomBytes(HOSTED_APP_SESSION_TOKEN_BYTES).toString("base64url")}`;
}

function generateHostedAppSessionId(): string {
  return `${HOSTED_APP_SESSION_ID_PREFIX}${randomBytes(HOSTED_APP_SESSION_ID_BYTES).toString("base64url")}`;
}

function hashHostedAppSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function deleteHostedAppSessionOverflowTx(input: {
  memberId: string;
  privyUserId: string;
  sessionId: string;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  const retainedExistingSessions = await input.tx.hostedWebSession.findMany({
    where: {
      id: {
        not: input.sessionId,
      },
      memberId: input.memberId,
      privyUserId: input.privyUserId,
    },
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
    },
    take: HOSTED_APP_SESSION_ROW_LIMIT - 1,
  });
  const retainedSessionIds = [
    input.sessionId,
    ...retainedExistingSessions.map((session) => session.id),
  ];

  await input.tx.hostedWebSession.deleteMany({
    where: {
      id: {
        notIn: retainedSessionIds,
      },
      memberId: input.memberId,
      privyUserId: input.privyUserId,
    },
  });
}

function normalizeHostedAppSessionToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized.startsWith(HOSTED_APP_SESSION_TOKEN_PREFIX)) {
    return null;
  }

  // Ensure future accidental loose parsing does not accept prefix-only values.
  const minimumLength = HOSTED_APP_SESSION_TOKEN_PREFIX.length + 32;
  if (normalized.length < minimumLength) {
    return null;
  }

  return normalized;
}

function readCookieFromRequest(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(/;\s*/u)) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const entryName = entry.slice(0, separatorIndex).trim();
    if (!safeCookieNameEquals(entryName, name)) {
      continue;
    }

    const rawValue = entry.slice(separatorIndex + 1);
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function safeCookieNameEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function buildHostedAppSessionCookie(token: string, maxAgeSeconds: number): string {
  return buildCookie({
    maxAgeSeconds,
    name: HOSTED_APP_SESSION_COOKIE_NAME,
    value: token,
  });
}

function buildCookie(input: {
  maxAgeSeconds: number;
  name: string;
  value: string;
}): string {
  return [
    `${input.name}=${encodeURIComponent(input.value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(input.maxAgeSeconds))}`,
    process.env.NODE_ENV === "production" ? "Secure" : null,
  ].filter((part): part is string => Boolean(part)).join("; ");
}
