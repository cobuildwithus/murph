"use client";

import { Fingerprint } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { SettingsStatusLine } from "./connected-account-card";

export function ApprovalPasskeyStatus() {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-4 first:pt-0 last:pb-0">
      <Fingerprint className="size-[18px] shrink-0 text-primary" strokeWidth={1.6} aria-hidden="true" />
      <div className="min-w-0">
        <span className="font-mono text-[10px] uppercase tracking-[0.11em] text-muted-foreground">Passkey</span>
        <p className="break-words font-serif text-base tracking-tight text-foreground">Enabled</p>
      </div>
    </div>
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
