import { useLinkAccount, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";

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
  syncHostedVerifiedEmailAddress,
} from "./hosted-email-settings-helpers";
import { toErrorMessage } from "./hosted-settings-utils";

export function useHostedEmailSettingsController(input: {
  authenticated: boolean;
  initialLinkedAccounts: readonly PrivyLinkedAccountLike[];
}) {
  const { refreshUser, user } = useUser();
  const linkedAccounts = readPrivyLinkedAccounts(user) ?? input.initialLinkedAccounts;
  const baseDisplayState = resolveHostedEmailSettingsDisplayState({
    linkedAccounts,
  });
  const [code, setCode] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailAddress, setEmailAddress] = useState(() => baseDisplayState.currentEmail?.address ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingEmailRoute, setIsSyncingEmailRoute] = useState(false);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verifiedEmailOverride, setVerifiedEmailOverride] = useState<HostedPrivyEmailAccount | null>(null);
  const updateEmailErrorRef = useRef(false);
  const { sendCode, state, verifyCode } = useUpdateEmail({
    onError: () => {
      updateEmailErrorRef.current = true;
    },
  });
  const { linkEmail } = useLinkAccount({
    onError: () => {
      setErrorMessage("We could not link that email address.");
    },
    onSuccess: (params) => {
      if (params.linkMethod === "email") {
        void handleLinkedEmailAccount(params.user);
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
  const isAwaitingCode = state.status === "awaiting-code-input";
  const isSendingCode = state.status === "sending-code";
  const isSubmittingCode = state.status === "submitting-code";
  const isBusy = isSendingCode || isSubmittingCode || isSyncingEmailRoute;

  useEffect(() => {
    if (isAwaitingCode || isSubmittingCode) {
      setDialogOpen(true);
    }
  }, [isAwaitingCode, isSubmittingCode]);

  async function requestCodeForEmail(nextEmailAddress: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!input.authenticated) {
      setErrorMessage("Sign in with your existing hosted account before you try to link an email address.");
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
      await sendCode({ newEmailAddress: nextEmailAddress });

      if (updateEmailErrorRef.current) {
        throw new Error("We could not send a verification code to that email address.");
      }

      setPendingEmailAddress(nextEmailAddress);
      setDialogOpen(true);
      setCode("");
    } catch (error) {
      setErrorMessage(toErrorMessage(error, "We could not send a verification code to that email address."));
    }
  }

  async function handleSendCode(rawEmailAddress?: string) {
    if (!canSendEmailUpdateCode) {
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

  async function handleResendCode(rawEmailAddress?: string) {
    if (!canSendEmailUpdateCode) {
      handleLinkEmail();
      return;
    }

    const nextEmailAddress = rawEmailAddress === undefined
      ? normalizeEmailAddress(emailAddress)
      : normalizeEmailAddress(rawEmailAddress);

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (nextEmailAddress !== emailAddress) {
      setEmailAddress(nextEmailAddress);
    }

    await requestCodeForEmail(nextEmailAddress);
  }

  async function handleVerifyCode(rawCode?: string) {
    setErrorMessage(null);
    setSuccessMessage(null);

    const normalizedCode = typeof rawCode === "string" ? rawCode.trim() : code.trim();

    if (!normalizedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    if (normalizedCode !== code) {
      setCode(normalizedCode);
    }

    let verifiedEmailAddress: string | null = null;

    try {
      updateEmailErrorRef.current = false;
      const updateResult = await verifyCode({ code: normalizedCode });

      if (updateEmailErrorRef.current || !updateResult?.user) {
        throw new Error("We could not verify that code.");
      }

      const refreshedUser = await refreshUser().catch(() => updateResult?.user ?? null);
      const nextEmail = resolveHostedEmailSettingsDisplayState({
        linkedAccounts: readPrivyLinkedAccounts(refreshedUser) ?? linkedAccounts,
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

  function handleLinkEmail() {
    setErrorMessage(null);
    setSuccessMessage(null);
    setCode("");
    setPendingEmailAddress(null);
    setDialogOpen(false);

    if (!input.authenticated) {
      setErrorMessage("Sign in with your existing hosted account before you try to link an email address.");
      return;
    }

    linkEmail();
  }

  async function handleLinkedEmailAccount(linkedUser: { linkedAccounts?: unknown }) {
    const refreshedUser = await refreshUser().catch(() => linkedUser);
    const displayState = resolveHostedEmailSettingsDisplayState({
      linkedAccounts: readPrivyLinkedAccounts(refreshedUser) ?? linkedAccounts,
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
      setErrorMessage("Verify an email address before you try to sync it.");
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
    } finally {
      setIsSyncingEmailRoute(false);
    }
  }

  return {
    authenticated: input.authenticated,
    canManageEmail,
    code,
    dialogOpen,
    effectiveCurrentEmail,
    effectiveVerifiedEmail,
    emailAddress,
    errorMessage,
    isBusy,
    isSendingCode,
    isSubmittingCode,
    isSyncingEmailRoute,
    canSendEmailUpdateCode,
    pendingEmailAddress,
    successMessage,
    setCode,
    setDialogOpen,
    setEmailAddress,
    handleResendCode,
    handleSendCode,
    handleSyncVerifiedEmail,
    handleVerifyCode,
  };
}

function readPrivyLinkedAccounts(input: { linkedAccounts?: unknown } | null | undefined): readonly PrivyLinkedAccountLike[] | null {
  if (!Array.isArray(input?.linkedAccounts)) {
    return null;
  }

  return input.linkedAccounts.filter(isPrivyLinkedAccountLike);
}

function isPrivyLinkedAccountLike(value: unknown): value is PrivyLinkedAccountLike {
  return typeof value === "object" && value !== null;
}
