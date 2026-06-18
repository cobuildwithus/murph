import {
  useLoginWithSms,
  usePrivy,
  useUser,
} from "@privy-io/react-auth";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

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
import type {
  HostedAuthCompletionResult,
  HostedAuthCompletionUser,
  HostedPrivyClientSessionInput,
} from "./hosted-auth-completion";

import {
  createHostedPhoneVerificationAttempt,
  finalizeHostedPhoneLink,
  finalizeHostedPrivyVerification,
  isHostedPhoneVerificationCodeComplete,
  normalizeHostedPhoneVerificationCode,
  readSubmittedPhoneNumber,
  resolveHostedPhoneResendTarget,
  resolveHostedPhoneSubmission,
  runHostedPhonePendingAction,
  runHostedPrivyFinalizationAttempt,
  isHostedPrivyAccountConflictError,
  toErrorMessage,
} from "./hosted-phone-auth-support";
import {
  HOSTED_PHONE_COUNTRY_OPTIONS,
} from "./hosted-phone-country-options";
import {
  usePhoneCountryCode,
} from "./phone-country-code-client-provider";
import type {
  HostedAuthenticatedPhoneAuthView,
  HostedPhoneAuthIntent,
  HostedPhoneLinkPayload,
  HostedPhoneVerificationAttempt,
} from "./hosted-phone-auth-types";

