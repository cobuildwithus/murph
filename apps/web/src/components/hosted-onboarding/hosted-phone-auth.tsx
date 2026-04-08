"use client";

import {
  useCreateWallet,
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";
import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  ensureHostedPrivyPhoneReady,
  HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS,
  readHostedPrivyClientSessionState,
  resolveHostedPrivyClientSessionIssue,
  shouldShowHostedPrivyRestartState,
  shouldShowHostedPrivyManualResumeState,
  type HostedPrivyFinalizationState,
  type HostedPrivyClientPendingAction,
  type HostedPrivyClientSessionIssue,
} from "@/src/lib/hosted-onboarding/privy-client";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  HostedAuthenticatedPhoneAuthState,
  HostedInvitePhoneAuthFlow,
  HostedPublicPhoneAuthFlow,
  type HostedAuthenticatedPhoneAuthView,
} from "./hosted-phone-auth-views";
import {
  HostedOnboardingApiError,
  requestHostedOnboardingJson,
} from "./client-api";
import { HostedPrivyProvider } from "./privy-provider";

interface HostedPhoneAuthProps {
  inviteCode?: string | null;
  mode: "invite" | "public";
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  phoneHint?: string | null;
  privyAppId: string;
  privyClientId?: string | null;
  wrapProvider?: boolean;
}

interface HostedPhoneCountryOption {
  code: string;
  dialCode: string;
  label: string;
  placeholder: string;
}

interface HostedPrivyFinalizationAttemptInput {
  action: "continue" | "verify-code";
  finalize: () => Promise<void>;
  getFinalizationState: () => HostedPrivyFinalizationState;
  setPendingAction: (action: HostedPrivyClientPendingAction) => void;
  updateFinalizationState: (nextState: HostedPrivyFinalizationState) => void;
}

interface InvitePhoneCodePayload {
  phoneNumber: string;
  sendAttemptId: string;
}

interface PendingInvitePhoneCodeMutation {
  inviteCode: string;
  kind: "abort" | "confirm";
  sendAttemptId: string;
}

