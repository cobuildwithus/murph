"use client";

import { Button } from "@/src/components/ui/button";
import type { HostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/shared";
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";

import { ApprovalPasskeyStatus } from "./approval-passkey-status";
import { SettingsStatusLine } from "./connected-account-card";
import { HostedApprovalRecoverySettings } from "./hosted-approval-recovery-settings";

export function HostedPasskeySettings({
  authenticated,
  enrollmentEnabled = false,
  secureApprovalStatus,
}: {
  authenticated: boolean;
  enrollmentEnabled?: boolean;
  secureApprovalStatus: HostedSecureApprovalStatus;
}) {
  if (!authenticated) {
    return null;
  }

  if (secureApprovalStatus.method === "passkey") {
    return <><ApprovalPasskeyStatus /><HostedApprovalRecoverySettings enabled={enrollmentEnabled} /></>;
  }
  if (secureApprovalStatus.method === "initial") return <InitialPasskeySetup enrollmentEnabled={enrollmentEnabled} />;
  return <SettingsStatusLine message="Secure approval status is temporarily unavailable. Try again in a moment." tone="destructive" />;
}

function InitialPasskeySetup({ enrollmentEnabled }: { enrollmentEnabled: boolean }) {
  const enrollment = useApprovalPasskeyEnrollment();
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Add a passkey to approve account changes and other protected actions.
      </p>
      {enrollment.registered ? <SettingsStatusLine message="Your passkey is ready." tone="success" /> : (
        <Button className="self-start" disabled={!enrollmentEnabled || enrollment.pending} type="button" onClick={() => void enrollment.enroll()}>
          {enrollment.pending ? "Setting up…" : "Set up passkey"}
        </Button>
      )}
      {enrollment.error ? <SettingsStatusLine message={enrollment.error} tone="destructive" /> : null}
    </div>
  );
}
