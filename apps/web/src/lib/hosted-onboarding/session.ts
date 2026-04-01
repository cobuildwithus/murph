import {
  HostedMemberStatus,
  type Prisma,
  type HostedMember,
  type HostedSession,
  type PrismaClient,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { getPrisma } from "../prisma";
import { deriveHostedEntitlement } from "./entitlement";
import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";
import {
  generateHostedSessionId,
  generateHostedSessionToken,
  hashHostedSessionToken,
  lockHostedMemberRow,
  sessionExpiresAt,
  withHostedOnboardingTransaction,
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
  prisma?: PrismaClient | Prisma.TransactionClient;
  now?: Date;
}): Promise<{ expiresAt: Date; sessionId: string; token: string }> {
  const prisma = input.prisma ?? getPrisma();
  const environment = getHostedOnboardingEnvironment();
  const now = input.now ?? new Date();
  const token = generateHostedSessionToken();
  const tokenHash = hashHostedSessionToken(token);

  const { expiresAt, sessionId } = await withHostedOnboardingTransaction(prisma, async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);

    const member = await tx.hostedMember.findUnique({
      where: {
        id: input.memberId,
      },
      select: {
        billingStatus: true,
        status: true,
      },
    });

    if (
      member
      && !deriveHostedEntitlement({
        billingMode: null,
        billingStatus: member.billingStatus,
        memberStatus: member.status,
      }).accessAllowed
    ) {
      throw hostedOnboardingError({
        code: "HOSTED_MEMBER_SUSPENDED",
        message: "This hosted account is suspended. Contact support to restore access.",
        httpStatus: 403,
      });
    }

    const sessionId = generateHostedSessionId();
    const expiresAt = sessionExpiresAt(now, environment.sessionTtlDays);

    const createdSession = await tx.hostedSession.create({
      data: {
        id: sessionId,
        memberId: input.memberId,
        inviteId: input.inviteId,
        tokenHash,
        expiresAt,
        lastSeenAt: now,
      },
      select: {
        createdAt: true,
        id: true,
      },
    });
    await tx.hostedSession.updateMany({
      where: {
        expiresAt: {
          gt: now,
        },
        memberId: input.memberId,
        revokedAt: null,
        OR: [
          {
            createdAt: {
              lt: createdSession.createdAt,
            },
          },
          {
            createdAt: createdSession.createdAt,
            id: {
              lt: createdSession.id,
            },
          },
        ],
      },
      data: {
        revokedAt: now,
        revokeReason: "rotated",
      },
    });

    return {
      expiresAt,
      sessionId,
    };
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

export async function requireHostedSessionFromCookieStore(
  cookies: CookieReader,
  prisma: PrismaClient = getPrisma(),
  now: Date = new Date(),
): Promise<HostedSessionRecord> {
  const session = await resolveHostedSessionFromCookieStore(cookies, prisma, now);

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
  prisma?: PrismaClient | Prisma.TransactionClient;
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

  if (
    !deriveHostedEntitlement({
      billingMode: session.member.billingMode,
      billingStatus: session.member.billingStatus,
      memberStatus: session.member.status,
    }).accessAllowed
  ) {
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
        revokeReason:
          session.member.status === HostedMemberStatus.suspended
            ? "member_suspended"
            : `billing_status:${session.member.billingStatus}`,
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