const HOSTED_PHONE_COUNTRY_OPTIONS: HostedPhoneCountryOption[] = [
  { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
  { code: "CA", dialCode: "+1", label: "Canada", placeholder: "(416) 555-0123" },
];

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";
const HOSTED_INVITE_SEND_CONFIRM_RETRY_DELAYS_MS = [0, 250, 1_000] as const;
const HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY = "murph.hosted-onboarding.invite-phone-code-mutation";

export function HostedPhoneAuth({ privyAppId, privyClientId, wrapProvider = true, ...props }: HostedPhoneAuthProps) {
  const content = <HostedPhoneAuthInner {...props} />;

  if (!wrapProvider) {
    return content;
  }

  return (
    <HostedPrivyProvider appId={privyAppId} clientId={privyClientId}>
      {content}
    </HostedPrivyProvider>
  );
}

function HostedPhoneAuthInner({
  inviteCode,
  mode,
  onCompleted,
  onSignOut,
}: Omit<HostedPhoneAuthProps, "privyAppId" | "wrapProvider">) {
  const { authenticated, logout, ready } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { loginWithCode, sendCode } = useLoginWithSms();
  const { refreshUser, user } = useUser();
  const [authenticatedSessionIssue, setAuthenticatedSessionIssue] = useState<HostedPrivyClientSessionIssue | null>(null);
  const [checkingAuthenticatedSession, setCheckingAuthenticatedSession] = useState(false);
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalizationState, setFinalizationState] = useState<HostedPrivyFinalizationState>("idle");
  const [manualEntryVisible, setManualEntryVisible] = useState(mode !== "invite");
  const [pendingAction, setPendingAction] = useState<HostedPrivyClientPendingAction>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const finalizationStateRef = useRef<HostedPrivyFinalizationState>("idle");

  const selectedPhoneCountry = useMemo(
    () =>
      HOSTED_PHONE_COUNTRY_OPTIONS.find((option) => option.code === phoneCountryCode)
      ?? HOSTED_PHONE_COUNTRY_OPTIONS[0],
    [phoneCountryCode],
  );
  const normalizedPhoneNumber = useMemo(
    () => normalizePhoneNumberForCountry(phoneNumber, selectedPhoneCountry.dialCode),
    [phoneNumber, selectedPhoneCountry.dialCode],
  );
  const showAuthenticatedLoadingState = authenticated && (checkingAuthenticatedSession || finalizationState !== "idle");
  const showAuthenticatedManualResumeState = shouldShowHostedPrivyManualResumeState({
    authenticated,
    issue: authenticatedSessionIssue,
    showAuthenticatedLoadingState,
  });
  const showAuthenticatedRestartState = shouldShowHostedPrivyRestartState({
    authenticated,
    issue: authenticatedSessionIssue,
    showAuthenticatedLoadingState,
  });
  const authenticatedView = resolveHostedAuthenticatedPhoneAuthView({
    showAuthenticatedLoadingState,
    showAuthenticatedManualResumeState,
    showAuthenticatedRestartState,
  });
  const authenticatedLoadingTitle =
    checkingAuthenticatedSession
      ? "Checking your setup..."
      : "Finishing setup...";
  const authenticatedLoadingBody =
    "Keep this tab open. We are verifying your number, preparing your account, and moving you to the next step.";

  function updateFinalizationState(nextState: HostedPrivyFinalizationState) {
    finalizationStateRef.current = nextState;
    setFinalizationState(nextState);
  }

  useEffect(() => {
    let cancelled = false;

    async function inspectAuthenticatedSession() {
      if (!authenticated || !ready) {
        setAuthenticatedSessionIssue(null);
        setCheckingAuthenticatedSession(false);
        return;
      }

      setCheckingAuthenticatedSession(true);

      const sessionState = await readHostedPrivyClientSessionState({ refreshUser, user });
      if (!cancelled) {
        setAuthenticatedSessionIssue(resolveHostedPrivyClientSessionIssue(sessionState));
      }
      if (!cancelled) {
        setCheckingAuthenticatedSession(false);
      }
    }

    void inspectAuthenticatedSession();

    return () => {
      cancelled = true;
    };
  }, [authenticated, ready, refreshUser, user]);

  useEffect(() => {
    if (!authenticated) {
      setAuthenticatedSessionIssue(null);
      setCheckingAuthenticatedSession(false);
      updateFinalizationState("idle");
    }
  }, [authenticated]);

  useEffect(() => {
    if (mode !== "invite" || !inviteCode) {
      return;
    }

    void flushPendingInvitePhoneCodeMutation(inviteCode);
  }, [inviteCode, mode]);

  async function handleSendCode() {
    setErrorMessage(null);

    if (!normalizedPhoneNumber) {
      setErrorMessage(`Enter a valid phone number for ${selectedPhoneCountry.label}.`);
      return;
    }

    setPendingAction("send-code");

    try {
      await sendVerificationCode(normalizedPhoneNumber);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      setPendingAction(null);
    }
  }

  async function handleInviteSendCode() {
    setErrorMessage(null);

    if (!inviteCode) {
      setManualEntryVisible(true);
      return;
    }

    setPendingAction("send-code");

    try {
      await flushPendingInvitePhoneCodeMutation(inviteCode);
      const payload = await requestHostedOnboardingJson<InvitePhoneCodePayload>({
        auth: "none",
        method: "POST",
        url: `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/send-code`,
      });

      try {
        await sendVerificationCode(payload.phoneNumber);
      } catch (error) {
        const abortSucceeded = await abortInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: payload.sendAttemptId,
        });
        if (!abortSucceeded) {
          writePendingInvitePhoneCodeMutation({
            inviteCode,
            kind: "abort",
            sendAttemptId: payload.sendAttemptId,
          });
        }
        throw error;
      }

      void finalizeInvitePhoneCodeSendConfirmation({
        inviteCode,
        sendAttemptId: payload.sendAttemptId,
      });
    } catch (error) {
      if (
        error instanceof HostedOnboardingApiError
        && error.code === "SIGNUP_PHONE_UNAVAILABLE"
      ) {
        setCode("");
        setManualEntryVisible(true);
        setStep("phone");
        setErrorMessage("Enter the number that messaged Murph to continue.");
        return;
      }

      setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      setPendingAction(null);
    }
  }

  async function sendVerificationCode(nextPhoneNumber: string) {
    await sendCode({ phoneNumber: nextPhoneNumber });
    setStep("code");
  }

  async function handleResendCode() {
    if (mode === "invite" && !manualEntryVisible && inviteCode) {
      await handleInviteSendCode();
      return;
    }

    await handleSendCode();
  }

  async function handleVerifyCode() {
    setErrorMessage(null);

    if (!code.trim()) {
      setErrorMessage("Enter the verification code we texted you.");
      return;
    }

    setPendingAction("verify-code");

    try {
      await loginWithCode({ code: code.trim() });
      await runHostedPrivyFinalization("verify-code");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
    } finally {
      if (finalizationStateRef.current === "idle") {
        setPendingAction(null);
      }
    }
  }

  async function handleContinueAuthenticated() {
    setErrorMessage(null);

    try {
      await runHostedPrivyFinalization("continue");
    } catch (error) {
      const latestSessionIssue = await readLatestAuthenticatedSessionIssue({
        authenticated,
        ready,
        refreshUser,
        user,
      });

      if (latestSessionIssue !== null) {
        setAuthenticatedSessionIssue(latestSessionIssue);
      }

      if (!canContinueHostedPrivyClientSession(latestSessionIssue)) {
        return;
      }

      setErrorMessage(toErrorMessage(error, "We could not continue with your Privy session."));
    }
  }

  async function handleLogout() {
    setErrorMessage(null);
    updateFinalizationState("idle");
    setPendingAction("logout");

    try {
      await logout();
      await onSignOut?.();
      setCode("");
      setManualEntryVisible(mode !== "invite");
      setPhoneCountryCode(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
      setPhoneNumber("");
      setStep("phone");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign you out cleanly."));
    } finally {
      setPendingAction(null);
    }
  }

  async function runHostedPrivyFinalization(action: "continue" | "verify-code") {
    await runHostedPrivyFinalizationAttempt({
      action,
      finalize: async () => finalizeHostedPrivyVerification({
        createWallet,
        inviteCode,
        onCompleted,
        refreshUser,
        user,
      }),
      getFinalizationState: () => finalizationStateRef.current,
      setPendingAction,
      updateFinalizationState,
    });
  }

  return (
    <div className="space-y-4">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to continue</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {authenticatedView ? (
        <HostedAuthenticatedPhoneAuthState
          body={authenticatedLoadingBody}
          description={
            describeHostedPrivyClientSessionIssue(authenticatedSessionIssue)
            ?? "Sign out and request a fresh code to continue."
          }
          disabled={!ready || pendingAction !== null}
          pendingAction={pendingAction}
          title={authenticatedLoadingTitle}
          view={authenticatedView}
          onContinue={handleContinueAuthenticated}
          onUseDifferentNumber={handleLogout}
        />
      ) : mode === "invite" ? (
        <HostedInvitePhoneAuthFlow
          code={code}
          disabled={!ready || pendingAction !== null}
          manualEntryVisible={manualEntryVisible}
          mode={mode}
          pendingAction={pendingAction}
          phoneCountryOptions={HOSTED_PHONE_COUNTRY_OPTIONS}
          phoneNumber={phoneNumber}
          selectedPhoneCountry={selectedPhoneCountry}
          step={step}
          onCodeChange={setCode}
          onPhoneCountryChange={setPhoneCountryCode}
          onPhoneNumberChange={setPhoneNumber}
          onResendCode={handleResendCode}
          onSendCode={handleInviteSendCode}
          onUseDifferentNumber={() => {
            setErrorMessage(null);
            setCode("");
            setManualEntryVisible(true);
            setStep("phone");
          }}
          onVerifyCode={handleVerifyCode}
        />
      ) : (
        <HostedPublicPhoneAuthFlow
          code={code}
          disabled={!ready || pendingAction !== null}
          mode={mode}
          pendingAction={pendingAction}
          phoneCountryOptions={HOSTED_PHONE_COUNTRY_OPTIONS}
          phoneNumber={phoneNumber}
          selectedPhoneCountry={selectedPhoneCountry}
          step={step}
          onCodeChange={setCode}
          onPhoneCountryChange={setPhoneCountryCode}
          onPhoneNumberChange={setPhoneNumber}
          onResendCode={handleResendCode}
          onSendCode={handleSendCode}
          onUseDifferentNumber={() => {
            setCode("");
            setStep("phone");
          }}
          onVerifyCode={handleVerifyCode}
        />
      )}
    </div>
  );
}

