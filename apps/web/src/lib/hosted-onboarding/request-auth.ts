export type { HostedNativeMemberAuthStage } from "../better-auth/native-auth";
import { readHostedNativeMemberAuth, type HostedNativeMemberAuth, type HostedNativeMemberAuthOptions } from "../better-auth/native-auth";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { assertActiveHostedMemberAccessAllowed } from "./member-access";

export async function requireActiveHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedNativeMemberAuth> {
  const context = await requireHostedMemberAuthFromBearerToken(request, prisma);
  await assertActiveHostedMemberAccessAllowed({ memberId: context.member.id, prisma });
  return context;
}

// Legal, account and authority-reducing operations remain available without an
// entitlement check. Product reads and new authority use the active wrapper.
export async function requireHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  options: HostedNativeMemberAuthOptions = {},
): Promise<HostedNativeMemberAuth> {
  return readHostedNativeMemberAuth(request, prisma, options);
}
