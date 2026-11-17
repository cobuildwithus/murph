import "server-only";

import { notFound, redirect } from "next/navigation";

import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { requireHostedCloudflareCallbackRequest } from "../hosted-execution/cloudflare-callback-auth";
import { isHostedThreadContainerMember, readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { getHostedAppSession, getHostedAppSessionFromRequest, requireActiveHostedAppSession } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { getPrisma } from "../prisma";
import { ConnectionError } from "./errors";

/**
 * Only an account first signed in to with a phone or Telegram can approve changes. A model that reads an email-only
 * member's inbox can sign in, attach a first phone or Telegram it controls and enroll a passkey, so for an account
 * established by email (or not known to be otherwise) no passkey is independent of that inbox. The method is written
 * once, by the sign-in that claims the member, and no later change of sign-in methods touches it.
 */
export async function connectionChangesAllowed(memberId: string): Promise<boolean> {
  const member = await getPrisma().hostedMember.findUnique({ where: { id: memberId }, select: { firstSignInMethod: true } });
  return member?.firstSignInMethod === "phone" || member?.firstSignInMethod === "telegram";
}
/** Any active person may connect MCP servers; group chats (synthetic thread containers) never can. */
export async function connectionMemberActive(memberId: string): Promise<boolean> {
  return !!await readActiveHostedMemberAccess({ memberId })
    && !await isHostedThreadContainerMember({ memberId });
}
export async function requireConnectionSession(request: Request, mutation = false) {
  const session = await getHostedAppSessionFromRequest(request);
  if (!session || !await connectionMemberActive(session.member.id)) throw new ConnectionError("not_found", 404);
  if (mutation) {
    try { assertHostedOnboardingMutationOrigin(request); }
    catch { throw new ConnectionError("not_found", 403); }
  }
  return session;
}
export async function requireConnectionCallback(request: Request): Promise<string> {
  const memberId = await requireHostedCloudflareCallbackRequest(request, { maxBodyBytes: 262144 });
  // Signature validation alone admits older callback routes without a fence.
  if (!readHostedExecutionRuntimeAuthority(new URL(request.url), request.headers)) throw new ConnectionError("not_found", 403);
  return memberId;
}

/**
 * The Settings page. Signed-out visitors sign in on the page, so a link Murph sent keeps its MCP link;
 * other session problems go to Settings; group chats get a 404.
 */
export async function readCustomConnectionsPageAccess(): Promise<{ memberId: string } | "signed_out"> {
  if (!await getHostedAppSession()) return "signed_out";
  let memberId: string;
  try {
    memberId = (await requireActiveHostedAppSession()).member.id;
  } catch {
    redirect("/settings");
  }
  if (!await connectionMemberActive(memberId)) notFound();
  return { memberId };
}
