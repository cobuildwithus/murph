import { useLinkAccount, usePrivy, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useRef, useState } from "react";

import type {
  HostedPrivyEmailAccount,
  HostedPrivyLinkedAccountContainer,
  PrivyLinkedAccountLike,
} from "@/src/lib/hosted-onboarding/privy-shared";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyVerifiedEmailAccount,
  isHostedPrivyEmailAccountVerified,
  resolveHostedPrivyLinkedAccounts,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isValidEmailAddress,
  normalizeComparableEmail,
  normalizeEmailAddress,
  resolveHostedEmailSettingsDisplayState,
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
  privyEmailLinked?: boolean | null;
  privyEmailSyncRequired?: boolean | null;
  /** Called when the server session exists but this browser has no Privy user yet. */
  onClientAuthRequired?: () => void;
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
  const initialVerifiedEmailAddress = typeof input.initialEmail?.verifiedAt === "number"
    ? normalizeEmailAddress(input.initialEmail.address)
    : null;
  const normalizedInitialVerifiedEmailAddress = normalizeComparableEmail(
    initialVerifiedEmailAddress,
  );
  const [code, setCode] = useState("");
  const [emailAddress, setEmailAddress] = useState(() => baseDisplayState.currentEmail?.address ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSyncingEmailRoute, setIsSyncingEmailRoute] = useState(false);
  const [isResolvingLinkedEmail, setIsResolvingLinkedEmail] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [pendingEmailAddress, setPendingEmailAddress] = useState<string | null>(null);
  const [pendingEmailSync, setPendingEmailSync] = useState<{
    expectedEmailAddress: string | null;
    resolveFromPrivy: boolean;
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [verifiedEmailOverride, setVerifiedEmailOverride] = useState<HostedPrivyEmailAccount | null>(null);
  const preLinkVerifiedEmailAddressesRef = useRef<Set<string>>(new Set());
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
      preLinkVerifiedEmailAddressesRef.current.clear();

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
          linkedAccount: params.linkedAccount,
          linkedUser: params.user,
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
  const clientAuthenticated = privyUser !== null;
  // Privy's headless update-email flow refuses to send a code unless the
  // Privy user already has an email linked; otherwise we must link instead,
  // which Privy only supports through its own modal.
  const canUpdatePrivyEmail = Boolean(privyUser?.email?.address);
  const canSendEmailUpdateCode = Boolean(
    effectiveCurrentEmail?.address && canUpdatePrivyEmail,
  );
  const isSendingCode = state.status === "sending-code";
  const isSubmittingCode = state.status === "submitting-code";
  const isBusy = !privyReady
    || isResolvingLinkedEmail
    || isSendingCode
    || isSubmittingCode
    || isSyncingEmailRoute;
  const canRecoverEmailSync = input.privyEmailSyncRequired === true
    || (input.privyEmailLinked === true && !effectiveVerifiedEmail);

  function handleClientAuthRequired() {
    setNoticeMessage("Sign in on this device to manage email.");
    input.onClientAuthRequired?.();
  }

  async function requestCodeForEmail(nextEmailAddress: string) {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);

    if (!input.authenticated) {
      setErrorMessage("Sign in to your Murph account first, then link your email.");
      return;
    }

    if (!isValidEmailAddress(nextEmailAddress)) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (!clientAuthenticated) {
      handleClientAuthRequired();
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
    const nextEmailAddress = normalizeEmailAddress(rawEmailAddress ?? emailAddress);

    if (canSendEmailUpdateCode && !nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
    }

    if (nextEmailAddress && nextEmailAddress !== emailAddress) {
      setEmailAddress(nextEmailAddress);
    }

    if (!canSendEmailUpdateCode) {
      await handleLinkEmail();
      return;
    }

    if (!nextEmailAddress) {
      setErrorMessage("Enter a valid email address before we send a code.");
      return;
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
    setNoticeMessage(null);
    setSuccessMessage(null);
    setCode("");
    setPendingEmailAddress(null);
  }

  async function handleVerifyCode(rawCode?: string) {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);

    const normalizedCode = (rawCode ?? code).trim();

    if (!normalizedCode) {
      setErrorMessage("Enter the verification code we emailed you.");
      return;
    }

    const expectedEmailAddress = normalizeEmailAddress(
      pendingEmailAddress ?? emailAddress,
    );

    if (!expectedEmailAddress) {
      setErrorMessage("Enter the email address you verified and try again.");
      return;
    }

    try {
      updateEmailErrorRef.current = false;
      const updateResult = await verifyCode({ code: normalizedCode });

      if (updateEmailErrorRef.current || !updateResult?.user) {
        throw new Error("We could not verify that code.");
      }

      setCode("");
      setPendingEmailAddress(null);
      setEmailAddress(expectedEmailAddress);

    } catch (error) {
      setCode("");
      setErrorMessage(toErrorMessage(error, "We could not verify that code."));
      return;
    }

    setPendingEmailSync({ expectedEmailAddress, resolveFromPrivy: false });
    await syncVerifiedEmailAddress(expectedEmailAddress, "verify");
  }

  async function handleLinkEmail() {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);
    setCode("");
    setPendingEmailAddress(null);
    setPendingEmailSync(null);

    if (!input.authenticated) {
      setErrorMessage("Sign in to your Murph account first, then link your email.");
      return;
    }

    if (!clientAuthenticated) {
      handleClientAuthRequired();
      return;
    }

    setIsResolvingLinkedEmail(true);

    try {
      const refreshedUser = await refreshUser();
      preLinkVerifiedEmailAddressesRef.current = new Set([
        ...readUserVerifiedEmailAddresses(privyUser),
        ...readUserVerifiedEmailAddresses(refreshedUser),
      ].map(normalizeComparableEmail).concat(normalizedInitialVerifiedEmailAddress)
        .filter((address): address is string => address !== null));
      setIsPrivyLinkModalActive(true);
      linkEmail();
    } catch {
      preLinkVerifiedEmailAddressesRef.current.clear();
      setErrorMessage(
        "Murph could not confirm your current email links. Wait a moment and try again.",
      );
    } finally {
      setIsResolvingLinkedEmail(false);
    }
  }

  async function handleLinkedEmailAccount(input: {
    linkedAccount: unknown;
    linkedUser: HostedPrivyLinkedAccountContainer;
  }) {
    const callbackEmailAddress = readLinkedEmailAddress(input.linkedAccount);
    const resolveFromPrivy = !isNewLinkedEmailAddress(
      callbackEmailAddress,
      preLinkVerifiedEmailAddressesRef.current,
    );
    const expectedEmailAddress = await resolveLinkedEmailAddress({
      linkedAccount: input.linkedAccount,
      linkedUser: input.linkedUser,
    });

    setPendingEmailSync({
      expectedEmailAddress,
      resolveFromPrivy,
    });

    if (expectedEmailAddress) {
      setEmailAddress(expectedEmailAddress);
      await syncVerifiedEmailAddress(expectedEmailAddress, "verify");
      return;
    }

    setErrorMessage(
      "Your email is linked, but Murph could not confirm the new address yet. Try saving again.",
    );
  }

  async function handleRetryEmailSync() {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);

    if (!pendingEmailSync) {
      setErrorMessage("Verify or link your email before trying to save it again.");
      return;
    }

    let expectedEmailAddress = pendingEmailSync.expectedEmailAddress;

    if (pendingEmailSync.resolveFromPrivy) {
      expectedEmailAddress = await resolveLinkedEmailAddress({
        linkedAccount: null,
        linkedUser: null,
      });

      if (!expectedEmailAddress) {
        setErrorMessage(
          "Murph still could not confirm the new email address. Wait a moment and try again.",
        );
        return;
      }

      setEmailAddress(expectedEmailAddress);
      setPendingEmailSync({
        expectedEmailAddress,
        resolveFromPrivy: false,
      });
    }

    await syncVerifiedEmailAddress(expectedEmailAddress, "verify");
  }

  async function handleRecoverEmailSync() {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);
    setPendingEmailSync({ expectedEmailAddress: null, resolveFromPrivy: false });
    await syncVerifiedEmailAddress(null, "verify");
  }

  async function handleSyncVerifiedEmail() {
    setErrorMessage(null);
    setNoticeMessage(null);
    setSuccessMessage(null);

    if (!effectiveVerifiedEmail?.address) {
      setErrorMessage("Verify your email address first.");
      return;
    }

    await syncVerifiedEmailAddress(effectiveVerifiedEmail.address, "resync");
  }

  async function syncVerifiedEmailAddress(
    expectedEmailAddress: string | null,
    mode: "resync" | "verify",
  ) {
    setIsSyncingEmailRoute(true);

    try {
      const syncPresentation = await syncHostedVerifiedEmailAddress({
        expectedEmailAddress,
        mode,
      });
      setSuccessMessage(syncPresentation.successMessage);
      setErrorMessage(syncPresentation.errorMessage);

      if (syncPresentation.syncResult) {
        preLinkVerifiedEmailAddressesRef.current.clear();
        setEmailAddress(syncPresentation.syncResult.emailAddress);
        setVerifiedEmailOverride({
          address: syncPresentation.syncResult.emailAddress,
          verifiedAt: readVerifiedAtTimestamp(syncPresentation.syncResult.verifiedAt),
        });

        try {
          await input.onSynced?.(syncPresentation.syncResult);
          setPendingEmailSync(null);
        } catch (error) {
          setErrorMessage(toErrorMessage(error, "Your email is connected, but the page didn't refresh. Reload to see it."));
        }
      }
    } finally {
      setIsSyncingEmailRoute(false);
    }
  }

  async function resolveLinkedEmailAddress(input: {
    linkedAccount: unknown;
    linkedUser: HostedPrivyLinkedAccountContainer | null;
  }): Promise<string | null> {
    const preLinkVerifiedEmailAddresses = preLinkVerifiedEmailAddressesRef.current;
    const linkedAccountEmailAddress = readLinkedEmailAddress(input.linkedAccount);
    if (isNewLinkedEmailAddress(linkedAccountEmailAddress, preLinkVerifiedEmailAddresses)) {
      return linkedAccountEmailAddress;
    }

    setIsResolvingLinkedEmail(true);

    try {
      const refreshedUser = await refreshUser().catch(() => input.linkedUser);
      const candidates = [
        ...readUserVerifiedEmailAddresses(refreshedUser),
        ...readUserVerifiedEmailAddresses(input.linkedUser),
      ].filter((candidate) => isNewLinkedEmailAddress(
        candidate,
        preLinkVerifiedEmailAddresses,
      ));
      const candidatesByAddress = new Map(
        candidates.map((candidate) => [normalizeComparableEmail(candidate), candidate]),
      );

      return candidatesByAddress.size === 1
        ? candidatesByAddress.values().next().value ?? null
        : null;
    } finally {
      setIsResolvingLinkedEmail(false);
    }
  }

  return {
    authenticated: input.authenticated,
    canManageEmail,
    clientAuthenticated,
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
    hasPendingEmailSync: pendingEmailSync !== null,
    canSendEmailUpdateCode,
    canRecoverEmailSync,
    noticeMessage,
    pendingEmailAddress,
    successMessage,
    setCode,
    setEmailAddress,
    handleLinkEmail,
    handleRetryEmailSync,
    handleRecoverEmailSync,
    handleClientAuthRequired,
    handleResendCode,
    handleSendCode,
    handleSyncVerifiedEmail,
    handleUseAnotherEmail,
    handleVerifyCode,
  };
}

