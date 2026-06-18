import {
  type HostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccountState,
} from "./privy-shared";

export type HostedPrivyClientSessionIssue = "missing-phone";
export type HostedPrivyClientPendingAction =
  | "continue"
  | "logout"
  | "send-code"
  | "verify-code"
  | null;
export type HostedPrivyFinalizationState = "idle" | "running" | "completed";

export const HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS = [0, 500] as const;

interface HostedPrivyClientSessionStateInput {
  user: { linkedAccounts?: unknown } | null;
}

export async function ensureHostedPrivyPhoneReady(
  input: HostedPrivyClientSessionStateInput,
): Promise<void> {
  const sessionState = readHostedPrivyClientSessionState(input);

  if (!sessionState) {
    return;
  }

  if (!sessionState.phone) {
    throw new Error("This Privy session is missing a verified phone number.");
  }
}

export function readHostedPrivyClientSessionState(
  input: HostedPrivyClientSessionStateInput,
): HostedPrivyLinkedAccountState | null {
  if (!hasHostedPrivyLinkedAccountSnapshot(input.user)) {
    return null;
  }

  return resolveHostedPrivyLinkedAccountState(input.user);
}

export function resolveHostedPrivyClientSessionIssue(
  sessionState: HostedPrivyLinkedAccountState | null,
): HostedPrivyClientSessionIssue | null {
  if (!sessionState) {
    return null;
  }

  if (!sessionState.phone) {
    return "missing-phone";
  }

  return null;
}

export function describeHostedPrivyClientSessionIssue(
  issue: HostedPrivyClientSessionIssue | null,
): string | null {
  if (issue === "missing-phone") {
    return "Your current Privy session is missing a verified phone number. Sign out and continue with SMS.";
  }

  return null;
}

export function canContinueHostedPrivyClientSession(issue: HostedPrivyClientSessionIssue | null): boolean {
  return issue !== "missing-phone";
}

export function shouldShowHostedPrivyManualResumeState(input: {
  authenticated: boolean;
  issue: HostedPrivyClientSessionIssue | null;
  showAuthenticatedLoadingState: boolean;
}): boolean {
  return (
    input.authenticated
    && !input.showAuthenticatedLoadingState
    && canContinueHostedPrivyClientSession(input.issue)
  );
}

export function shouldShowHostedPrivyRestartState(input: {
  authenticated: boolean;
  issue: HostedPrivyClientSessionIssue | null;
  showAuthenticatedLoadingState: boolean;
}): boolean {
  return (
    input.authenticated
    && !input.showAuthenticatedLoadingState
    && !canContinueHostedPrivyClientSession(input.issue)
  );
}

function hasHostedPrivyLinkedAccountSnapshot(
  user: HostedPrivyClientSessionStateInput["user"],
): user is NonNullable<HostedPrivyClientSessionStateInput["user"]> {
  if (!user || typeof user !== "object") {
    return false;
  }

  const candidate = user as { linkedAccounts?: unknown; linked_accounts?: unknown };
  return Array.isArray(candidate.linkedAccounts) || Array.isArray(candidate.linked_accounts);
}
