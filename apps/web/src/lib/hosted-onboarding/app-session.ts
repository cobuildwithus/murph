import "server-only";

import type { Prisma } from "@prisma/client";
import { headers as requestHeaders } from "next/headers";
import { cache } from "react";
import { getPrisma } from "../prisma";
import { classifyHostedBrowserCredential } from "../better-auth/transport";
import { requireHostedBetterAuthConfig } from "../better-auth/config";
import {
  readHostedAuthSession, assertHostedAuthSessionCurrentTx, revokeHostedAuthSession,
  buildHostedAuthSessionClearCookie, type HostedAuthSessionProof,
} from "../better-auth/session";
import { assertActiveHostedMemberAccessAllowed } from "./member-access";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import type { HostedMemberCoreState } from "./hosted-member-store";

export interface HostedAppSession {
  expiresAt: Date;
  member: HostedMemberCoreState;
  sessionId: string;
  authProof: HostedAuthSessionProof;
  primaryAuthenticatedAt: Date | null;
}

const resolveHostedAppSessionFromCookies = cache(async (): Promise<HostedAppSession | null> =>
  resolveHostedAppSessionFromHeaders(await requestHeaders()));

export async function getHostedAppSession(): Promise<HostedAppSession | null> {
  return resolveHostedAppSessionFromCookies();
}

export async function requireHostedAppSession(): Promise<HostedAppSession> {
  const session = await getHostedAppSession();
  if (!session) throw authRequired();
  return session;
}

export async function requireActiveHostedAppSession(): Promise<HostedAppSession> {
  const session = await requireHostedAppSession();
  await assertActiveHostedMemberAccessAllowed({ memberId: session.member.id });
  return session;
}

export async function getHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession | null> {
  return resolveHostedAppSessionFromHeaders(request.headers);
}

async function resolveHostedAppSessionFromHeaders(headers: Pick<Headers, "get">): Promise<HostedAppSession | null> {
  let credential: ReturnType<typeof classifyHostedBrowserCredential>;
  try {
    credential = classifyHostedBrowserCredential({
      authorization: headers.get("authorization"), cookie: headers.get("cookie"), production: process.env.NODE_ENV === "production",
    });
  } catch (error) {
    if (isHostedOnboardingError(error) && error.code === "AUTH_REQUIRED") return null;
    throw error;
  }
  if (credential.kind === "anonymous") return null;
  const result = await readHostedAuthSession({
    ...requireHostedBetterAuthConfig(), credential: credential.token, transport: "browser", prisma: getPrisma(),
  });
  if (!result.session) return null;
  const { proof, ...session } = result.session;
  return { ...session, authProof: proof };
}

export async function requireHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession> {
  const session = await getHostedAppSessionFromRequest(request);
  if (!session) throw authRequired();
  return session;
}

export async function requireActiveHostedAppSessionFromRequest(request: Request): Promise<HostedAppSession> {
  const session = await requireHostedAppSessionFromRequest(request);
  await assertActiveHostedMemberAccessAllowed({ memberId: session.member.id });
  return session;
}

export async function assertHostedAppSessionCurrentTx(input: {
  memberId: string;
  now?: Date;
  prisma: Prisma.TransactionClient;
  request: Request;
  sessionId: string;
  authProof?: HostedAuthSessionProof;
}): Promise<void> {
  const credential = classifyHostedBrowserCredential({
    authorization: input.request.headers.get("authorization"), cookie: input.request.headers.get("cookie"),
    production: process.env.NODE_ENV === "production",
  });
  if (credential.kind === "anonymous" || !input.authProof) throw authRequired();
  await assertHostedAuthSessionCurrentTx({ ...input, credential: credential.token, proof: input.authProof });
}

export async function revokeHostedAppSessionFromRequest(input: {
  now?: Date;
  reason: string;
  request: Request;
}): Promise<string[]> {
  const credential = classifyHostedBrowserCredential({
    authorization: input.request.headers.get("authorization"), cookie: input.request.headers.get("cookie"),
    production: process.env.NODE_ENV === "production",
  });
  if (credential.kind !== "anonymous") await revokeHostedAuthSession({
    ...requireHostedBetterAuthConfig(), credential: credential.token, prisma: getPrisma(), transport: "browser",
  });
  return buildHostedAppSessionClearCookies();
}

export function buildHostedAppSessionClearCookies(): string[] {
  return [buildHostedAuthSessionClearCookie()];
}

export const buildHostedAppSessionClearCookie = buildHostedAuthSessionClearCookie;

function authRequired() {
  return hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in to continue." });
}
