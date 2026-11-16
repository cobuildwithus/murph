import "server-only";

import { notFound, redirect } from "next/navigation";

import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { requireHostedCloudflareCallbackRequest } from "../hosted-execution/cloudflare-callback-auth";
import { isHostedThreadContainerMember, readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { getHostedAppSession, getHostedAppSessionFromRequest, requireActiveHostedAppSession } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { ConnectionError } from "./errors";

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
