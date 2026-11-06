"use client";

import { Fingerprint } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/src/components/ui/button";
import { SettingsStatusLine } from "./connected-account-card";
import { SettingsRow } from "./settings-row";

export function ApprovalPasskeyStatus({ action }: { action?: ReactNode }) {
  return (
    <SettingsRow label="Passkey" value="Enabled" action={action}
      icon={<Fingerprint className="size-[18px] shrink-0 text-primary" strokeWidth={1.6} aria-hidden="true" />}
    />
  );
}

export function ApprovalPasskeyUpdate(props: {
  error: string | null;
  onUpdate?: () => void;
  pending?: boolean;
  registered?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 pb-4">
      {props.registered ? (
        <SettingsStatusLine message="Your passkey is updated." tone="success" />
      ) : (
        <>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Update your approval passkey. Confirm with your existing passkey, then save its replacement.
          </p>
          <Button className="self-start" disabled={props.pending} onClick={props.onUpdate} type="button">
            {props.pending ? "Updating…" : "Update passkey"}
          </Button>
        </>
      )}
      {props.error ? <SettingsStatusLine message={props.error} tone="destructive" /> : null}
    </div>
  );
}