interface HostedPhoneAuthControllerInput {
  disableSignup?: boolean;
  inviteCode?: string | null;
  intent?: HostedPhoneAuthIntent;
  onAuthCompleted?: (result: HostedAuthCompletionResult) => Promise<void> | void;
  onCodeSent?: () => void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onLinked?: (payload: HostedPhoneLinkPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  suppressAuthenticatedSessionIssue?: boolean;
}

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";

export function useHostedPhoneAuthController({
  disableSignup = false,
  inviteCode,
  intent = "auth",
  onAuthCompleted,
  onCodeSent,
  onCompleted,
  onLinked,
  onSignOut,
  suppressAuthenticatedSessionIssue = false,
}: HostedPhoneAuthControllerInput) {
  const { authenticated, logout, ready } = usePrivy();
  const completedUserRef = useRef<HostedAuthCompletionUser | null>(null);
  const { loginWithCode, sendCode } = useLoginWithSms({
    onComplete: (params) => {
      completedUserRef.current = params.user;
    },
  });
  const { refreshUser, user } = useUser();
  const [code, setCode] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [requiresAuthenticatedSessionRestart, setRequiresAuthenticatedSessionRestart] =
    useState(false);
  const [finalizationState, setFinalizationState] =
    useState<HostedPrivyFinalizationState>("idle");
  const [pendingAction, setPendingAction] =
    useState<HostedPrivyClientPendingAction>(null);
  const phoneCountryCodeHint = usePhoneCountryCode();
  const initialPhoneCountryCode = resolveInitialHostedPhoneCountryCode({
    countryCodeHint: phoneCountryCodeHint,
  });
  const [phoneCountryCode, setPhoneCountryCode] = useState<string>(() =>
    initialPhoneCountryCode,
  );
  const [phoneNumber, setPhoneNumber] = useState("");
  const [phoneVerificationAttempt, setPhoneVerificationAttempt] =
    useState<HostedPhoneVerificationAttempt | null>(null);
  const [queuedPhoneCodeSend, setQueuedPhoneCodeSend] = useState<string | null>(null);
  const lastAutoSubmittedCodeRef = useRef<string | null>(null);
  const finalizationStateRef = useRef<HostedPrivyFinalizationState>("idle");
  const phoneCodeSendInFlightRef = useRef(false);

  const selectedPhoneCountry = useMemo(
    () =>
      HOSTED_PHONE_COUNTRY_OPTIONS.find(
        (option) => option.code === phoneCountryCode,
      ) ?? HOSTED_PHONE_COUNTRY_OPTIONS[0],
    [phoneCountryCode],
  );
  const normalizedPhoneNumber = useMemo(
    () =>
      normalizePhoneNumberForCountry(
        phoneNumber,
        selectedPhoneCountry.dialCode,
      ),
    [phoneNumber, selectedPhoneCountry.dialCode],
  );
  const normalizedVerificationCode = useMemo(
    () => normalizeHostedPhoneVerificationCode(code),
    [code],
  );
  const authenticatedSessionIssue = useMemo(() => {
    if (suppressAuthenticatedSessionIssue) {
      return null;
    }

    return resolveHostedPrivyClientSessionIssue(
      readHostedPrivyClientSessionState({ user }),
    );
  }, [suppressAuthenticatedSessionIssue, user]);
  const staleAuthenticatedFinalizationState =
    !authenticated && finalizationState !== "idle";
  const effectiveFinalizationState = staleAuthenticatedFinalizationState
    ? "idle"
    : finalizationState;
  const effectiveRequiresAuthenticatedSessionRestart =
    requiresAuthenticatedSessionRestart;
  const effectivePendingAction = staleAuthenticatedFinalizationState
    ? null
    : pendingAction;

  const flowDisabled = !ready || effectivePendingAction !== null;
  const phoneEntrySendCodeDisabled = effectivePendingAction !== null || !normalizedPhoneNumber;
  const showAuthenticatedLoadingState = authenticated && effectiveFinalizationState !== "idle";
  const allowAuthenticatedSessionStateUi = !suppressAuthenticatedSessionIssue;
  const showAuthenticatedManualResumeState =
    allowAuthenticatedSessionStateUi
    && !effectiveRequiresAuthenticatedSessionRestart
    && intent !== "link"
    && shouldShowHostedPrivyManualResumeState({
      authenticated,
      issue: authenticatedSessionIssue,
      showAuthenticatedLoadingState,
    });
  const showAuthenticatedRestartState =
    allowAuthenticatedSessionStateUi
    && intent !== "link"
    && (effectiveRequiresAuthenticatedSessionRestart || shouldShowHostedPrivyRestartState({
      authenticated,
      issue: authenticatedSessionIssue,
      showAuthenticatedLoadingState,
    }));
  const authenticatedView = effectivePendingAction === "verify-code"
    ? null
    : resolveHostedAuthenticatedPhoneAuthView({
      showAuthenticatedLoadingState,
      showAuthenticatedManualResumeState,
      showAuthenticatedRestartState,
    });
  const authenticatedLoadingTitle =
    intent === "link" ? "Saving your phone..." : "Finishing setup...";
  const authenticatedLoadingBody =
    intent === "link"
      ? "Keep this tab open. We are verifying your number and linking it to your account."
      : "Keep this tab open. We are verifying your number and preparing your account.";
  const authSession: HostedPrivyClientSessionInput = {
    authMethod: "phone",
    refreshUser,
    user,
  };

  const sharedFlowProps = {
    activeAttempt: phoneVerificationAttempt,
    code,
    disableSignup,
    disabled: flowDisabled,
    intent,
    phoneFieldDescription: null,
    phoneFieldLabel: null,
    pendingAction: effectivePendingAction,
    phoneCountryOptions: HOSTED_PHONE_COUNTRY_OPTIONS,
    phoneNumber,
    sendCodeDisabled: phoneEntrySendCodeDisabled,
    secondaryActionSize: "lg" as const,
    selectedPhoneCountry,
    onCodeChange: (value: string) => {
      setCode(normalizeHostedPhoneVerificationCode(value));
    },
    onPhoneCountryChange: (code: string) => {
      setQueuedPhoneCodeSend(null);
      setPhoneCountryCode(code);
    },
    onPhoneNumberChange: (value: string) => {
      setQueuedPhoneCodeSend(null);
      setPhoneNumber(value);
    },
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
    setRequiresAuthenticatedSessionRestart(false);
    updateFinalizationState("idle");
    setCode("");
    setPhoneVerificationAttempt(null);
    setQueuedPhoneCodeSend(null);
  }

  const submitVerificationCodeEffect = useEffectEvent((submittedCode: string) => {
    void handleVerifyCode(submittedCode);
  });
  const drainQueuedPhoneCodeSendEffect = useEffectEvent((queuedPhoneNumber: string) => {
    void runPhoneCodeSend(queuedPhoneNumber, {
      resetAuthenticatedSessionRestart: true,
    });
  });
  const activeQueuedPhoneCodeSend =
    intent !== "link" && authenticated ? null : queuedPhoneCodeSend;

  useEffect(() => {
    if (!authenticated) {
      completedUserRef.current = null;
      finalizationStateRef.current = "idle";
    }
  }, [authenticated]);

  useEffect(() => {
    if (!isHostedPhoneVerificationCodeComplete(normalizedVerificationCode)) {
      lastAutoSubmittedCodeRef.current = null;
      return;
    }

    if (
      !phoneVerificationAttempt
      || effectivePendingAction !== null
      || lastAutoSubmittedCodeRef.current === normalizedVerificationCode
    ) {
      return;
    }

    lastAutoSubmittedCodeRef.current = normalizedVerificationCode;
    submitVerificationCodeEffect(normalizedVerificationCode);
  }, [effectivePendingAction, normalizedVerificationCode, phoneVerificationAttempt]);

  useEffect(() => {
    if (!activeQueuedPhoneCodeSend || effectivePendingAction !== null) {
      return;
    }

    if (!ready) {
      return;
    }

    drainQueuedPhoneCodeSendEffect(activeQueuedPhoneCodeSend);
  }, [activeQueuedPhoneCodeSend, effectivePendingAction, ready]);

  async function handleSendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const submission = resolveHostedPhoneSubmission({
      countryDialCode: selectedPhoneCountry.dialCode,
      draftPhoneNumber: phoneNumber,
      submittedPhoneNumber: readSubmittedPhoneNumber(event),
    });

    if (submission.draftPhoneNumber !== phoneNumber) {
      setPhoneNumber(submission.draftPhoneNumber);
    }

    const nextPhoneNumber = submission.normalizedPhoneNumber;

    if (!nextPhoneNumber) {
      setErrorMessage(
        `Enter a valid phone number for ${selectedPhoneCountry.label}.`,
      );
      return;
    }

    if (!ready) {
      setErrorMessage(null);
      setRequiresAuthenticatedSessionRestart(false);
      setQueuedPhoneCodeSend(nextPhoneNumber);
      return;
    }

    await runPhoneCodeSend(nextPhoneNumber, {
      resetAuthenticatedSessionRestart: true,
    });
  }

