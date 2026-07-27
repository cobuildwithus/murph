import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { type Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { cache } from "react";

import { getPrisma } from "../prisma";
import {
  assertActiveHostedMemberAccessAllowed,
} from "./member-access";
import { hostedOnboardingError } from "./errors";
import {
  readHostedMemberCoreState,
  type HostedMemberCoreState,
} from "./hosted-member-store";
import { assertHostedMemberNotSuspended } from "./entitlement";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "./shared";
import { readHostedAppSessionHmacKey } from "./app-session-config";

export interface HostedAppSession {
  expiresAt: Date;
  member: HostedMemberCoreState;
  privyUserId: string;
  sessionId: string;
}

const HOSTED_APP_SESSION_COOKIE_NAME_PRODUCTION = "__Host-murph-session";
const HOSTED_APP_SESSION_COOKIE_NAME_DEVELOPMENT = "murph-session";
const HOSTED_APP_SESSION_TOKEN_PREFIX = "murph_session_v2.";
const HOSTED_APP_SESSION_AUTHENTICATOR_DOMAIN = "murph.hosted-app-session";
const HOSTED_APP_SESSION_AUTHENTICATOR_VERSION = 2;
const HOSTED_APP_SESSION_ID_PREFIX = "hws_";
const HOSTED_APP_SESSION_BEARER_BYTES = 32;
const HOSTED_APP_SESSION_ID_BYTES = 16;
const HOSTED_APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const HOSTED_APP_SESSION_ROW_LIMIT = 20;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;

interface HostedAppSessionToken {
  bearer: string;
  sessionId: string;
}

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
  const sessionId = generateHostedAppSessionId();
  const token = generateHostedAppSessionToken(sessionId);
  const expiresAt = new Date(now.getTime() + HOSTED_APP_SESSION_MAX_AGE_SECONDS * 1000);
  const hmacKey = readHostedAppSessionHmacKey();

  await getPrisma().$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const member = await readHostedMemberCoreState({
      memberId: input.memberId,
      prisma: tx,
    });
    if (!member) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_NOT_FOUND",
        httpStatus: 404,
        message: "Your hosted member record was not found.",
      });
    }
    assertHostedMemberNotSuspended(member);
    await tx.hostedWebSession.create({
      data: {
        id: sessionId,
        memberId: input.memberId,
        privyUserId: input.privyUserId,
        tokenHash: createHostedAppSessionAuthenticator({
          bearer: token.bearer,
          expiresAt,
          memberId: input.memberId,
          privyUserId: input.privyUserId,
          sessionId,
        }, hmacKey),
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
    cookie: buildHostedAppSessionCookie(
      serializeHostedAppSessionToken(token),
      HOSTED_APP_SESSION_MAX_AGE_SECONDS,
    ),
    sessionId,
  };
}

export async function revokeHostedAppSessionFromRequest(input: {
  now?: Date;
  reason: string;
  request: Request;
}): Promise<string> {
  const token = parseHostedAppSessionToken(
    readCookieFromRequest(input.request, HOSTED_APP_SESSION_COOKIE_NAME),
  );
  const now = input.now ?? new Date();

  if (token) {
    const hmacKey = readHostedAppSessionHmacKey();
    const prisma = getPrisma();
    const record = await prisma.hostedWebSession.findUnique({
      where: { id: token.sessionId },
    });

    if (record && verifyHostedAppSessionAuthenticator(record, token, hmacKey)) {
      await prisma.hostedWebSession.updateMany({
        where: {
          id: record.id,
          revokedAt: null,
          tokenHash: record.tokenHash,
        },
        data: {
          revokedAt: now,
          revokeReason: input.reason,
          updatedAt: now,
        },
      });
    }
  }

  return buildHostedAppSessionClearCookie();
}

export function buildHostedAppSessionClearCookie(): string {
  return buildCookie({
    maxAgeSeconds: 0,
    name: HOSTED_APP_SESSION_COOKIE_NAME,
    value: "",
  });
}

async function resolveHostedAppSessionFromToken(value: string | null | undefined): Promise<HostedAppSession | null> {
  const token = parseHostedAppSessionToken(value);
  if (!token) {
    return null;
  }

  const hmacKey = readHostedAppSessionHmacKey();
  const prisma = getPrisma();
  const now = new Date();
  const record = await prisma.hostedWebSession.findUnique({
    where: { id: token.sessionId },
  });

  if (
    !record
    || !verifyHostedAppSessionAuthenticator(record, token, hmacKey)
    || record.revokedAt
    || record.expiresAt <= now
  ) {
    return null;
  }

  const member = await readHostedMemberCoreState({
    memberId: record.memberId,
    prisma,
  });

  if (!member) {
    return null;
  }

  return {
    expiresAt: record.expiresAt,
    member,
    privyUserId: record.privyUserId,
    sessionId: record.id,
  };
}

function generateHostedAppSessionToken(sessionId: string): HostedAppSessionToken {
  return {
    bearer: randomBytes(HOSTED_APP_SESSION_BEARER_BYTES).toString("base64url"),
    sessionId,
  };
}

function generateHostedAppSessionId(): string {
  return `${HOSTED_APP_SESSION_ID_PREFIX}${randomBytes(HOSTED_APP_SESSION_ID_BYTES).toString("base64url")}`;
}

function createHostedAppSessionAuthenticator(
  input: {
    bearer: string;
    expiresAt: Date;
    memberId: string;
    privyUserId: string;
    sessionId: string;
  },
  hmacKey: Buffer,
): string {
  const expiresAtMs = input.expiresAt.getTime();
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError("Hosted app session expiry must be a valid date.");
  }

  const payload = JSON.stringify([
    HOSTED_APP_SESSION_AUTHENTICATOR_DOMAIN,
    HOSTED_APP_SESSION_AUTHENTICATOR_VERSION,
    input.sessionId,
    input.bearer,
    input.memberId,
    input.privyUserId,
    expiresAtMs,
  ]);

  return createHmac("sha256", hmacKey).update(payload, "utf8").digest("hex");
}

