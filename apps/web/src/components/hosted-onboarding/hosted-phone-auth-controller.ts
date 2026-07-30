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
  readHostedPrivyClientSessionState,
  type HostedPrivyClientPendingAction,
  type HostedPrivyFinalizationState,
} from "@/src/lib/hosted-onboarding/privy-client";
import { normalizePhoneNumberForCountry } from "@/src/lib/hosted-onboarding/phone";
import type { HostedPrivyCompletionPayload } from "@/src/lib/hosted-onboarding/types";
import type { PhoneNumberInputChangeMetadata } from "@/src/components/ui/phone-number-input";

import {
  createHostedPhoneVerificationAttempt,
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
  HostedPhoneVerificationAttempt,
} from "./hosted-phone-auth-types";

interface HostedPhoneAuthControllerInput {
  autoSendPastedPhoneNumber?: boolean;
  disableSignup?: boolean;
  inviteCode?: string | null;
  interactionGated?: boolean;
  onAuthCancel?: () => void;
  onAuthQueue?: () => boolean;
  onAuthQueueCancel?: () => void;
  onAuthStart?: () => boolean;
  onAuthenticated?: (input: { authMethod: "phone" }) => Promise<void> | void;
  onCodeSent?: () => void;
  onCompleted?: (payload: HostedPrivyCompletionPayload) => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
  suppressAuthenticatedSessionIssue?: boolean;
}

const DEFAULT_HOSTED_PHONE_COUNTRY_CODE = "US";

