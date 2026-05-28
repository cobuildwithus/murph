import "server-only";

import { notFound, redirect } from "next/navigation";

import {
  requireActiveHostedAppSession,
  type HostedAppSession,
} from "../hosted-onboarding/app-session";

const HOSTED_OPS_MEMBER_IDS_ENV = "HOSTED_OPS_MEMBER_IDS";
const HOSTED_OPS_MEMBER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,256}$/u;

export async function requireHostedRuntimeLatencyOpsAccess(): Promise<HostedAppSession> {
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

function isHostedOpsMemberAllowed(memberId: string): boolean {
  const allowlist = readHostedOpsMemberAllowlist(process.env);
  return allowlist.size > 0 && allowlist.has(memberId);
}

function readHostedOpsMemberAllowlist(source: NodeJS.ProcessEnv): Set<string> {
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
