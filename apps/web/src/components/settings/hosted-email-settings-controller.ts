import { usePrivy, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

import type { HostedPrivyEmailAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedPrivyEmailAccountVerified, resolveHostedPrivyLinkedAccounts } from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isValidEmailAddress,
  normalizeComparableEmail,
  normalizeEmailAddress,
  resolveHostedEmailSettingsDisplayState,
  syncHostedVerifiedEmailAddress,
} from "./hosted-email-settings-helpers";
import { toErrorMessage } from "./hosted-settings-utils";

export function useHostedEmailSettingsController() {
  const { authenticated, logout, ready } = usePrivy();
  const { refreshUser, user } = useUser();
  const { sendCode, state, verifyCode } = useUpdateEmail();
  const [code, setCode] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingEmailRoute, setIsSyncingEmailRoute] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verifiedEmailOverride, setVerifiedEmailOverride] = useState<HostedPrivyEmailAccount | null>(null);

  const linkedAccounts = resolveHostedPrivyLinkedAccounts(user);
  const displayState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts,
    verifiedEmailOverride,
  });
  const effectiveCurrentEmail = displayState.currentEmail;
  const effectiveVerifiedEmail = displayState.currentVerifiedEmail;
  const normalizedCurrentEmail = displayState.normalizedCurrentEmail;
  const canManageEmail = ready && authenticated && Boolean(user);
  const isLoadingAuthenticatedUser = ready && authenticated && !user;
  const isAwaitingCode = state.status === "awaiting-code-input";
  const isSendingCode = state.status === "sending-code";
  const isSubmittingCode = state.status === "submitting-code";
  const isBusy = isSendingCode || isSubmittingCode || isSyncingEmailRoute;

  useEffect(() => {
    if (!emailAddress && effectiveCurrentEmail?.address) {
      setEmailAddress(effectiveCurrentEmail.address);
    }
  }, [effectiveCurrentEmail?.address, emailAddress]);

  useEffect(() => {
    if (isAwaitingCode || isSubmittingCode) {
      setDialogOpen(true);
    }
  }, [isAwaitingCode, isSubmittingCode]);

  async function requestCodeForEmail(nextEmailAddress: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!ready) {
      setErrorMessage("We are still loading your Privy session. Try again in a moment.");
      return;
    }

    if (!authenticated) {
      setErrorMessage("Sign in with your existing hosted account before you try to link an email address.");
      return;
    }

    if (!user) {
      setErrorMessage("We are still loading your account details. Try again in a moment.");
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
      await sendCode({ newEmailAddress: nextEmailAddress });
      setPendingEmailAddress(nextEmailAddress);
      setDialogOpen(true);
      setCode("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code to that email address."));
    }
  }

  async function handleSendCode() {
    const nextEmailAddress = normalizeEmailAddress(emailAddress);

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleResendCode() {
    const nextEmailAddress = normalizeEmailAddress(emailAddress) ?? pendingEmailAddress;

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleVerifyCode() {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedCode = code.trim();

    if (!normalizedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    let verifiedEmailAddress: string | null = null;

    try {
      const result = await verifyCode({ code: normalizedCode });
      const nextUser = result?.user ?? user;
      const nextEmail = resolveHostedEmailSettingsDisplayState({
        linkedAccounts: resolveHostedPrivyLinkedAccounts(nextUser),
      }).currentVerifiedEmail;

      verifiedEmailAddress = nextEmail?.address ?? pendingEmailAddress ?? normalizeEmailAddress(emailAddress);

      setCode("");
      setDialogOpen(false);
      setPendingEmailAddress(null);
      setEmailAddress(verifiedEmailAddress ?? emailAddress);

      if (verifiedEmailAddress) {
        setVerifiedEmailOverride({
          address: verifiedEmailAddress,
          verifiedAt: nextEmail?.verifiedAt ?? Math.trunc(Date.now() / 1000),
        });
      }

      await refreshUser().catch(() => null);
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
      return;
    }

    if (!verifiedEmailAddress) {
      setSuccessMessage("Email verified.");
      return;
    }

    await syncVerifiedEmailAddress(verifiedEmailAddress, "verify");
  }

  async function handleSyncVerifiedEmail() {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!effectiveVerifiedEmail?.address) {
      setErrorMessage("Verify an email address before you try to sync it.");
      return;
    }

    await syncVerifiedEmailAddress(effectiveVerifiedEmail.address, "resync");
  }

  async function handleLogout() {
    setErrorMessage(null);
    setLoggingOut(true);

    try {
      await logout();
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not sign out of the current Privy session."));
    } finally {
      setLoggingOut(false);
    }
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
    } finally {
      setIsSyncingEmailRoute(false);
    }
  }

  return {
    authenticated,
    canManageEmail,
    code,
    dialogOpen,
    effectiveCurrentEmail,
    effectiveVerifiedEmail,
    emailAddress,
    errorMessage,
    isBusy,
    isLoadingAuthenticatedUser,
    isSendingCode,
    isSubmittingCode,
    isSyncingEmailRoute,
    loggingOut,
    pendingEmailAddress,
    ready,
    successMessage,
    setCode,
    setDialogOpen,
    setEmailAddress,
    handleLogout,
    handleResendCode,
    handleSendCode,
    handleSyncVerifiedEmail,
    handleVerifyCode,
  };
}
