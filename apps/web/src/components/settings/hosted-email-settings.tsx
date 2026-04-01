"use client";

import { usePrivy, useUpdateEmail, useUser } from "@privy-io/react-auth";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isHostedPrivyEmailAccountVerified,
  type HostedPrivyEmailAccount,
  resolveHostedPrivyLinkedAccounts,
} from "@/src/lib/hosted-onboarding/privy-shared";

import {
  isValidEmailAddress,
  normalizeComparableEmail,
  normalizeEmailAddress,
  resolveHostedEmailSettingsDisplayState,
  syncHostedVerifiedEmailAddress,
} from "./hosted-email-settings-helpers";

interface HostedEmailSettingsProps {
  expectedPrivyUserId: string;
}

export function HostedEmailSettings(props: HostedEmailSettingsProps) {
  return <HostedEmailSettingsInner {...props} />;
}

function HostedEmailSettingsInner({ expectedPrivyUserId }: HostedEmailSettingsProps) {
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
  const canManageEmail = ready && authenticated && user?.id === expectedPrivyUserId;
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

    if (user.id !== expectedPrivyUserId) {
      setErrorMessage("This Privy session belongs to a different account than the current hosted session.");
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

  return (
    <div className="space-y-5">
      {successMessage ? (
        <Alert className="border-green-200 bg-green-50 text-green-700">
          <AlertTitle>Email updated</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update email</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {isSyncingEmailRoute ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Finishing email sync</AlertTitle>
          <AlertDescription>
            Finishing the hosted email connection and updating your assistant.
          </AlertDescription>
        </Alert>
      ) : null}

      {!ready || isLoadingAuthenticatedUser ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Checking your session</AlertTitle>
          <AlertDescription>
            Checking your Privy session before we show email settings.
          </AlertDescription>
        </Alert>
      ) : !authenticated ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Open your latest Murph invite or sign-in flow in this browser first. We need the matching Privy session
            before we can verify an email on your hosted account.
          </AlertDescription>
        </Alert>
      ) : !canManageEmail ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTitle>Wrong Privy account</AlertTitle>
          <AlertDescription>
            This browser is signed in to a different Privy account than the active hosted session. Sign out here, then
            reopen the correct Murph invite before linking an email address.
          </AlertDescription>
          <div className="mt-3">
            <Button type="button" onClick={handleLogout} disabled={loggingOut} variant="outline" size="lg">
              {loggingOut ? "Signing out..." : "Sign out of Privy"}
            </Button>
          </div>
        </Alert>
      ) : (
        <>
          <Alert className="border-stone-200 bg-stone-50">
            <AlertTitle className="text-stone-900">
              {!effectiveCurrentEmail
                ? "No email linked yet"
                : isHostedPrivyEmailAccountVerified(effectiveCurrentEmail)
                  ? "Current verified email"
                  : "Current email"}
            </AlertTitle>
            <AlertDescription className="mt-1">
              {effectiveCurrentEmail?.address
                ?? "Add an email address and we will verify it with a one-time code before saving it."}
            </AlertDescription>
          </Alert>

          {effectiveVerifiedEmail ? (
            <Alert className="border-stone-200 bg-white">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  Use this to retry the hosted assistant sync without requesting another verification code.
                </span>
                <Button type="button" onClick={handleSyncVerifiedEmail} disabled={isBusy} variant="outline">
                  {isSyncingEmailRoute ? "Syncing..." : "Sync current verified email"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-2">
              <Label htmlFor="settings-email-address">
                Email address
              </Label>
              <Input
                id="settings-email-address"
                autoComplete="email"
                inputMode="email"
                placeholder="user@example.com"
                type="email"
                value={emailAddress}
                onChange={(event) => setEmailAddress(event.currentTarget.value)}
                className="h-12 px-4 text-base md:text-sm"
              />
              <p className="text-sm text-stone-500">
                We&apos;ll send a one-time code through Privy, then you&apos;ll confirm it in the verification dialog.
              </p>
            </div>

            <Button type="button" onClick={handleSendCode} disabled={isBusy} size="lg">
              {isSyncingEmailRoute
                ? "Syncing..."
                : isSendingCode
                  ? "Sending code..."
                  : effectiveCurrentEmail
                    ? "Send new code"
                    : "Send code"}
            </Button>
          </div>

          {pendingEmailAddress ? (
            <Alert className="border-stone-200 bg-white">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>
                  We sent a verification code to <strong className="text-stone-900">{pendingEmailAddress}</strong>.
                </span>
                <Button type="button" onClick={() => setDialogOpen(true)} disabled={isBusy} variant="outline">
                  Enter code
                </Button>
                <Button type="button" onClick={handleResendCode} disabled={isBusy} variant="outline">
                  {isSendingCode ? "Sending code..." : "Resend code"}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(nextOpen) => {
          if (!isSubmittingCode) {
            setDialogOpen(nextOpen);
          }
        }}
      >
        <DialogContent className="max-w-md p-6 md:p-7" showCloseButton={!isSubmittingCode}>
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
              Enter your verification code
            </DialogTitle>
            <DialogDescription>
              {pendingEmailAddress
                ? `We emailed a one-time code to ${pendingEmailAddress}. Enter it here to finish updating your account.`
                : "Enter the one-time code Privy emailed you to finish updating your account."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Label htmlFor="settings-email-code">
              Verification code
            </Label>
            <Input
              id="settings-email-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)}
              className="h-12 px-4 text-base md:text-sm"
            />
            <p className="text-sm text-stone-500">
              Codes typically expire quickly, so use the newest email if you request another one.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={handleVerifyCode} disabled={isBusy} size="lg">
              {isSubmittingCode ? "Verifying..." : "Verify email"}
            </Button>
            <Button type="button" onClick={handleResendCode} disabled={isBusy} variant="outline" size="lg">
              {isSendingCode ? "Sending code..." : "Resend code"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return fallback;
}
