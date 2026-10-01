import { InitialPasskeySetupView } from "@/src/components/settings/hosted-passkey-settings";
import { ApprovalPasskeyStatus, ApprovalPasskeyUpdate } from "@/src/components/settings/approval-passkey-status";

export function ApprovalPasskeyStudy() {
  return (
    <div id="approval-passkey-update" data-design-component="approval-passkey-update" className="grid items-start gap-6 lg:grid-cols-2" inert>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Update available</p>
        <ApprovalPasskeyStatus />
        <ApprovalPasskeyUpdate error={null} />
      </div>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Waiting for confirmation</p>
        <ApprovalPasskeyStatus />
        <ApprovalPasskeyUpdate error={null} pending />
      </div>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Retry</p>
        <ApprovalPasskeyStatus />
        <ApprovalPasskeyUpdate error="Your passkey could not be verified. Please try again." />
      </div>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Updated</p>
        <ApprovalPasskeyStatus />
        <ApprovalPasskeyUpdate error={null} registered />
      </div>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Legacy approval update — synthetic account</p>
        <InitialPasskeySetupView enrollmentEnabled legacyRepair pending={false} registered={false} error={null} />
      </div>
      <div className="rounded-2xl border border-border bg-background p-5">
        <p className="mb-4 text-xs text-muted-foreground">Legacy update — confirming sign-in</p>
        <InitialPasskeySetupView enrollmentEnabled legacyRepair pending registered={false} error={null}
          pendingLabel="Sign in again to add your passkey…" />
      </div>
    </div>
  );
}
