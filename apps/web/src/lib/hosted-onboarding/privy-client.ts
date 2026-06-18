import {
  type HostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccountState,
} from "./privy-shared";

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

export function readHostedPrivyClientSessionState(
  input: HostedPrivyClientSessionStateInput,
): HostedPrivyLinkedAccountState | null {
  if (!hasHostedPrivyLinkedAccountSnapshot(input.user)) {
    return null;
  }

  return resolveHostedPrivyLinkedAccountState(input.user);
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
