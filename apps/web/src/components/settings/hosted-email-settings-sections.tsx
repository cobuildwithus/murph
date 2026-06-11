"use client";

import { useRef, type RefObject } from "react";

import { Button } from "@/src/components/ui/button";
import { HostedVerificationCodeStep } from "@/src/components/hosted-onboarding/hosted-verification-code-step";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import type { HostedPrivyEmailAccount } from "@/src/lib/hosted-onboarding/privy-shared";
import { isHostedPrivyEmailAccountVerified } from "@/src/lib/hosted-onboarding/privy-shared";

import { ConnectedAccountCard } from "./connected-account-card";
import { HostedEmailMurphContactDialog } from "./hosted-email-murph-contact-dialog";

export function HostedEmailSettingsContent(props: {
  changeFlow?: boolean;
  code: string;
  currentEmail: HostedPrivyEmailAccount | null;
  currentVerifiedEmail: (HostedPrivyEmailAccount & { verifiedAt: number }) | null;
  emailAddress: string;
  emailInputRef: RefObject<HTMLInputElement | null>;
  murphEmailAddress?: string | null;
  canSendEmailUpdateCode: boolean;
  isBusy: boolean;
  isSendingCode: boolean;
  isSubmittingCode: boolean;
  isSyncingEmailRoute: boolean;
  pendingEmailAddress: string | null;
  onChangeCode: (value: string) => void;
  onChangeEmailAddress: (value: string) => void;
  onResendCode: () => Promise<void>;
  onSendCode: (emailAddress?: string) => Promise<void>;
  onSyncVerifiedEmail: () => Promise<void>;
  onUseAnotherEmail: () => void;
  onVerifyCode: (code?: string) => Promise<void>;
}) {
  const {
    currentEmail,
    currentVerifiedEmail,
    emailAddress,
    emailInputRef,
    murphEmailAddress,
    canSendEmailUpdateCode,
    isBusy,
    isSendingCode,
    isSubmittingCode,
    isSyncingEmailRoute,
    pendingEmailAddress,
    onChangeCode,
    onChangeEmailAddress,
    onResendCode,
    onSendCode,
    onSyncVerifiedEmail,
    onUseAnotherEmail,
    onVerifyCode,
  } = props;

  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const isVerified = currentEmail ? isHostedPrivyEmailAccountVerified(currentEmail) : false;

  if (pendingEmailAddress) {
    return (
      <div className="space-y-5">
        <HostedVerificationCodeStep
          code={props.code}
          description={`We sent a code to ${pendingEmailAddress}. Codes expire quickly — use the most recent one.`}
          disabled={isBusy}
          inputRef={codeInputRef}
          pendingAction={
            isSendingCode ? "send-code" : isSubmittingCode ? "verify-code" : null
          }
          primaryActionLabel="Verify email"
          primaryActionPendingLabel="Verifying..."
          secondaryAction={
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={isBusy}
              onClick={() => {
                onUseAnotherEmail();
                requestAnimationFrame(() => emailInputRef.current?.focus());
              }}
              className="w-full text-muted-foreground hover:text-foreground"
            >
              Use another email
            </Button>
          }
          onCodeChange={onChangeCode}
          onResendCode={() => void onResendCode()}
          onSubmit={() => void onVerifyCode(codeInputRef.current?.value ?? props.code)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {props.changeFlow ? null : (
        <div className="space-y-2">
          <h2 className="font-serif text-lg font-medium tracking-tight text-foreground">Email</h2>
        </div>
      )}

      {props.changeFlow ? null : currentEmail ? (
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

      {currentEmail && murphEmailAddress && !props.changeFlow ? (
        <HostedEmailMurphContactDialog
          murphEmailAddress={murphEmailAddress}
          userEmailAddress={currentEmail.address}
        />
      ) : null}

      {canSendEmailUpdateCode ? (
        <div className="space-y-3">
          <Label htmlFor="settings-email-address">{props.changeFlow ? "New email address" : "Email address"}</Label>
          <Input
            id="settings-email-address"
            autoComplete="email"
            inputMode="email"
            inputSize="xl"
            placeholder="user@example.com"
            ref={emailInputRef}
            type="email"
            value={emailAddress}
            onChange={(event) => onChangeEmailAddress(event.currentTarget.value)}
          />
          <Button
            type="button"
            onClick={() => void onSendCode(emailInputRef.current?.value ?? emailAddress)}
            disabled={isBusy}
            size="xl"
            className="w-full"
          >
            {isSyncingEmailRoute
              ? "Syncing..."
              : isSendingCode
                ? "Sending..."
                : "Send verification code"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