function verifyHostedAppSessionAuthenticator(
  record: {
    expiresAt: Date;
    id: string;
    memberId: string;
    privyUserId: string;
    tokenHash: string;
  },
  token: HostedAppSessionToken,
  hmacKey: Buffer,
): boolean {
  if (!SHA256_HEX_PATTERN.test(record.tokenHash)) {
    return false;
  }

  let expected: string;
  try {
    expected = createHostedAppSessionAuthenticator({
      bearer: token.bearer,
      expiresAt: record.expiresAt,
      memberId: record.memberId,
      privyUserId: record.privyUserId,
      sessionId: record.id,
    }, hmacKey);
  } catch {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(record.tokenHash, "hex"),
    Buffer.from(expected, "hex"),
  );
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

function serializeHostedAppSessionToken(token: HostedAppSessionToken): string {
  return `${HOSTED_APP_SESSION_TOKEN_PREFIX}${token.sessionId}.${token.bearer}`;
}

function parseHostedAppSessionToken(value: string | null | undefined): HostedAppSessionToken | null {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || !value.startsWith(HOSTED_APP_SESSION_TOKEN_PREFIX)
  ) {
    return null;
  }

  const payload = value.slice(HOSTED_APP_SESSION_TOKEN_PREFIX.length);
  const separatorIndex = payload.indexOf(".");
  if (separatorIndex <= 0 || separatorIndex !== payload.lastIndexOf(".")) {
    return null;
  }

  const sessionId = payload.slice(0, separatorIndex);
  const bearer = payload.slice(separatorIndex + 1);
  const encodedSessionId = sessionId.startsWith(HOSTED_APP_SESSION_ID_PREFIX)
    ? sessionId.slice(HOSTED_APP_SESSION_ID_PREFIX.length)
    : "";

  if (
    !isCanonicalBase64Url(encodedSessionId, HOSTED_APP_SESSION_ID_BYTES)
    || !isCanonicalBase64Url(bearer, HOSTED_APP_SESSION_BEARER_BYTES)
  ) {
    return null;
  }

  return { bearer, sessionId };
}

function isCanonicalBase64Url(value: string, byteLength: number): boolean {
  const encodedLength = Math.ceil((byteLength * 4) / 3);
  if (value.length !== encodedLength || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return false;
  }

  const decoded = Buffer.from(value, "base64url");
  return decoded.byteLength === byteLength && decoded.toString("base64url") === value;
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
