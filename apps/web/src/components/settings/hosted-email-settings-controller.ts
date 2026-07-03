import { useLinkAccount, usePrivy, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useRef, useState } from "react";

import type {
  HostedPrivyEmailAccount,
  PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";
import {
  isHostedPrivyEmailAccountVerified,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isValidEmailAddress,
  normalizeComparableEmail,
  normalizeEmailAddress,
  resolveHostedEmailSettingsDisplayState,
  type HostedEmailSettingsDisplayState,
  syncHostedVerifiedEmailAddress,
  type HostedEmailSyncResult,
} from "./hosted-email-settings-helpers";
import { toErrorMessage } from "./hosted-settings-utils";

export interface HostedEmailSettingsInitialEmail {
  address: string;
  verifiedAt: number | null;
}

export function useHostedEmailSettingsController(input: {
  authenticated: boolean;
  initialEmail: HostedEmailSettingsInitialEmail | null;
  /** Called when the member dismisses Privy's link modal without linking. */
  onPrivyLinkAborted?: () => void;
  onSynced?: (payload: HostedEmailSyncResult) => Promise<void> | void;
}) {
  const { refreshUser, user: privyUser } = useUser();
  const { ready: privyReady } = usePrivy();
  const linkedAccounts = toInitialEmailLinkedAccounts(input.initialEmail);
  const baseDisplayState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts,
  });
  const [code, setCode] = useState("");
  const [emailAddress, setEmailAddress] = useState(() => baseDisplayState.currentEmail?.address ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingEmailRoute, setIsSyncingEmailRoute] = useState(false);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verifiedEmailOverride, setVerifiedEmailOverride] = useState<HostedPrivyEmailAccount | null>(null);
  const updateEmailErrorRef = useRef(false);
  const updateEmailErrorCodeRef = useRef<string | null>(null);
  const { sendCode, state, verifyCode } = useUpdateEmail({
    onError: (error) => {
      updateEmailErrorRef.current = true;
      updateEmailErrorCodeRef.current = typeof error === "string" ? error : null;
      console.error("[hosted-email-settings] Privy update email error:", error);
    },
  });
  const [isPrivyLinkModalActive, setIsPrivyLinkModalActive] = useState(false);
  const { linkEmail } = useLinkAccount({
    onError: (error) => {
      setIsPrivyLinkModalActive(false);

      // Closing the Privy modal is a cancel, not a failure.
      if (error === "exited_link_flow") {
        input.onPrivyLinkAborted?.();
        return;
      }

      setErrorMessage("We could not link that email address.");
    },
    onSuccess: (params) => {
      setIsPrivyLinkModalActive(false);
      if (params.linkMethod === "email") {
        void handleLinkedEmailAccount({
          linkedUser: params.user,
          preferredEmailAddress: readLinkedEmailAddress(params.linkedAccount),
        });
      }
    },
  });

  const overrideDisplayState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts,
    verifiedEmailOverride,
  });
  const effectiveCurrentEmail = overrideDisplayState.currentEmail;
  const effectiveVerifiedEmail = overrideDisplayState.currentVerifiedEmail;
  const normalizedCurrentEmail = overrideDisplayState.normalizedCurrentEmail;
  const canManageEmail = input.authenticated;
  const canSendEmailUpdateCode = Boolean(effectiveCurrentEmail?.address);
  // Privy's headless update-email flow refuses to send a code unless the
  // Privy user already has an email linked; otherwise we must link instead,
  // which Privy only supports through its own modal.
  const canUpdatePrivyEmail = Boolean(privyUser?.email?.address);
  const isSendingCode = state.status === "sending-code";
  const isSubmittingCode = state.status === "submitting-code";
  const isBusy = !privyReady || isSendingCode || isSubmittingCode || isSyncingEmailRoute;

  async function requestCodeForEmail(nextEmailAddress: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!input.authenticated) {
      setErrorMessage("Sign in to your Murph account first, then link your email.");
      return;
    }

    if (!isValidEmailAddress(nextEmailAddress)) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (
      normalizeComparableEmail(nextEmailAddress) === normalizedCurrentEmail
      && isHostedPrivyEmailAccountVerified(effectiveCurrentEmail)
    ) {
      setErrorMessage("That email address is already linked to this account.");
      return;
    }

    try {
      updateEmailErrorRef.current = false;
      updateEmailErrorCodeRef.current = null;
      await sendCode({ newEmailAddress: nextEmailAddress });

      if (updateEmailErrorRef.current) {
        throw new Error(formatUpdateEmailErrorMessage(
          "We could not send a verification code to that email address.",
          updateEmailErrorCodeRef.current,
        ));
      }

      setPendingEmailAddress(nextEmailAddress);
      setCode("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code to that email address."));
    }
  }

  async function handleSendCode(rawEmailAddress?: string) {
    if (!canSendEmailUpdateCode || !canUpdatePrivyEmail) {
      handleLinkEmail();
      return;
    }

    const nextEmailAddress = normalizeEmailAddress(rawEmailAddress ?? emailAddress);

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (nextEmailAddress !== emailAddress) {
      setEmailAddress(nextEmailAddress);
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleResendCode() {
    // Resend only renders in the code-entry step, where a pending email
    // address is always set; bail quietly if that invariant ever breaks.
    if (!pendingEmailAddress) {
      return;
    }

    await requestCodeForEmail(pendingEmailAddress);
  }

  function handleUseAnotherEmail() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setCode("");
    setPendingEmailAddress(null);
  }

  async function handleVerifyCode(rawCode?: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedCode = (rawCode ?? code).trim();

    if (!normalizedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    let verifiedEmailAddress: string | null = null;

    try {
      updateEmailErrorRef.current = false;
      const updateResult = await verifyCode({ code: normalizedCode });

      if (updateEmailErrorRef.current || !updateResult?.user) {
        throw new Error("We could not verify that code.");
      }

      const refreshedUser = await refreshUser().catch(() => updateResult.user);
      const displayState = resolveHostedEmailSettingsDisplayStateFromUsers({
        fallbackUser: updateResult.user,
        initialLinkedAccounts: linkedAccounts,
        preferredEmailAddress: pendingEmailAddress ?? emailAddress,
        refreshedUser,
      });
      const nextEmail = displayState.currentVerifiedEmail;

      verifiedEmailAddress = nextEmail?.address ?? pendingEmailAddress ?? normalizeEmailAddress(emailAddress);

      setCode("");
      setPendingEmailAddress(null);
      setEmailAddress(verifiedEmailAddress ?? emailAddress);

      if (verifiedEmailAddress) {
        setVerifiedEmailOverride({
          address: verifiedEmailAddress,
          verifiedAt: nextEmail?.verifiedAt ?? readCurrentUnixTimestamp(),
        });
      }
    } catch (error) {
      setCode("");
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
      return;
    }

    if (!verifiedEmailAddress) {
      setSuccessMessage("Email verified.");
      return;
    }

    await syncVerifiedEmailAddress(verifiedEmailAddress, "verify");
  }

  function handleLinkEmail() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setCode("");
    setPendingEmailAddress(null);

    if (!input.authenticated) {
      setErrorMessage("Sign in to your Murph account first, then link your email.");
      return;
    }

    setIsPrivyLinkModalActive(true);
    linkEmail();
  }

  async function handleLinkedEmailAccount(input: {
    linkedUser: HostedEmailPrivyUser;
    preferredEmailAddress: string | null;
  }) {
    const { linkedUser } = input;
    const refreshedUser = await refreshUser().catch(() => linkedUser);
    const displayState = resolveHostedEmailSettingsDisplayStateFromUsers({
      fallbackUser: linkedUser,
      initialLinkedAccounts: linkedAccounts,
      preferredEmailAddress: input.preferredEmailAddress,
      refreshedUser,
    });
    const linkedEmail = displayState.currentVerifiedEmail ?? displayState.currentEmail;

    if (!linkedEmail?.address) {
      setSuccessMessage("Email linked.");
      return;
    }

    setEmailAddress(linkedEmail.address);

    if (!displayState.currentVerifiedEmail) {
      setSuccessMessage(`Email linked: ${linkedEmail.address}`);
      return;
    }

    setVerifiedEmailOverride(displayState.currentVerifiedEmail);
    await syncVerifiedEmailAddress(displayState.currentVerifiedEmail.address, "verify");
  }

  async function handleSyncVerifiedEmail() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!effectiveVerifiedEmail?.address) {
      setErrorMessage("Verify your email address first.");
      return;
    }

    await syncVerifiedEmailAddress(effectiveVerifiedEmail.address, "resync");
  }

  async function syncVerifiedEmailAddress(verifiedEmailAddress: string, mode: "resync" | "verify") {
    setIsSyncingEmailRoute(true);

    try {
      const syncPresentation = await syncHostedVerifiedEmailAddress({
        mode,
        verifiedEmailAddress,
      });
      setSuccessMessage(syncPresentation.successMessage);
      setErrorMessage(syncPresentation.errorMessage);

      if (syncPresentation.syncResult) {
        try {
          await input.onSynced?.(syncPresentation.syncResult);
        } catch (error) {
          setErrorMessage(toErrorMessage(error, "Your email is connected, but the page didn't refresh. Reload to see it."));
        }
      }
    } finally {
      setIsSyncingEmailRoute(false);
    }
  }

  return {
    authenticated: input.authenticated,
    canManageEmail,
    code,
    effectiveCurrentEmail,
    effectiveVerifiedEmail,
    emailAddress,
    errorMessage,
    isBusy,
    isPrivyLinkModalActive,
    isSendingCode,
    isSubmittingCode,
    isSyncingEmailRoute,
    canSendEmailUpdateCode,
    pendingEmailAddress,
    successMessage,
    setCode,
    setEmailAddress,
    handleLinkEmail,
    handleResendCode,
    handleSendCode,
    handleSyncVerifiedEmail,
    handleUseAnotherEmail,
    handleVerifyCode,
  };
}

