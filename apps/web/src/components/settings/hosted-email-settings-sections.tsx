"use client";

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
import type { HostedPrivyEmailAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedPrivyEmailAccountVerified } from "@/src/lib/hosted-onboarding/privy-shared";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function HostedEmailSettingsContent(props: {
  currentEmail: HostedPrivyEmailAccount | null;
  currentVerifiedEmail: (HostedPrivyEmailAccount & { verifiedAt: number }) | null;
  emailAddress: string;
  isBusy: boolean;
  isSendingCode: boolean;
  isSyncingEmailRoute: boolean;
  loggingOut: boolean;
  pendingEmailAddress: string | null;
  onChangeEmailAddress: (value: string) => void;
  onLogout: () => Promise<void>;
  onOpenDialog: () => void;
  onResendCode: () => Promise<void>;
  onSendCode: () => Promise<void>;
  onSyncVerifiedEmail: () => Promise<void>;
}) {
  const {
    currentEmail,
    currentVerifiedEmail,
    emailAddress,
    isBusy,
    isSendingCode,
    isSyncingEmailRoute,
    loggingOut,
    pendingEmailAddress,
    onChangeEmailAddress,
    onLogout,
    onOpenDialog,
    onResendCode,
    onSendCode,
    onSyncVerifiedEmail,
  } = props;

  return (
    <>
      <Alert className="border-stone-200 bg-stone-50">
        <AlertTitle className="text-stone-900">
          {!currentEmail
            ? "No email linked yet"
            : isHostedPrivyEmailAccountVerified(currentEmail)
              ? "Current verified email"
              : "Current email"}
        </AlertTitle>
        <AlertDescription className="mt-1">
          {currentEmail?.address
            ?? "Add an email address and we will verify it with a one-time code before saving it."}
        </AlertDescription>
      </Alert>

      {currentVerifiedEmail ? (
        <Alert className="border-stone-200 bg-white">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>Use this to retry the hosted assistant sync without requesting another verification code.</span>
            <Button type="button" onClick={() => void onSyncVerifiedEmail()} disabled={isBusy} variant="outline">
              {isSyncingEmailRoute ? "Syncing..." : "Sync current verified email"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="settings-email-address">Email address</Label>
          <Input
            id="settings-email-address"
            autoComplete="email"
            inputMode="email"
            placeholder="user@example.com"
            type="email"
            value={emailAddress}
            onChange={(event) => onChangeEmailAddress(event.currentTarget.value)}
            className="h-12 px-4 text-base md:text-sm"
          />
          <p className="text-sm text-stone-500">
            We&apos;ll send a one-time code through Privy, then you&apos;ll confirm it in the verification dialog.
          </p>
        </div>

        <Button type="button" onClick={() => void onSendCode()} disabled={isBusy} size="lg">
          {isSyncingEmailRoute
            ? "Syncing..."
            : isSendingCode
              ? "Sending code..."
              : currentEmail
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
            <Button type="button" onClick={onOpenDialog} disabled={isBusy} variant="outline">
              Enter code
            </Button>
            <Button type="button" onClick={() => void onResendCode()} disabled={isBusy} variant="outline">
              {isSendingCode ? "Sending code..." : "Resend code"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Alert className="border-stone-200 bg-white">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>Need to switch accounts? Sign out of the current Privy session here, then restart the Murph sign-in flow.</span>
          <Button type="button" onClick={() => void onLogout()} disabled={loggingOut} variant="outline" size="lg">
            {loggingOut ? "Signing out..." : "Sign out of Privy"}
          </Button>
        </AlertDescription>
      </Alert>
    </>
  );
}

export function HostedEmailVerificationDialog(props: {
  code: string;
  dialogOpen: boolean;
  isBusy: boolean;
  isSendingCode: boolean;
  isSubmittingCode: boolean;
  pendingEmailAddress: string | null;
  onChangeCode: (value: string) => void;
  onOpenChange: (nextOpen: boolean) => void;
  onResendCode: () => Promise<void>;
  onVerifyCode: () => Promise<void>;
}) {
  return (
    <Dialog open={props.dialogOpen} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-md p-6 md:p-7" showCloseButton={!props.isSubmittingCode}>
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-stone-900">
            Enter your verification code
          </DialogTitle>
          <DialogDescription>
            {props.pendingEmailAddress
              ? `We emailed a one-time code to ${props.pendingEmailAddress}. Enter it here to finish updating your account.`
              : "Enter the one-time code Privy emailed you to finish updating your account."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Label htmlFor="settings-email-code">Verification code</Label>
          <Input
            id="settings-email-code"
            autoComplete="one-time-code"
            inputMode="numeric"
            placeholder="123456"
            value={props.code}
            onChange={(event) => props.onChangeCode(event.currentTarget.value)}
            className="h-12 px-4 text-base md:text-sm"
          />
          <p className="text-sm text-stone-500">
            Codes typically expire quickly, so use the newest email if you request another one.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void props.onVerifyCode()} disabled={props.isBusy} size="lg">
            {props.isSubmittingCode ? "Verifying..." : "Verify email"}
          </Button>
          <Button type="button" onClick={() => void props.onResendCode()} disabled={props.isBusy} variant="outline" size="lg">
            {props.isSendingCode ? "Sending code..." : "Resend code"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