export function resolveHostedAuthenticatedPhoneAuthView(input: {
  showAuthenticatedLoadingState: boolean;
  showAuthenticatedManualResumeState: boolean;
  showAuthenticatedRestartState: boolean;
}): HostedAuthenticatedPhoneAuthView {
  if (input.showAuthenticatedLoadingState) {
    return "loading";
  }

  if (input.showAuthenticatedManualResumeState) {
    return "manual-resume";
  }

  if (input.showAuthenticatedRestartState) {
    return "restart";
  }

  return null;
}

async function readLatestAuthenticatedSessionIssue(input: {
  authenticated: boolean;
  ready: boolean;
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}): Promise<HostedPrivyClientSessionIssue | null> {
  if (!input.authenticated || !input.ready) {
    return null;
  }

  const sessionState = await readHostedPrivyClientSessionState({
    refreshUser: input.refreshUser,
    user: input.user,
  });

  return resolveHostedPrivyClientSessionIssue(sessionState);
}

export async function runHostedPrivyFinalizationAttempt({
  action,
  finalize,
  getFinalizationState,
  setPendingAction,
  updateFinalizationState,
}: HostedPrivyFinalizationAttemptInput): Promise<void> {
  if (getFinalizationState() !== "idle") {
    return;
  }

  setPendingAction(action);
  updateFinalizationState("running");

  try {
    await finalize();
    updateFinalizationState("completed");
  } catch (error) {
    updateFinalizationState("idle");
    throw error;
  } finally {
    if (getFinalizationState() !== "running") {
      setPendingAction(null);
    }
  }
}

