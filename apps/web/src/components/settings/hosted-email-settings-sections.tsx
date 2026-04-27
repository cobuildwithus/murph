"use client";

import { useRef, type RefObject } from "react";

import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import type { HostedPrivyEmailAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedPrivyEmailAccountVerified } from "@/src/lib/hosted-onboarding/privy-shared";

import { Alert, AlertDescription } from "@/src/components/ui/alert";

import { ConnectedAccountCard, SettingsContactLink } from "./connected-account-card";

const MURPH_CONTACT_EMAIL = "murph@mail.withmurph.ai";

export function HostedEmailSettingsContent(props: {
  currentEmail: HostedPrivyEmailAccount | null;
  currentVerifiedEmail: (HostedPrivyEmailAccount & { verifiedAt: number }) | null;
  emailAddress: string;
  emailInputRef: RefObject<HTMLInputElement | null>;
  canSendEmailUpdateCode: boolean;
  isBusy: boolean;
  isSendingCode: boolean;
  isSyncingEmailRoute: boolean;
  pendingEmailAddress: string | null;
  onChangeEmailAddress: (value: string) => void;
  onOpenDialog: () => void;
  onResendCode: (emailAddress?: string) => Promise<void>;
  onSendCode: (emailAddress?: string) => Promise<void>;
  onSyncVerifiedEmail: () => Promise<void>;
}) {
  const {
    currentEmail,
    currentVerifiedEmail,
    emailAddress,
    emailInputRef,
    canSendEmailUpdateCode,
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

  const isVerified = currentEmail ? isHostedPrivyEmailAccountVerified(currentEmail) : false;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Email</h2>
      </div>

      {currentEmail ? (
        <ConnectedAccountCard
          value={currentEmail.address}
          meta={isVerified ? null : "Unverified"}
          action={
            currentVerifiedEmail ? (
              <Button
                type="button"
                onClick={() => void onSyncVerifiedEmail()}
                disabled={isBusy}
                variant="outline"
              >
                {isSyncingEmailRoute ? "Saving..." : "Save verified email"}
              </Button>
            ) : null
          }
        />
      ) : (
        <ConnectedAccountCard
          value="Not connected"
          variant="empty"
          action={
            !canSendEmailUpdateCode ? (
              <Button
                type="button"
                onClick={() => void onSendCode()}
                disabled={isBusy}
                size="sm"
              >
                Link email
              </Button>
            ) : null
          }
        />
      )}

      <SettingsContactLink
        href={`mailto:${MURPH_CONTACT_EMAIL}`}
        label={`Email Murph at ${MURPH_CONTACT_EMAIL}`}
      >
        Email {MURPH_CONTACT_EMAIL}
      </SettingsContactLink>

      {canSendEmailUpdateCode ? (
        <div className="space-y-2">
          <Label htmlFor="settings-email-address">Email address</Label>
          <div className="flex gap-2">
            <Input
              id="settings-email-address"
              autoComplete="email"
              inputMode="email"
              placeholder="user@example.com"
              ref={emailInputRef}
              type="email"
              value={emailAddress}
              onChange={(event) => onChangeEmailAddress(event.currentTarget.value)}
              className="h-10 px-3.5 text-sm"
            />
            <Button
              type="button"
              onClick={() => void onSendCode(emailInputRef.current?.value ?? emailAddress)}
              disabled={isBusy}
              className="shrink-0"
            >
              {isSyncingEmailRoute
                ? "Syncing..."
                : isSendingCode
                  ? "Sending..."
                  : "Send new code"}
            </Button>
          </div>
        </div>
      ) : null}

      {pendingEmailAddress ? (
        <Alert className="border-border bg-card">
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">
              We sent a verification code to{" "}
              <strong className="text-foreground">{pendingEmailAddress}</strong>.
            </span>
            <Button type="button" onClick={onOpenDialog} disabled={isBusy} variant="outline">
              Enter code
            </Button>
            <Button
              type="button"
              onClick={() => void onResendCode(emailInputRef.current?.value ?? emailAddress)}
              disabled={isBusy}
              variant="outline"
            >
              {isSendingCode ? "Sending code..." : "Resend code"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export function HostedEmailVerificationDialog(props: {
  code: string;
  dialogOpen: boolean;
  emailAddress: string;
  emailInputRef: RefObject<HTMLInputElement | null>;
  isBusy: boolean;
  isSendingCode: boolean;
  isSubmittingCode: boolean;
  pendingEmailAddress: string | null;
  onChangeCode: (value: string) => void;
  onOpenChange: (nextOpen: boolean) => void;
  onResendCode: (emailAddress?: string) => Promise<void>;
  onVerifyCode: (code?: string) => Promise<void>;
}) {
  const codeInputRef = useRef<HTMLInputElement | null>(null);

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
            ref={codeInputRef}
            value={props.code}
            onChange={(event) => props.onChangeCode(event.currentTarget.value)}
            className="h-10 px-3.5 text-sm"
          />
          <p className="text-sm text-stone-500">
            Codes expire quickly — use the most recent one.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            onClick={() => void props.onVerifyCode(codeInputRef.current?.value ?? props.code)}
            disabled={props.isBusy}
          >
            {props.isSubmittingCode ? "Verifying..." : "Verify email"}
          </Button>
          <Button
            type="button"
            onClick={() => void props.onResendCode(props.emailInputRef.current?.value ?? props.emailAddress)}
            disabled={props.isBusy}
            variant="outline"
          >
            {props.isSendingCode ? "Sending code..." : "Resend code"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