function formatUpdateEmailErrorMessage(baseMessage: string, errorCode: string | null): string {
  return errorCode ? `${baseMessage} (${errorCode})` : baseMessage;
}

function readLinkedEmailAddress(linkedAccount: unknown): string | null {
  const linkedAccountEmail = isPrivyLinkedAccountLike(linkedAccount)
    ? extractHostedPrivyEmailAccount([linkedAccount])
    : null;

  return normalizeEmailAddress(linkedAccountEmail?.address);
}

function readUserVerifiedEmailAddresses(
  user: HostedPrivyLinkedAccountContainer | null,
): string[] {
  if (!user) {
    return [];
  }

  return resolveHostedPrivyLinkedAccounts(user)
    .map((account) => extractHostedPrivyVerifiedEmailAccount([account]))
    .map((account) => normalizeEmailAddress(account?.address))
    .filter((address): address is string => address !== null);
}

function isNewLinkedEmailAddress(
  address: string | null,
  preLinkVerifiedEmailAddresses: ReadonlySet<string>,
): address is string {
  const normalizedAddress = normalizeComparableEmail(address);

  return normalizedAddress !== null
    && !preLinkVerifiedEmailAddresses.has(normalizedAddress);
}

function readCurrentUnixTimestamp(): number {
  return Math.trunc(Date.now() / 1000);
}

function readVerifiedAtTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? Math.trunc(timestamp / 1000)
    : readCurrentUnixTimestamp();
}

function isPrivyLinkedAccountLike(value: unknown): value is PrivyLinkedAccountLike {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