export function useHostedPhoneAuthController({
  autoSendPastedPhoneNumber = false,
  disableSignup = false,
  inviteCode,
  interactionGated = false,
  onAuthCancel,
  onAuthQueue,
  onAuthQueueCancel,
  onAuthStart,
  onAuthenticated,
  onCodeSent,
  onCompleted,
  onSignOut,
  suppressAuthenticatedSessionIssue = false,
}: HostedPhoneAuthControllerInput) {
  const { authenticated, logout, ready } = usePrivy();
  const { loginWithCode, sendCode } = useLoginWithSms();
  const { user } = useUser();
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
  const queuedPhoneCodeSendRef = useRef<string | null>(null);
  const interactionGatedRef = useRef(interactionGated);
  interactionGatedRef.current = interactionGated;

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
  const authenticatedSessionState = useMemo(() => {
    if (suppressAuthenticatedSessionIssue) {
      return null;
    }

    return readHostedPrivyClientSessionState({ user });
  }, [suppressAuthenticatedSessionIssue, user]);
  const authenticatedSessionMissingPhone =
    authenticatedSessionState !== null && !authenticatedSessionState.phone;
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

  const activeQueuedPhoneCodeSend = authenticated ? null : queuedPhoneCodeSend;
  const presentedPendingAction =
    activeQueuedPhoneCodeSend !== null
      ? "send-code"
      : effectivePendingAction;
  const flowDisabled =
    interactionGated
    || activeQueuedPhoneCodeSend !== null
    || effectivePendingAction !== null;
  const phoneEntrySendCodeDisabled =
    interactionGated
    || activeQueuedPhoneCodeSend !== null
    || effectivePendingAction !== null
    || !normalizedPhoneNumber;
  const keepDelegatedVerificationMounted =
    onAuthenticated !== undefined
    && effectivePendingAction === "verify-code"
    && phoneVerificationAttempt !== null;
  const showPhoneVerificationLoadingState =
    onAuthenticated === undefined
    && authenticated
    && effectivePendingAction === "verify-code";
  const showAuthenticatedLoadingState =
    authenticated
    && (effectiveFinalizationState !== "idle" || showPhoneVerificationLoadingState);
  const allowAuthenticatedSessionStateUi = !suppressAuthenticatedSessionIssue;
  const showAuthenticatedManualResumeState =
    allowAuthenticatedSessionStateUi
    && !effectiveRequiresAuthenticatedSessionRestart
    && authenticated
    && !showAuthenticatedLoadingState
    && !keepDelegatedVerificationMounted
    && !authenticatedSessionMissingPhone;
  const showAuthenticatedRestartState =
    allowAuthenticatedSessionStateUi
    && (effectiveRequiresAuthenticatedSessionRestart
      || (authenticated && !showAuthenticatedLoadingState && authenticatedSessionMissingPhone));
  const authenticatedView = resolveHostedAuthenticatedPhoneAuthView({
    showAuthenticatedLoadingState,
    showAuthenticatedManualResumeState,
    showAuthenticatedRestartState,
  });
  const authenticatedLoadingTitle = "Finishing setup...";
  const authenticatedLoadingBody =
    "Keep this tab open. We are verifying your number and preparing your account.";
  const sharedFlowProps = {
    activeAttempt: phoneVerificationAttempt,
    code,
    disableSignup,
    disabled: flowDisabled,
    phoneFieldDescription: null,
    phoneFieldLabel: null,
    phoneInputDisabled: interactionGated,
    pendingAction: presentedPendingAction,
    phoneCountryOptions: HOSTED_PHONE_COUNTRY_OPTIONS,
    phoneNumber,
    sendCodeDisabled: phoneEntrySendCodeDisabled,
    secondaryActionSize: "lg" as const,
    selectedPhoneCountry,
    onCodeChange: (value: string) => {
      if (interactionGatedRef.current) return;
      setCode(normalizeHostedPhoneVerificationCode(value));
    },
    onPhoneCountryChange: (code: string) => {
      if (interactionGatedRef.current || phoneCodeSendInFlightRef.current) return;
      cancelQueuedPhoneCodeSend();
      setPhoneCountryCode(code);
    },
    onPhoneNumberChange: (
      value: string,
      metadata?: PhoneNumberInputChangeMetadata,
    ) => {
      if (interactionGatedRef.current || phoneCodeSendInFlightRef.current) return;
      cancelQueuedPhoneCodeSend();
      setPhoneNumber(value);

      if (
        !autoSendPastedPhoneNumber
        || !metadata?.autoSendCandidate
        || authenticated
        || phoneVerificationAttempt !== null
        || effectivePendingAction !== null
      ) {
        return;
      }

      const candidateCountry = resolveHostedPhoneCountryOption(
        metadata.countryCode,
      );
      const candidatePhoneNumber = candidateCountry
        ? normalizePhoneNumberForCountry(value, candidateCountry.dialCode)
        : null;

      if (candidatePhoneNumber) {
        void requestPhoneCodeSend(candidatePhoneNumber, {
          resetAuthenticatedSessionRestart: true,
        });
      }
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
    clearQueuedPhoneCodeSend();
  }

  const submitVerificationCodeEffect = useEffectEvent((submittedCode: string) => {
    void handleVerifyCode(submittedCode);
  });
  const drainQueuedPhoneCodeSendEffect = useEffectEvent((queuedPhoneNumber: string) => {
    void runPhoneCodeSend(queuedPhoneNumber, {
      resetAuthenticatedSessionRestart: true,
    });
  });
  const dropQueuedPhoneCodeSendEffect = useEffectEvent(() => {
    if (queuedPhoneCodeSendRef.current === null) return;
    clearQueuedPhoneCodeSend();
    if (onAuthQueueCancel) {
      onAuthQueueCancel();
      return;
    }
    onAuthCancel?.();
  });

  useEffect(() => {
    if (!authenticated) {
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
      || interactionGated
      || effectivePendingAction !== null
      || lastAutoSubmittedCodeRef.current === normalizedVerificationCode
    ) {
      return;
    }

    lastAutoSubmittedCodeRef.current = normalizedVerificationCode;
    submitVerificationCodeEffect(normalizedVerificationCode);
  }, [
    effectivePendingAction,
    interactionGated,
    normalizedVerificationCode,
    phoneVerificationAttempt,
  ]);

  useEffect(() => {
    if (queuedPhoneCodeSend && !activeQueuedPhoneCodeSend) {
      dropQueuedPhoneCodeSendEffect();
    }
  }, [activeQueuedPhoneCodeSend, queuedPhoneCodeSend]);

  useEffect(() => {
    if (
      interactionGated
      || !activeQueuedPhoneCodeSend
      || effectivePendingAction !== null
    ) {
      return;
    }

    if (!ready) {
      return;
    }

    drainQueuedPhoneCodeSendEffect(activeQueuedPhoneCodeSend);
  }, [activeQueuedPhoneCodeSend, effectivePendingAction, interactionGated, ready]);

  async function handleSendCode(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (interactionGatedRef.current) return;

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

    await requestPhoneCodeSend(nextPhoneNumber, {
      resetAuthenticatedSessionRestart: true,
    });
  }

  async function requestPhoneCodeSend(
    nextPhoneNumber: string,
    {
      resetAuthenticatedSessionRestart = false,
    }: {
      resetAuthenticatedSessionRestart?: boolean;
    } = {},
  ) {
    if (!ready) {
      queuePhoneCodeSend(nextPhoneNumber);
      return;
    }

    await runPhoneCodeSend(nextPhoneNumber, {
      resetAuthenticatedSessionRestart,
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
    if (
      interactionGatedRef.current
      || phoneCodeSendInFlightRef.current
    ) {
      return;
    }
    if (onAuthStart && !onAuthStart()) {
      cancelQueuedPhoneCodeSend();
      return;
    }

    phoneCodeSendInFlightRef.current = true;
    clearQueuedPhoneCodeSend();

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
          onAuthCancel?.();
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

    if (interactionGatedRef.current) {
      onAuthCancel?.();
      return;
    }

    setCode("");
    setPhoneVerificationAttempt(
      createHostedPhoneVerificationAttempt(nextPhoneNumber),
    );
    onCodeSent?.();
  }

  async function handleResendCode() {
    if (interactionGatedRef.current) return;

    const resendTarget = resolveHostedPhoneResendTarget({
      phoneVerificationAttempt,
    });

    if (resendTarget.kind === "active-attempt") {
      await requestPhoneCodeSend(resendTarget.phoneNumber);
      return;
    }

    await handleSendCode();
  }

  async function handleVerifyCode(submittedCode = normalizedVerificationCode) {
    if (interactionGatedRef.current) return;

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

    if (onAuthStart && !onAuthStart()) {
      return;
    }

    setPendingAction("verify-code");
    let preservePendingAction = false;

    try {
      await loginWithCode({ code: submittedCode });
      await runHostedPrivyFinalization("verify-code");
      preservePendingAction = onAuthenticated !== undefined;
    } catch (error) {
      onAuthCancel?.();
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
      if (!preservePendingAction && finalizationStateRef.current === "idle") {
        setPendingAction(null);
      }
    }
  }

  async function handleContinueAuthenticated() {
    if (
      interactionGatedRef.current
      || (onAuthStart && !onAuthStart())
    ) {
      return;
    }

    setErrorMessage(null);

    try {
      await runHostedPrivyFinalization("continue");
    } catch (error) {
      onAuthCancel?.();
      if (isHostedPrivyAccountConflictError(error)) {
        transitionToAuthenticatedSessionRestart();
        return;
      }

      const latestSessionState = readHostedPrivyClientSessionState({ user });
      if (latestSessionState !== null && !latestSessionState.phone) {
        return;
      }

      setErrorMessage(
        toErrorMessage(error, "We couldn't finish signing you in. Try again."),
      );
    }
  }

  async function handleLogout() {
    if (interactionGatedRef.current) return;

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
        onAuthCancel?.();
        resetPhoneAuthFlow();
        setPhoneCountryCode(initialPhoneCountryCode);
        setPhoneNumber("");
      },
      setPendingAction,
    });
  }

  function handleResetPhoneAuthFlow() {
    if (interactionGatedRef.current) return;
    if (queuedPhoneCodeSendRef.current !== null) {
      cancelQueuedPhoneCodeSend();
    } else {
      onAuthCancel?.();
    }
    resetPhoneAuthFlow();
  }

  function transitionToAuthenticatedSessionRestart() {
    setErrorMessage(null);
    setRequiresAuthenticatedSessionRestart(true);
  }

  async function runHostedPrivyFinalization(
    action: "continue" | "verify-code",
  ) {
    if (onAuthenticated) {
      setPendingAction(action);
      try {
        await onAuthenticated({ authMethod: "phone" });
      } catch (error) {
        setPendingAction(null);
        throw error;
      }
      return;
    }

    await runHostedPrivyFinalizationAttempt({
      action,
      finalize: async () => {
        await finalizeHostedPrivyVerification({
          inviteCode,
          onCompleted,
        });
      },
      getFinalizationState: () => finalizationStateRef.current,
      setPendingAction,
      updateFinalizationState,
    });
  }

  function queuePhoneCodeSend(nextPhoneNumber: string) {
    if (
      interactionGatedRef.current
      || phoneCodeSendInFlightRef.current
      || queuedPhoneCodeSendRef.current !== null
      || (onAuthQueue
        ? !onAuthQueue()
        : onAuthStart
          ? !onAuthStart()
          : false)
    ) {
      return;
    }

    setErrorMessage(null);
    setRequiresAuthenticatedSessionRestart(false);
    queuedPhoneCodeSendRef.current = nextPhoneNumber;
    setQueuedPhoneCodeSend(nextPhoneNumber);
  }

  function clearQueuedPhoneCodeSend() {
    queuedPhoneCodeSendRef.current = null;
    setQueuedPhoneCodeSend(null);
  }

  function cancelQueuedPhoneCodeSend() {
    if (queuedPhoneCodeSendRef.current === null) return;
    clearQueuedPhoneCodeSend();
    if (onAuthQueueCancel) {
      onAuthQueueCancel();
      return;
    }
    onAuthCancel?.();
  }

  return {
    authenticatedLoadingBody,
    authenticatedLoadingTitle,
    authenticatedSessionDescription: effectiveRequiresAuthenticatedSessionRestart
      ? "This browser is signed into a different Murph account. Sign out, then verify the phone number you want to use."
      : authenticatedSessionMissingPhone
        ? "Your sign-in doesn't have a verified phone number yet. Sign out, then verify your number by text."
        : "Sign out and request a fresh code to continue.",
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
