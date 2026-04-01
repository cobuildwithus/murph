import {
  type HostedPrivyLinkedAccountState,
  resolveHostedPrivyLinkedAccountState,
} from "./privy-shared";

export type HostedPrivyClientSessionIssue = "missing-phone" | "missing-wallet";
export type HostedPrivyClientPendingAction =
  | "continue"
  | "logout"
  | "send-code"
  | "verify-code"
  | null;
export type HostedPrivyFinalizationState = "idle" | "running" | "completed";

export const HOSTED_PRIVY_CLIENT_SESSION_RETRY_DELAYS_MS = [0, 250, 500, 1_000] as const;
export const HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS = [0, 250, 500, 1_000, 2_000, 4_000] as const;

interface HostedPrivyClientSessionStateInput {
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}

interface HostedPrivyWalletProvisioningInput extends HostedPrivyClientSessionStateInput {
  createWallet: () => Promise<unknown>;
}

export async function ensureHostedPrivyPhoneAndWalletReady(
  input: HostedPrivyWalletProvisioningInput,
): Promise<void> {
  let sessionState = await readHostedPrivyClientSessionStateWithRetry(
    input,
    (candidate) => Boolean(candidate.phone),
  );

  if (!sessionState.phone) {
    throw new Error("This Privy session is missing a verified phone number.");
  }

  if (sessionState.wallet) {
    return;
  }

  try {
    await input.createWallet();
  } catch (error) {
    sessionState = await readHostedPrivyClientSessionStateWithRetry(
      input,
      (candidate) => Boolean(candidate.wallet),
    );

    if (sessionState.wallet) {
      return;
    }

    throw error;
  }

  sessionState = await readHostedPrivyClientSessionStateWithRetry(
    input,
    (candidate) => Boolean(candidate.wallet),
  );

  if (!sessionState.wallet) {
    throw new Error("We could not finish preparing your account. Wait a moment and try again.");
  }
}

export async function readHostedPrivyClientSessionState(
  input: HostedPrivyClientSessionStateInput,
): Promise<HostedPrivyLinkedAccountState> {
  const currentState = resolveHostedPrivyLinkedAccountState(input.user);

  if (currentState.phone && currentState.wallet) {
    return currentState;
  }

  try {
    return resolveHostedPrivyLinkedAccountState(await input.refreshUser());
  } catch {
    return currentState;
  }
}

export function resolveHostedPrivyClientSessionIssue(
  sessionState: HostedPrivyLinkedAccountState,
): HostedPrivyClientSessionIssue | null {
  if (!sessionState.phone) {
    return "missing-phone";
  }

  if (!sessionState.wallet) {
    return "missing-wallet";
  }

  return null;
}

export function describeHostedPrivyClientSessionIssue(
  issue: HostedPrivyClientSessionIssue | null,
): string | null {
  if (issue === "missing-phone") {
    return "Your current Privy session is missing a verified phone number. Sign out and continue with SMS.";
  }

  if (issue === "missing-wallet") {
    return "Your current Privy session is almost ready. We're finishing setup now, or you can sign out and use a different number.";
  }

  return null;
}

export function canContinueHostedPrivyClientSession(issue: HostedPrivyClientSessionIssue | null): boolean {
  return issue !== "missing-phone";
}

export function shouldAutoContinueHostedPrivyClientSession(input: {
  authenticated: boolean;
  autoContinueSuppressed: boolean;
  autoContinueTriggered: boolean;
  checkingAuthenticatedSession: boolean;
  finalizationState: HostedPrivyFinalizationState;
  issue: HostedPrivyClientSessionIssue | null;
  pendingAction: HostedPrivyClientPendingAction;
}): boolean {
  if (!input.authenticated) {
    return false;
  }

  if (!canContinueHostedPrivyClientSession(input.issue)) {
    return false;
  }

  if (
    input.autoContinueSuppressed
    || input.checkingAuthenticatedSession
    || input.finalizationState !== "idle"
    || input.pendingAction !== null
    || input.autoContinueTriggered
  ) {
    return false;
  }

  return true;
}

export function shouldSuppressHostedPrivyAutoContinueAfterError(error: unknown): boolean {
  return Boolean(
    error instanceof Error
    && error.name === "HostedOnboardingApiError"
    && "retryable" in error
    && (error as { retryable?: unknown }).retryable === false,
  );
}

export function shouldResetHostedPrivyAutoContinueTrigger(input: {
  authenticated: boolean;
  autoContinueSuppressed: boolean;
  issue: HostedPrivyClientSessionIssue | null;
}): boolean {
  return !input.authenticated || input.autoContinueSuppressed || !canContinueHostedPrivyClientSession(input.issue);
}

export function shouldShowHostedPrivyAuthenticatedLoadingState(input: {
  authenticated: boolean;
  autoContinueSuppressed: boolean;
  issue: HostedPrivyClientSessionIssue | null;
}): boolean {
  return input.authenticated && !input.autoContinueSuppressed && canContinueHostedPrivyClientSession(input.issue);
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

export function shouldResetHostedPrivyClientSessionToSms(input: {
  authenticated: boolean;
  autoResetTriggered: boolean;
  checkingAuthenticatedSession: boolean;
  issue: HostedPrivyClientSessionIssue | null;
  pendingAction: HostedPrivyClientPendingAction;
}): boolean {
  if (!input.authenticated || input.issue !== "missing-phone") {
    return false;
  }

  if (input.checkingAuthenticatedSession || input.pendingAction !== null || input.autoResetTriggered) {
    return false;
  }

  return true;
}

async function readHostedPrivyClientSessionStateWithRetry(
  input: HostedPrivyClientSessionStateInput,
  accept: (sessionState: HostedPrivyLinkedAccountState) => boolean,
): Promise<HostedPrivyLinkedAccountState> {
  let latestSessionState = await readHostedPrivyClientSessionState(input);

  if (accept(latestSessionState)) {
    return latestSessionState;
  }

  for (const delayMs of HOSTED_PRIVY_CLIENT_SESSION_RETRY_DELAYS_MS.slice(1)) {
    await sleep(delayMs);
    latestSessionState = await readHostedPrivyClientSessionState(input);

    if (accept(latestSessionState)) {
      return latestSessionState;
    }
  }

  return latestSessionState;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}