type HostedEmailPrivyUser = { linkedAccounts?: unknown } | null | undefined;

function formatUpdateEmailErrorMessage(baseMessage: string, errorCode: string | null): string {
  return errorCode ? `${baseMessage} (${errorCode})` : baseMessage;
}

function resolveHostedEmailSettingsDisplayStateFromUsers(input: {
  fallbackUser: HostedEmailPrivyUser;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
  preferredEmailAddress?: string | null;
  refreshedUser: HostedEmailPrivyUser;
}): HostedEmailSettingsDisplayState {
  const preferredEmailAddress = normalizeComparableEmail(input.preferredEmailAddress);
  const refreshedState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts: readPrivyLinkedAccounts(input.refreshedUser) ?? [],
  });
  const fallbackState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts: readPrivyLinkedAccounts(input.fallbackUser) ?? [],
  });

  if (doesEmailDisplayStateMatch(refreshedState, preferredEmailAddress)) {
    return refreshedState;
  }

  if (doesEmailDisplayStateMatch(fallbackState, preferredEmailAddress)) {
    return fallbackState;
  }

  if (hasEmailDisplayState(refreshedState)) {
    return refreshedState;
  }

  if (hasEmailDisplayState(fallbackState)) {
    return fallbackState;
  }

  return resolveHostedEmailSettingsDisplayState({
    linkedAccounts: input.initialLinkedAccounts,
  });
}

