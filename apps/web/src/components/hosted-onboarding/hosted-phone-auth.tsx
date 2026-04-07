"use client";

import {
  useCreateWallet,
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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

const HOSTED_PHONE_COUNTRY_OPTIONS: HostedPhoneCountryOption[] = [
  { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
  { code: "CA", dialCode: "+1", label: "Canada", placeholder: "(416) 555-0123" },
];

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";

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

  async function handleSendCode() {
    setErrorMessage(null);

    if (!normalizedPhoneNumber) {
      setErrorMessage(`Enter a valid phone number for ${selectedPhoneCountry.label}.`);
      return;
    }

    setPendingAction("send-code");

    try {
      await sendCode({ phoneNumber: normalizedPhoneNumber });
      setStep("code");
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
      const payload = await requestHostedOnboardingJson<{ phoneNumber: string }>({
        auth: "none",
        method: "POST",
        url: `/api/hosted-onboarding/invites/${encodeURIComponent(inviteCode)}/send-code`,
      });
      await sendCode({ phoneNumber: payload.phoneNumber });
      setStep("code");
    } catch (error) {
      if (
        error instanceof HostedOnboardingApiError
        && error.code === "SIGNUP_PHONE_UNAVAILABLE"
      ) {
        setManualEntryVisible(true);
        setErrorMessage("Enter the number that messaged Murph to continue.");
        return;
      }

      setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      setPendingAction(null);
    }
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

      {!authenticated && mode === "invite" && step === "phone" && !manualEntryVisible ? (
        <div className="space-y-3">
          <p className="text-sm text-stone-600">
            We&apos;ll text a verification code to the number that messaged Murph.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleInviteSendCode}
              disabled={!ready || pendingAction !== null}
              size="lg"
            >
              {pendingAction === "send-code" ? "Sending code..." : "Send me a code"}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setErrorMessage(null);
                setManualEntryVisible(true);
              }}
              disabled={pendingAction !== null}
              variant="outline"
              size="lg"
            >
              Use a different number
            </Button>
          </div>
        </div>
      ) : null}

      {authenticated || (mode === "invite" && step === "phone" && !manualEntryVisible) ? null : (
        <div className="space-y-3">
          <Label htmlFor={`hosted-phone-${mode}`}>
            {mode === "invite" ? "Phone number" : "Your phone number"}
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Combobox
              items={HOSTED_PHONE_COUNTRY_OPTIONS}
              value={selectedPhoneCountry}
              itemToStringValue={(option) => `${option.label} (${option.dialCode})`}
              onValueChange={(option) => {
                if (option) {
                  setPhoneCountryCode(option.code);
                }
              }}
            >
              <ComboboxTrigger
                aria-label={`Country or region, ${selectedPhoneCountry.label} ${selectedPhoneCountry.dialCode}`}
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "h-12 w-auto shrink-0 justify-between px-4 text-left font-medium sm:min-w-28",
                )}
              >
                {selectedPhoneCountry.dialCode}
              </ComboboxTrigger>
              <ComboboxContent className="w-64">
                <ComboboxInput placeholder="Search countries..." />
                <ComboboxList>
                  {(option) => (
                    <ComboboxItem key={option.code} value={option}>
                      <span className="flex min-w-0 items-center justify-between gap-3">
                        <span>{option.label}</span>
                        <span className="text-xs text-stone-500">{option.dialCode}</span>
                      </span>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            <Input
              id={`hosted-phone-${mode}`}
              autoComplete="tel-national"
              inputMode="tel"
              placeholder={selectedPhoneCountry.placeholder}
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.currentTarget.value)}
              className="h-12 px-4 text-base sm:flex-1 md:text-sm"
            />
          </div>
          {mode === "invite" ? (
            <p className="text-sm text-stone-500">
              Enter the number that messaged Murph.
            </p>
          ) : null}
        </div>
      )}

      {!authenticated && step === "code" ? (
        <div className="space-y-3">
          <Label htmlFor={`hosted-code-${mode}`}>
            Verification code
          </Label>
          <Input
            id={`hosted-code-${mode}`}
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value)}
            className="h-12 px-4 text-base md:text-sm"
          />
          <p className="text-sm text-stone-500">Enter the code we just texted you.</p>
        </div>
      ) : null}

      {authenticated && showAuthenticatedLoadingState ? (
        <Alert className="border-stone-200 bg-stone-50">
          <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" />
          <AlertTitle>{authenticatedLoadingTitle}</AlertTitle>
          <AlertDescription>{authenticatedLoadingBody}</AlertDescription>
        </Alert>
      ) : showAuthenticatedManualResumeState ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>You already started signup in this browser.</AlertTitle>
          <AlertDescription>
            Keep going with this number, or sign out and use a different one.
          </AlertDescription>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={handleContinueAuthenticated}
              disabled={!ready || pendingAction !== null}
              size="lg"
            >
              Continue signup
            </Button>
            <Button type="button" onClick={handleLogout} disabled={pendingAction !== null} variant="outline" size="lg">
              {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
            </Button>
          </div>
        </Alert>
      ) : showAuthenticatedRestartState ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>This browser needs a fresh phone sign-in.</AlertTitle>
          <AlertDescription>
            {describeHostedPrivyClientSessionIssue(authenticatedSessionIssue)
              ?? "Sign out and request a fresh code to continue."}
          </AlertDescription>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button type="button" onClick={handleLogout} disabled={pendingAction !== null} variant="outline" size="lg">
              {pendingAction === "logout" ? "Signing out..." : "Use a different number"}
            </Button>
          </div>
        </Alert>
      ) : (
        <div className="flex flex-wrap gap-3">
          {step === "phone" ? (
            <Button type="button" onClick={handleSendCode} disabled={!ready || pendingAction !== null} size="lg">
              {pendingAction === "send-code" ? "Sending code..." : "Text me a code"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                onClick={handleVerifyCode}
                disabled={!ready || pendingAction !== null}
                size="lg"
              >
                {pendingAction === "verify-code"
                  ? "Finishing setup..."
                  : mode === "invite"
                    ? "Verify phone and continue"
                    : "Verify phone and create account"}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setCode("");
                  if (mode === "invite") {
                    setManualEntryVisible(true);
                  }
                  setStep("phone");
                }}
                disabled={pendingAction !== null}
                variant="outline"
                size="lg"
              >
                Use a different number
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
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