  async function runPhoneCodeSend(
    nextPhoneNumber: string,
    {
      resetAuthenticatedSessionRestart = false,
    }: {
      resetAuthenticatedSessionRestart?: boolean;
    } = {},
  ) {
    if (phoneCodeSendInFlightRef.current) {
      return;
    }

    phoneCodeSendInFlightRef.current = true;
    setQueuedPhoneCodeSend(null);

    try {
      await runHostedPhonePendingAction({
        action: "send-code",
        onBeforeAction: () => {
          if (finalizationState !== "idle" || finalizationStateRef.current !== "idle") {
            updateFinalizationState("idle");
          }
          setErrorMessage(null);
          if (resetAuthenticatedSessionRestart) {
            setRequiresAuthenticatedSessionRestart(false);
          }
        },
        onError: (error) => {
          setErrorMessage(
            toErrorMessage(error, "We could not send a verification code."),
          );
        },
        run: () => sendVerificationCode(nextPhoneNumber),
        setPendingAction,
      });
    } finally {
      phoneCodeSendInFlightRef.current = false;
    }
  }

  async function sendVerificationCode(nextPhoneNumber: string) {
    try {
      await sendCode({
        phoneNumber: nextPhoneNumber,
        ...(disableSignup ? { disableSignup: true } : {}),
      });
    } catch (error) {
      if (!disableSignup) {
        throw error;
      }
    }

    setCode("");
    setPhoneVerificationAttempt(
      createHostedPhoneVerificationAttempt(nextPhoneNumber),
    );
    onCodeSent?.();
  }

  async function handleResendCode() {
    const resendTarget = resolveHostedPhoneResendTarget({
      phoneVerificationAttempt,
    });

    if (resendTarget.kind === "active-attempt") {
      if (!ready) {
        setErrorMessage(null);
        setQueuedPhoneCodeSend(resendTarget.phoneNumber);
        return;
      }

      await runPhoneCodeSend(resendTarget.phoneNumber);
      return;
    }

    await handleSendCode();
  }

