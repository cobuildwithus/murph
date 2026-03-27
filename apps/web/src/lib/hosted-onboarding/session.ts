import {
  HostedMemberStatus,
  type HostedMember,
  type HostedSession,
  type PrismaClient,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import {
  generateHostedSessionId,
  generateHostedSessionToken,
  hashHostedSessionToken,
  sessionExpiresAt,
} from "./shared";

export interface HostedSessionRecord {
  member: HostedMember;
  session: HostedSession;
}

interface CookieReader {
  get(name: string): { value: string } | undefined;
}

export async function createHostedSession(input: {
  inviteId: string | null;
  memberId: string;
  prisma?: PrismaClient;
  userAgent?: string | null;
  now?: Date;
}): Promise<{ expiresAt: Date; sessionId: string; token: string }> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const now = input.now ?? new Date();
  const member = await prisma.hostedMember.findUnique({
    where: {
      id: input.memberId,
    },
    select: {
      status: true,
    },
  });

  if (member?.status === HostedMemberStatus.suspended) {
    throw hostedOnboardingError({
      code: "HOSTED_MEMBER_SUSPENDED",
      message: "This hosted account is suspended. Contact support to restore access.",
      httpStatus: 403,
    });
  }

  const token = generateHostedSessionToken();
  const tokenHash = hashHostedSessionToken(token);
  const sessionId = generateHostedSessionId();
  const expiresAt = sessionExpiresAt(now, environment.sessionTtlDays);

  await prisma.hostedSession.create({
    data: {
      id: sessionId,
      memberId: input.memberId,
      inviteId: input.inviteId,
      tokenHash,
      userAgent: input.userAgent ?? null,
      expiresAt,
      lastSeenAt: now,
    },
  });
  await prisma.hostedSession.updateMany({
    where: {
      expiresAt: {
        gt: now,
      },
      id: {
        not: sessionId,
      },
      memberId: input.memberId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokeReason: "rotated",
    },
  });

  return {
    expiresAt,
    sessionId,
    token,
  };
}

export async function resolveHostedSessionFromRequest(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
): Promise<HostedSessionRecord | null> {
  const token = readHostedSessionTokenFromCookieHeader(request.headers.get("cookie"));
  return token ? findHostedSessionByToken(token, prisma, now) : null;
}

export async function resolveHostedSessionFromCookieStore(
  cookies: CookieReader,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
): Promise<HostedSessionRecord | null> {
  const environment = getHostedOnboardingEnvironment();
  const token = cookies.get(environment.sessionCookieName)?.value ?? null;
  return token ? findHostedSessionByToken(token, prisma, now) : null;
}

export async function requireHostedSessionFromRequest(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
): Promise<HostedSessionRecord> {
  const session = await resolveHostedSessionFromRequest(request, prisma, now);

  if (!session) {
    throw hostedOnboardingError({
      code: "AUTH_REQUIRED",
      message: "Verify your phone to continue.",
      httpStatus: 401,
    });
  }

  return session;
}

export async function revokeHostedSessionFromRequest(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
  reason = "logout",
): Promise<boolean> {
  const token = readHostedSessionTokenFromCookieHeader(request.headers.get("cookie"));
  return token ? revokeHostedSessionByToken(token, prisma, now, reason) : false;
}

export async function revokeHostedSessionsForMember(input: {
  memberId: string;
  now?: Date;
  prisma?: PrismaClient;
  reason: string;
}): Promise<number> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const result = await prisma.hostedSession.updateMany({
    where: {
      expiresAt: {
        gt: now,
      },
      memberId: input.memberId,
      revokedAt: null,
    },
    data: {
      revokedAt: now,
      revokeReason: input.reason,
    },
  });

  return result.count;
}

export function applyHostedSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  const environment = getHostedOnboardingEnvironment();
  response.cookies.set({
    name: environment.sessionCookieName,
    value: token,
    expires: expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: environment.isProduction,
  });
}

export function clearHostedSessionCookie(response: NextResponse): void {
  const environment = getHostedOnboardingEnvironment();
  response.cookies.set({
    name: environment.sessionCookieName,
    value: "",
    expires: new Date(0),
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: environment.isProduction,
  });
}

async function findHostedSessionByToken(
  token: string,
  prisma: PrismaClient,
  now: Date,
): Promise<HostedSessionRecord | null> {
  const session = await prisma.hostedSession.findFirst({
    where: {
      tokenHash: hashHostedSessionToken(token),
      revokedAt: null,
      expiresAt: {
        gt: now,
      },
    },
    include: {
      member: true,
    },
  });

  if (!session) {
    return null;
  }

  if (session.member.status === HostedMemberStatus.suspended) {
    await prisma.hostedSession.updateMany({
      where: {
        expiresAt: {
          gt: now,
        },
        id: session.id,
        revokedAt: null,
      },
      data: {
        revokedAt: now,
        revokeReason: "member_suspended",
      },
    });

    return null;
  }

  return {
    member: session.member,
    session,
  };
}

async function revokeHostedSessionByToken(
  token: string,
  prisma: PrismaClient,
  now: Date,
  reason: string,
): Promise<boolean> {
  const result = await prisma.hostedSession.updateMany({
    where: {
      expiresAt: {
        gt: now,
      },
      revokedAt: null,
      tokenHash: hashHostedSessionToken(token),
    },
    data: {
      revokedAt: now,
      revokeReason: reason,
    },
  });

  return result.count > 0;
}

function readHostedSessionTokenFromCookieHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  const environment = getHostedOnboardingEnvironment();
  const entries = cookieHeader.split(/;\s*/u);

  for (const entry of entries) {
    const [name, ...valueParts] = entry.split("=");

    if (name === environment.sessionCookieName) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}
