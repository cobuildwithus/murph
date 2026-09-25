"use client";

import { Fingerprint } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import type { HostedSecureApprovalStatus } from "@/src/lib/sensitive-actions/shared";
import { useApprovalPasskeyEnrollment } from "@/src/components/sensitive-actions/use-approval-passkey-enrollment";

import { ApprovalPasskeyStatus } from "./approval-passkey-status";
import { SettingsStatusLine } from "./connected-account-card";
import { SettingsRow } from "./settings-row";
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
    return <HostedApprovalRecoverySettings enabled={enrollmentEnabled} />;
  }
  if (secureApprovalStatus.method === "initial" || secureApprovalStatus.method === "legacy-repair") {
    return <InitialPasskeySetup enrollmentEnabled={enrollmentEnabled} legacyRepair={secureApprovalStatus.method === "legacy-repair"} />;
  }
  // The status reader only returns the states above or "unavailable"; a failed
  // read stays closed with no setup, restoration or migration action.
  return <div className="flex flex-col gap-2">
    <SettingsRow icon={passkeyIcon} label="Passkey" value="Unavailable" empty />
    <SettingsStatusLine message="Secure approval status is temporarily unavailable. Try again in a moment." tone="destructive" />
  </div>;
}

const passkeyIcon = <Fingerprint className="size-[18px] shrink-0 text-muted-foreground" strokeWidth={1.6} aria-hidden="true" />;

function InitialPasskeySetup({ enrollmentEnabled, legacyRepair }: { enrollmentEnabled: boolean; legacyRepair: boolean }) {
  const enrollment = useApprovalPasskeyEnrollment();
  return <InitialPasskeySetupView legacyRepair={legacyRepair} enrollmentEnabled={enrollmentEnabled} {...enrollment} onEnroll={() => void enrollment.enroll()} />;
}

export function InitialPasskeySetupView({ enrollmentEnabled, pending, registered, error, onEnroll, legacyRepair = false, pendingLabel }: {
  legacyRepair?: boolean;
  pendingLabel?: string | null;
  enrollmentEnabled: boolean;
  pending: boolean;
  registered: boolean;
  error: string | null;
  onEnroll?: () => void;
}) {
  return <div className="flex flex-col gap-2">
    {registered ? <ApprovalPasskeyStatus /> : <SettingsRow
      icon={passkeyIcon}
      label="Passkey" value={pending ? "Setting up…" : legacyRepair ? "Update needed" : "Not set up"} empty
      action={<Button aria-label={legacyRepair ? "Add Murph passkey" : "Set up passkey"} aria-busy={pending} disabled={!enrollmentEnabled || pending} type="button" onClick={onEnroll}>
        {pending ? "Setting up…" : legacyRepair ? "Add Murph passkey" : "Set up"}
      </Button>}
    />}
    {legacyRepair && !registered ? <SettingsStatusLine tone="neutral"
      message={pendingLabel ?? "Add a Murph passkey using a sign-in method already linked to your account. Your existing Murph passkeys cannot be replaced here."}
    /> : null}
    {error ? <SettingsStatusLine message={error} tone="destructive" /> : null}
  </div>;
}
