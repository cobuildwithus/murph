import "server-only";

import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { requireHostedCloudflareCallbackRequest } from "../hosted-execution/cloudflare-callback-auth";
import { isHostedThreadContainerMember, readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import { getHostedAppSessionFromRequest } from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { ConnectionError } from "./errors";

export function connectionMemberAllowed(memberId: string): boolean {
  return /^[A-Za-z0-9_.:-]{1,256}$/u.test(memberId) && (process.env.HOSTED_CUSTOM_CONNECTION_MEMBER_IDS ?? "").split(",").map((id) => id.trim()).includes(memberId);
}
export async function connectionMemberActive(memberId: string): Promise<boolean> {
  return connectionMemberAllowed(memberId)
    && !!await readActiveHostedMemberAccess({ memberId })
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
