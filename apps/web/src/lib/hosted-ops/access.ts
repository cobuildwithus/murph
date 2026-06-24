import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  requireActiveHostedAppSession,
  requireActiveHostedAppSessionFromRequest,
  type HostedAppSession,
} from "../hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "../hosted-onboarding/csrf";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const HOSTED_OPS_MEMBER_IDS_ENV = "HOSTED_OPS_MEMBER_IDS";
const HOSTED_OPS_MEMBER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;

export async function requireHostedOpsPageAccess(): Promise<HostedAppSession> {
  let session: HostedAppSession;
  try {
    session = await requireActiveHostedAppSession();
  } catch {
    redirect("/");
  }

  if (!isHostedOpsMemberAllowed(session.member.id)) {
    notFound();
  }

  return session;
}

export async function requireHostedOpsRequestAccess(
  request: Request,
  options: {
    requireMutationOrigin?: boolean;
  } = {},
): Promise<HostedAppSession> {
  if (options.requireMutationOrigin === true) {
    assertHostedOnboardingMutationOrigin(request);
  }

  const session = await requireActiveHostedAppSessionFromRequest(request);
  if (!isHostedOpsMemberAllowed(session.member.id)) {
    throw hostedOnboardingError({
      code: "HOSTED_OPS_ACCESS_DENIED",
      httpStatus: 404,
      message: "Hosted ops route was not found.",
    });
  }

  return session;
}

export function isHostedOpsMemberAllowed(memberId: string): boolean {
  const allowlist = readHostedOpsMemberAllowlist(process.env);
  return allowlist.size > 0 && allowlist.has(memberId);
}

export function readHostedOpsMemberAllowlist(source: NodeJS.ProcessEnv): Set<string> {
  const raw = source[HOSTED_OPS_MEMBER_IDS_ENV];
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => HOSTED_OPS_MEMBER_ID_PATTERN.test(entry)),
  );
}