async function finalizeHostedPrivyVerification(input: {
  createWallet: () => Promise<unknown>;
  inviteCode?: string | null;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  refreshUser: () => Promise<{ linkedAccounts?: unknown } | null>;
  user: { linkedAccounts?: unknown } | null;
}) {
  await ensureHostedPrivyPhoneReady(input);
  const payload = await requestHostedPrivyCompletionWithRetry(input.inviteCode);

  if (input.onCompleted) {
    await input.onCompleted(payload);
    return;
  }

  if (payload.stage === "checkout") {
    const checkout = await requestHostedOnboardingJson<{ alreadyActive: boolean; url: string | null }>({
      payload: {
        inviteCode: payload.inviteCode,
      },
      url: "/api/hosted-onboarding/billing/checkout",
    });

    if (!checkout.alreadyActive && checkout.url) {
      window.location.assign(checkout.url);
      return;
    }
  }

  window.location.assign(payload.joinUrl);
}

async function requestHostedPrivyCompletionWithRetry(
  inviteCode?: string | null,
): Promise<HostedPrivyCompletionPayload> {
  let lastError: unknown = null;

  for (const delayMs of HOSTED_PRIVY_COMPLETION_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      return await requestHostedOnboardingJson<HostedPrivyCompletionPayload>({
        payload: inviteCode ? { inviteCode } : {},
        url: "/api/hosted-onboarding/privy/complete",
      });
    } catch (error) {
      lastError = error;

      if (!isRetryableHostedPrivyCompletionError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("We could not verify your Privy session.");
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isRetryableHostedPrivyCompletionError(error: unknown): boolean {
  return (
    error instanceof HostedOnboardingApiError &&
    error.retryable &&
    (error.code === "PRIVY_PHONE_NOT_READY" || error.code === "PRIVY_WALLET_NOT_READY")
  );
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, delayMs);
  });
}