  async function handleVerifyCode(submittedCode = normalizedVerificationCode) {
    setErrorMessage(null);

    if (!phoneVerificationAttempt) {
      setErrorMessage(
        "Request a fresh verification code before entering one here.",
      );
      return;
    }

    if (!submittedCode) {
      setErrorMessage("Enter the verification code we texted you.");
      return;
    }

    setPendingAction("verify-code");

    try {
      await loginWithCode({ code: submittedCode });
      await runHostedPrivyFinalization(intent === "link" ? "continue" : "verify-code");
    } catch (error) {
      if (disableSignup) {
        setErrorMessage("We could not verify that code.");
        return;
      }

      if (isHostedPrivyAccountConflictError(error)) {
        transitionToAuthenticatedSessionRestart();
        setCode("");
        setPhoneVerificationAttempt(null);
        return;
      }

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
      if (isHostedPrivyAccountConflictError(error)) {
        transitionToAuthenticatedSessionRestart();
        return;
      }

      const latestSessionIssue = resolveHostedPrivyClientSessionIssue(
        readHostedPrivyClientSessionState({ user }),
      );
      if (!canContinueHostedPrivyClientSession(latestSessionIssue)) {
        return;
      }

      setErrorMessage(
        toErrorMessage(error, "We could not continue with your Privy session."),
      );
    }
  }

  async function handleLogout() {
    await runHostedPhonePendingAction({
      action: "logout",
      onBeforeAction: () => {
        setErrorMessage(null);
        updateFinalizationState("idle");
      },
      onError: (error) => {
        setErrorMessage(
          toErrorMessage(error, "We could not sign you out cleanly."),
        );
      },
      run: async () => {
        await logout();
        await onSignOut?.();
        resetPhoneAuthFlow();
        setPhoneCountryCode(initialPhoneCountryCode);
        setPhoneNumber("");
      },
      setPendingAction,
    });
  }

  function handleResetPhoneAuthFlow() {
    resetPhoneAuthFlow();
  }

  function transitionToAuthenticatedSessionRestart() {
    setErrorMessage(null);
    setRequiresAuthenticatedSessionRestart(true);
  }

  async function runHostedPrivyFinalization(
    action: "continue" | "verify-code",
  ) {
    await runHostedPrivyFinalizationAttempt({
      action,
      finalize: async () => {
        if (intent === "link") {
          await finalizeHostedPhoneLink({
            onLinked,
          });
          return;
        }

        await finalizeHostedPrivyVerification({
          completedUser: completedUserRef.current,
          inviteCode,
          onAuthCompleted,
          onCompleted,
          ...authSession,
        });
      },
      getFinalizationState: () => finalizationStateRef.current,
      setPendingAction,
      updateFinalizationState,
    });
  }

  return {
    authenticatedLoadingBody,
    authenticatedLoadingTitle,
    authenticatedSessionDescription: effectiveRequiresAuthenticatedSessionRestart
      ? "This browser is signed into a different Murph account. Sign out, then verify the phone number you want to use."
      : describeHostedPrivyClientSessionIssue(authenticatedSessionIssue)
        ?? "Sign out and request a fresh code to continue.",
    authenticatedView,
    errorMessage,
    flowDisabled,
    pendingAction: effectivePendingAction,
    privyReady: ready,
    sharedFlowProps,
    handleContinueAuthenticated,
    handleLogout,
    handleResetPhoneAuthFlow,
    handleResendCode,
    resetPhoneAuthFlow,
    sendVerificationCode,
    setErrorMessage,
    setPendingAction,
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

function resolveInitialHostedPhoneCountryCode(input: {
  countryCodeHint: string | null | undefined;
}): string {
  const fallbackOption =
    resolveHostedPhoneCountryOption(input.countryCodeHint)
    ?? resolveHostedPhoneCountryOption(DEFAULT_HOSTED_PHONE_COUNTRY_CODE)
    ?? HOSTED_PHONE_COUNTRY_OPTIONS[0];
  return fallbackOption.code;
}

function resolveHostedPhoneCountryOption(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().toUpperCase();

  return (
    HOSTED_PHONE_COUNTRY_OPTIONS.find((option) => option.code === normalized)
    ?? null
  );
}
