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
  pendingEmailAddress: string | null;
  onChangeEmailAddress: (value: string) => void;
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
    pendingEmailAddress,
    onChangeEmailAddress,
    onOpenDialog,
    onResendCode,
    onSendCode,
    onSyncVerifiedEmail,
  } = props;

  return (
    <>
      <div className="mb-4 space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-stone-900">Email</h2>
        <p className="text-sm leading-relaxed text-stone-500">
          {currentEmail
            ? isHostedPrivyEmailAccountVerified(currentEmail)
              ? `Connected as ${currentEmail.address}.`
              : `${currentEmail.address} (unverified).`
            : "Add an email so Murph can reach you there."}
        </p>
      </div>

      {currentVerifiedEmail ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={() => void onSyncVerifiedEmail()} disabled={isBusy} variant="outline" size="md">
            {isSyncingEmailRoute ? "Saving..." : "Save verified email"}
          </Button>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="settings-email-address">Email address</Label>
        <div className="flex gap-2">
          <Input
            id="settings-email-address"
            autoComplete="email"
            inputMode="email"
            placeholder="user@example.com"
            type="email"
            value={emailAddress}
            onChange={(event) => onChangeEmailAddress(event.currentTarget.value)}
            className="h-10 px-3.5 text-sm"
          />
          <Button type="button" onClick={() => void onSendCode()} disabled={isBusy} size="md" className="shrink-0">
            {isSyncingEmailRoute
              ? "Syncing..."
              : isSendingCode
                ? "Sending..."
                : currentEmail
                  ? "Send new code"
                  : "Send code"}
          </Button>
        </div>
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
              ? `We sent a code to ${props.pendingEmailAddress}. Enter it below.`
              : "Enter the code we sent to your email."}
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
            className="h-10 px-3.5 text-sm"
          />
          <p className="text-sm text-stone-500">
            Codes expire quickly — use the most recent one.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button type="button" onClick={() => void props.onVerifyCode()} disabled={props.isBusy} size="md">
            {props.isSubmittingCode ? "Verifying..." : "Verify email"}
          </Button>
          <Button type="button" onClick={() => void props.onResendCode()} disabled={props.isBusy} variant="outline" size="md">
            {props.isSendingCode ? "Sending code..." : "Resend code"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