async function confirmInvitePhoneCodeSend(input: {
  inviteCode: string;
  sendAttemptId: string;
}): Promise<boolean> {
  for (const delayMs of HOSTED_INVITE_SEND_CONFIRM_RETRY_DELAYS_MS) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      await requestHostedOnboardingJson<{ ok: true }>({
        auth: "none",
        method: "POST",
        payload: {
          sendAttemptId: input.sendAttemptId,
        },
        keepalive: true,
        url: `/api/hosted-onboarding/invites/${encodeURIComponent(input.inviteCode)}/send-code/confirm`,
      });
      clearPendingInvitePhoneCodeMutation(input.inviteCode, input.sendAttemptId);
      return true;
    } catch {
      // Retry the confirm a few times before falling back to queued retry.
    }
  }

  return false;
}

export async function finalizeInvitePhoneCodeSendConfirmation(input: {
  confirm?: (input: { inviteCode: string; sendAttemptId: string }) => Promise<boolean>;
  inviteCode: string;
  sendAttemptId: string;
  writePending?: (input: PendingInvitePhoneCodeMutation) => void;
}): Promise<void> {
  const confirm = input.confirm ?? confirmInvitePhoneCodeSend;
  const writePending = input.writePending ?? writePendingInvitePhoneCodeMutation;
  try {
    const confirmSucceeded = await confirm({
      inviteCode: input.inviteCode,
      sendAttemptId: input.sendAttemptId,
    });

    if (confirmSucceeded) {
      return;
    }
  } catch {
    // Queue a retry below.
  }

  writePending({
    inviteCode: input.inviteCode,
    kind: "confirm",
    sendAttemptId: input.sendAttemptId,
  });
}

async function abortInvitePhoneCodeSend(input: {
  inviteCode: string;
  sendAttemptId: string;
}): Promise<boolean> {
  try {
    await requestHostedOnboardingJson<{ ok: true }>({
      auth: "none",
      method: "POST",
      payload: {
        sendAttemptId: input.sendAttemptId,
      },
      keepalive: true,
      url: `/api/hosted-onboarding/invites/${encodeURIComponent(input.inviteCode)}/send-code/abort`,
    });
    clearPendingInvitePhoneCodeMutation(input.inviteCode, input.sendAttemptId);
    return true;
  } catch {
    return false;
  }
}

async function flushPendingInvitePhoneCodeMutation(inviteCode: string): Promise<void> {
  const pending = readPendingInvitePhoneCodeMutation();

  if (!pending || pending.inviteCode !== inviteCode) {
    return;
  }

  const succeeded =
    pending.kind === "confirm"
      ? await confirmInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: pending.sendAttemptId,
        })
      : await abortInvitePhoneCodeSend({
          inviteCode,
          sendAttemptId: pending.sendAttemptId,
        });

  if (succeeded) {
    clearPendingInvitePhoneCodeMutation(inviteCode, pending.sendAttemptId);
  }
}

function readPendingInvitePhoneCodeMutation(): PendingInvitePhoneCodeMutation | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.inviteCode !== "string"
      || typeof value.kind !== "string"
      || (value.kind !== "abort" && value.kind !== "confirm")
      || typeof value.sendAttemptId !== "string"
    ) {
      return null;
    }

    return {
      inviteCode: value.inviteCode,
      kind: value.kind,
      sendAttemptId: value.sendAttemptId,
    };
  } catch {
    return null;
  }
}

function writePendingInvitePhoneCodeMutation(input: PendingInvitePhoneCodeMutation): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY,
      JSON.stringify(input),
    );
  } catch {
    // Local storage is best effort only.
  }
}

function clearPendingInvitePhoneCodeMutation(inviteCode: string, sendAttemptId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  const pending = readPendingInvitePhoneCodeMutation();
  if (!pending || pending.inviteCode !== inviteCode || pending.sendAttemptId !== sendAttemptId) {
    return;
  }

  try {
    window.localStorage.removeItem(HOSTED_INVITE_PHONE_CODE_MUTATION_STORAGE_KEY);
  } catch {
    // Local storage is best effort only.
  }
}
