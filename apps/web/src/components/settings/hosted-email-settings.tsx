"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useHostedEmailSettingsController } from "./hosted-email-settings-controller";
import {
  HostedEmailSettingsContent,
  HostedEmailVerificationDialog,
} from "./hosted-email-settings-sections";
import { HostedSettingsSessionState } from "./hosted-settings-session-state";

export function HostedEmailSettings() {
  return <HostedEmailSettingsInner />;
}

function HostedEmailSettingsInner() {
  const controller = useHostedEmailSettingsController();

  return (
    <div className="space-y-5">
      {controller.successMessage ? (
        <Alert className="border-green-200 bg-green-50 text-green-700">
          <AlertTitle>Email updated</AlertTitle>
          <AlertDescription>{controller.successMessage}</AlertDescription>
        </Alert>
      ) : null}

      {controller.errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>Unable to update email</AlertTitle>
          <AlertDescription>{controller.errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {controller.isSyncingEmailRoute ? (
        <Alert className="border-stone-200 bg-stone-50">
          <AlertTitle>Finishing email sync</AlertTitle>
          <AlertDescription>
            Saving your email&hellip;
          </AlertDescription>
        </Alert>
      ) : null}

      {!controller.canManageEmail ? (
        <HostedSettingsSessionState
          authenticated={controller.authenticated}
          isLoadingAuthenticatedUser={controller.isLoadingAuthenticatedUser}
          profileLabel="email settings"
          ready={controller.ready}
          signedOutDescription="Sign in to manage your email."
        />
      ) : (
        <HostedEmailSettingsContent
          currentEmail={controller.effectiveCurrentEmail}
          currentVerifiedEmail={controller.effectiveVerifiedEmail}
          emailAddress={controller.emailAddress}
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
      )}

      <HostedEmailVerificationDialog
        code={controller.code}
        dialogOpen={controller.dialogOpen}
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
