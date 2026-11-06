export type { HostedNativeMemberAuthStage } from "../better-auth/native-auth";
import { readHostedNativeMemberAuth, type HostedNativeMemberAuth, type HostedNativeMemberAuthOptions } from "../better-auth/native-auth";
import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "../prisma";
import { assertActiveHostedMemberAccessAllowed } from "./member-access";

// The historical "Active" wrapper checks product admission, including lapsed
// humans. It grants neither AI capacity nor runtime execution authority.
export async function requireActiveHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
): Promise<HostedNativeMemberAuth> {
  const context = await requireHostedMemberAuthFromBearerToken(request, prisma);
  await assertActiveHostedMemberAccessAllowed({ memberId: context.member.id, prisma });
  return context;
}

// Legal, account and authority-reducing operations remain available without a
// product-admission check. Product reads and new authority use the wrapper above;
// spending and runtime work retain their separate AI usage checks.
export async function requireHostedMemberAuthFromBearerToken(
  request: Request,
  prisma: PrismaClient = getPrisma(),
  options: HostedNativeMemberAuthOptions = {},
): Promise<HostedNativeMemberAuth> {
  return readHostedNativeMemberAuth(request, prisma, options);
}