function doesEmailDisplayStateMatch(
  state: HostedEmailSettingsDisplayState,
  preferredEmailAddress: string | null,
): boolean {
  if (!preferredEmailAddress) {
    return hasEmailDisplayState(state);
  }

  const email = state.currentVerifiedEmail ?? state.currentEmail;

  return normalizeComparableEmail(email?.address) === preferredEmailAddress;
}

function hasEmailDisplayState(state: HostedEmailSettingsDisplayState): boolean {
  return Boolean(state.currentVerifiedEmail ?? state.currentEmail);
}

function readCurrentUnixTimestamp(): number {
  return Math.trunc(Date.now() / 1000);
}

function readPrivyLinkedAccounts(input: HostedEmailPrivyUser): readonly PrivyLinkedAccountLike[] | null {
  if (!Array.isArray(input?.linkedAccounts)) {
    return null;
  }

  return input.linkedAccounts.filter(isPrivyLinkedAccountLike);
}

function readLinkedEmailAddress(input: unknown): string | null {
  if (!isPrivyLinkedAccountLike(input)) {
    return null;
  }

  return typeof input.address === "string" ? input.address : null;
}

function isPrivyLinkedAccountLike(value: unknown): value is PrivyLinkedAccountLike {
  return typeof value === "object" && value !== null;
}

function toInitialEmailLinkedAccounts(
  initialEmail: HostedEmailSettingsInitialEmail | null,
): readonly PrivyLinkedAccountLike[] {
  if (!initialEmail?.address) {
    return [];
  }

  return [
    {
      address: initialEmail.address,
      latest_verified_at: initialEmail.verifiedAt,
      type: "email",
    },
  ];
}
