import {
  useCreateWallet,
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import { useEffect, useEffectEvent, useMemo, useRef, useState, type FormEvent } from "react";

import {
  canContinueHostedPrivyClientSession,
  describeHostedPrivyClientSessionIssue,
  readHostedPrivyClientSessionState,
  resolveHostedPrivyClientSessionIssue,
  shouldShowHostedPrivyManualResumeState,
  shouldShowHostedPrivyRestartState,
  type HostedPrivyClientPendingAction,
  type HostedPrivyFinalizationState,
} from "@/src/lib/hosted-onboarding/privy-client";
import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";

import {
  createHostedPhoneVerificationAttempt,
  finalizeHostedPrivyVerification,
  isHostedPhoneVerificationCodeComplete,
  normalizeHostedPhoneVerificationCode,
  readSubmittedPhoneNumber,
  resolveHostedPhoneResendTarget,
  resolveHostedPhoneSubmission,
  runHostedPrivyFinalizationAttempt,
  toErrorMessage,
} from "./hosted-phone-auth-support";
import type {
  HostedAuthenticatedPhoneAuthView,
  HostedPhoneAuthIntent,
  HostedPhoneCountryOption,
  HostedPhoneVerificationAttempt,
} from "./hosted-phone-auth-types";

interface HostedPhoneAuthControllerInput {
  inviteCode?: string | null;
  intent?: HostedPhoneAuthIntent;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

const HOSTED_PHONE_COUNTRY_OPTIONS: HostedPhoneCountryOption[] = [
  { code: "US", dialCode: "+1", label: "United States", placeholder: "(415) 555-2671" },
  { code: "CA", dialCode: "+1", label: "Canada", placeholder: "(416) 555-0123" },
];

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";

export function useHostedPhoneAuthController({
  inviteCode,
  intent = "signup",
  onCompleted,
  onSignOut,
}: HostedPhoneAuthControllerInput) {
  const { authenticated, logout, ready } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { loginWithCode, sendCode } = useLoginWithSms();
  const { user } = useUser();
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [finalizationState, setFinalizationState] = useState<HostedPrivyFinalizationState>("idle");
  const [pendingAction, setPendingAction] = useState<HostedPrivyClientPendingAction>(null);
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneVerificationAttempt, setPhoneVerificationAttempt] = useState<HostedPhoneVerificationAttempt | null>(null);
  const lastAutoSubmittedCodeRef = useRef<string | null>(null);
  const finalizationStateRef = useRef<HostedPrivyFinalizationState>("idle");

  const selectedPhoneCountry = useMemo(
    () => HOSTED_PHONE_COUNTRY_OPTIONS.find((option) => option.code === phoneCountryCode) ?? HOSTED_PHONE_COUNTRY_OPTIONS[0],
    [phoneCountryCode],
  );
  const normalizedPhoneNumber = useMemo(
    () => normalizePhoneNumberForCountry(phoneNumber, selectedPhoneCountry.dialCode),
    [phoneNumber, selectedPhoneCountry.dialCode],
  );
  const normalizedVerificationCode = useMemo(() => normalizeHostedPhoneVerificationCode(code), [code]);
  const authenticatedSessionIssue = useMemo(
    () => resolveHostedPrivyClientSessionIssue(readHostedPrivyClientSessionState({ user })),
    [user],
  );

  const flowDisabled = !ready || pendingAction !== null;
  const phoneEntrySendCodeDisabled = flowDisabled || !normalizedPhoneNumber;
  const showAuthenticatedLoadingState = authenticated && finalizationState !== "idle";
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
  const authenticatedLoadingTitle = intent === "signin" ? "Signing you in..." : "Finishing setup...";
  const authenticatedLoadingBody =
    intent === "signin"
      ? "Keep this tab open. We are verifying your number and signing you into your account."
      : "Keep this tab open. We are verifying your number, preparing your account, and moving you to the next step.";

  const sharedFlowProps = {
    activeAttempt: phoneVerificationAttempt,
    code,
    disabled: flowDisabled,
    intent,
    phoneFieldDescription: null,
    phoneFieldLabel: null,
    pendingAction,
    phoneCountryOptions: HOSTED_PHONE_COUNTRY_OPTIONS,
    phoneNumber,
    sendCodeDisabled: phoneEntrySendCodeDisabled,
    secondaryActionSize: "lg" as const,
    selectedPhoneCountry,
    onCodeChange: (value: string) => {
      setCode(normalizeHostedPhoneVerificationCode(value));
    },
    onPhoneCountryChange: setPhoneCountryCode,
    onPhoneNumberChange: setPhoneNumber,
    onResendCode: handleResendCode,
    onSubmitPhoneEntry: handleSendCode,
    onUseDifferentNumber: handleResetPhoneAuthFlow,
    onVerifyCode: handleVerifyCode,
  } as const;

  function updateFinalizationState(nextState: HostedPrivyFinalizationState) {
    finalizationStateRef.current = nextState;
    setFinalizationState(nextState);
  }

  function resetPhoneAuthFlow() {
    setErrorMessage(null);
    setCode("");
    setPhoneVerificationAttempt(null);
  }

  const submitVerificationCodeEffect = useEffectEvent((submittedCode: string) => {
    void handleVerifyCode(submittedCode);
  });

  useEffect(() => {
    if (!authenticated) {
      updateFinalizationState("idle");
    }
  }, [authenticated]);

  useEffect(() => {
    if (!isHostedPhoneVerificationCodeComplete(normalizedVerificationCode)) {
      lastAutoSubmittedCodeRef.current = null;
      return;
    }

    if (
      !phoneVerificationAttempt
      || pendingAction !== null
      || lastAutoSubmittedCodeRef.current === normalizedVerificationCode
    ) {
      return;
    }

    lastAutoSubmittedCodeRef.current = normalizedVerificationCode;
    submitVerificationCodeEffect(normalizedVerificationCode);
  }, [normalizedVerificationCode, pendingAction, phoneVerificationAttempt]);

  async function handleSendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setErrorMessage(null);

    const submission = resolveHostedPhoneSubmission({
      countryDialCode: selectedPhoneCountry.dialCode,
      draftPhoneNumber: phoneNumber,
      submittedPhoneNumber: readSubmittedPhoneNumber(event),
    });

    if (submission.draftPhoneNumber !== phoneNumber) {
      setPhoneNumber(submission.draftPhoneNumber);
    }

    if (!submission.normalizedPhoneNumber) {
      setErrorMessage(`Enter a valid phone number for ${selectedPhoneCountry.label}.`);
      return;
    }

    setPendingAction("send-code");

    try {
      await sendVerificationCode(submission.normalizedPhoneNumber);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
    } finally {
      setPendingAction(null);
    }
  }

  async function sendVerificationCode(nextPhoneNumber: string) {
    await sendCode({ phoneNumber: nextPhoneNumber });
    setCode("");
    setPhoneVerificationAttempt(createHostedPhoneVerificationAttempt(nextPhoneNumber));
  }

  async function handleResendCode() {
    const resendTarget = resolveHostedPhoneResendTarget({
      phoneVerificationAttempt,
    });

    if (resendTarget.kind === "active-attempt") {
      setErrorMessage(null);
      setPendingAction("send-code");

      try {
        await sendVerificationCode(resendTarget.phoneNumber);
      } catch (error) {
        setErrorMessage(toErrorMessage(error, "We could not send a verification code."));
      } finally {
        setPendingAction(null);
      }
      return;
    }

    await handleSendCode();
  }

  async function handleVerifyCode(submittedCode = normalizedVerificationCode) {
    setErrorMessage(null);

    if (!phoneVerificationAttempt) {
      setErrorMessage("Request a fresh verification code before entering one here.");
      return;
    }

    if (!submittedCode) {
      setErrorMessage("Enter the verification code we texted you.");
      return;
    }

    setPendingAction("verify-code");

    try {
      await loginWithCode({ code: submittedCode });
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
      const latestSessionIssue = resolveHostedPrivyClientSessionIssue(readHostedPrivyClientSessionState({ user }));
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
      resetPhoneAuthFlow();
      setPhoneCountryCode(DEFAULT_HOSTED_PHONE_COUNTRY_CODE);
      setPhoneNumber("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign you out cleanly."));
    } finally {
      setPendingAction(null);
    }
  }

  async function runHostedPrivyFinalization(action: "continue" | "verify-code") {
    await runHostedPrivyFinalizationAttempt({
      action,
      finalize: async () =>
        finalizeHostedPrivyVerification({
          createWallet,
          inviteCode,
          intent,
          onCompleted,
          user,
        }),
      getFinalizationState: () => finalizationStateRef.current,
      setPendingAction,
      updateFinalizationState,
    });
  }

  function handleResetPhoneAuthFlow() {
    resetPhoneAuthFlow();
  }

  return {
    authenticatedLoadingBody,
    authenticatedLoadingTitle,
    authenticatedSessionDescription:
      describeHostedPrivyClientSessionIssue(authenticatedSessionIssue)
      ?? "Sign out and request a fresh code to continue.",
    authenticatedView,
    errorMessage,
    flowDisabled,
    pendingAction,
    sendVerificationCode,
    setErrorMessage,
    setPendingAction,
    sharedFlowProps,
    handleContinueAuthenticated,
    handleLogout,
    handleResetPhoneAuthFlow,
    handleResendCode,
    resetPhoneAuthFlow,
  };
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
