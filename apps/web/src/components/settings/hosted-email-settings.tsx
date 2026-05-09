"use client";

import { useRef } from "react";

import type { HostedEmailSyncResult } from "./hosted-email-settings-helpers";

import { SettingsStatusLine } from "./connected-account-card";
import {
  useHostedEmailSettingsController,
  type HostedEmailSettingsInitialEmail,
} from "./hosted-email-settings-controller";
import {
  HostedEmailSettingsContent,
  HostedEmailVerificationDialog,
} from "./hosted-email-settings-sections";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

export function HostedEmailSettings(props: {
  authenticated: boolean;
  changeFlow?: boolean;
  initialEmail?: HostedEmailSettingsInitialEmail | null;
  murphEmailAddress?: string | null;
  onSynced?: (payload: HostedEmailSyncResult) => Promise<void> | void;
}) {
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const controller = useHostedEmailSettingsController({
    authenticated: props.authenticated,
    initialEmail: props.initialEmail ?? null,
    onSynced: props.onSynced,
  });

  if (!controller.canManageEmail) {
    return (
      <div className="space-y-5">
        <HostedSettingsSessionState
          authenticated={controller.authenticated}
          signedOutDescription="Sign in to manage your email."
        />
      </div>
    );
  }

  const statusTone = controller.errorMessage
    ? "destructive"
    : controller.successMessage
      ? "success"
      : "neutral";
  const statusMessage =
    controller.errorMessage ??
    controller.successMessage ??
    (controller.isSyncingEmailRoute ? "Saving your email…" : null);

  return (
    <div className="space-y-5">
      <HostedEmailSettingsContent
        changeFlow={props.changeFlow}
        currentEmail={controller.effectiveCurrentEmail}
        currentVerifiedEmail={controller.effectiveVerifiedEmail}
        emailAddress={controller.emailAddress}
        emailInputRef={emailInputRef}
        murphEmailAddress={props.murphEmailAddress ?? null}
        canSendEmailUpdateCode={controller.canSendEmailUpdateCode}
        isBusy={controller.isBusy}
        isSendingCode={controller.isSendingCode}
        isSyncingEmailRoute={controller.isSyncingEmailRoute}
        pendingEmailAddress={controller.pendingEmailAddress}
        onChangeEmailAddress={controller.setEmailAddress}
        onOpenDialog={() => controller.setDialogOpen(true)}
        onResendCode={controller.handleResendCode}
        onSendCode={controller.handleSendCode}
        onSyncVerifiedEmail={controller.handleSyncVerifiedEmail}
      />

      {statusMessage ? (
        <SettingsStatusLine
          message={statusMessage}
          tone={statusTone === "neutral" && controller.isSyncingEmailRoute ? "neutral" : statusTone}
        />
      ) : null}

      <HostedEmailVerificationDialog
        code={controller.code}
        dialogOpen={controller.dialogOpen}
        emailAddress={controller.emailAddress}
        emailInputRef={emailInputRef}
        isBusy={controller.isBusy}
        isSendingCode={controller.isSendingCode}
        isSubmittingCode={controller.isSubmittingCode}
        pendingEmailAddress={controller.pendingEmailAddress}
        onChangeCode={controller.setCode}
        onOpenChange={(nextOpen) => {
          if (!controller.isSubmittingCode) {
            controller.setDialogOpen(nextOpen);
          }
        }}
        onResendCode={controller.handleResendCode}
        onVerifyCode={controller.handleVerifyCode}
      />
    </div>
  );
}
