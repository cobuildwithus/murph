"use client";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { HostedAccountProviderAccessRemovalConfirmation } from "@/src/components/settings/hosted-data-privacy-settings";
import { HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE } from "@/src/lib/hosted-privacy/account-deletion-maintenance";
import { HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "@/src/lib/hosted-privacy/account-data-shared";

/**
 * Exceptional confirmation states of the delete-account dialog: maintenance
 * and an OAuth callback whose provider-side result is no longer knowable.
 *
 * What this frame proves: the exact sentence a member reads, and that it fits
 * its container at desktop and mobile widths. The sentence is imported from the
 * same constant the route returns, so the copy cannot drift.
 *
 * What it does not prove: this reproduces the dialog's markup rather than
 * mounting the shipped one, so it is not evidence about focus order, the close
 * affordance, or constrained-height scrolling. Those behaviours come from the
 * Dialog primitives around the real component and can only be verified against
 * a running /settings. The arrival path -- declined at the sensitive-action
 * challenge before any passkey approval or browser-vault teardown -- is proven
 * by the route and component tests.
 *
 * Delete this study with the migration runbook once the OC buckets are retired.
 */
export function AccountDeletionMaintenanceStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-study="account-deletion-maintenance"
      id="account-deletion-maintenance"
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        What a member sees in <code>/settings</code> if they try to delete their
        account during the storage-migration maintenance window. Nothing has been
        started: no passkey prompt, no browser-vault teardown, and their
        sensitive-action authorization is unspent. The message names no return
        time, because the window can outlast any duration we could promise. These
        frames reproduce the dialog to show the copy and its containment; focus,
        close, and scroll behaviour belong to the real dialog in{" "}
        <code>/settings</code>.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <DialogFrame label="Desktop" width="max-w-md">
          <MaintenanceDialogBody />
        </DialogFrame>
        <DialogFrame label="Mobile · 390px" width="max-w-[390px]">
          <MaintenanceDialogBody />
        </DialogFrame>
      </div>

      <div className="flex flex-col gap-4">
        <div className="max-w-2xl space-y-1">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Provider-access recovery
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            If a provider callback became ambiguous, deletion stays fenced until
            the member removes Murph in the named provider accounts and explicitly
            confirms that recovery step. The confirmation below is the production
            component mounted by <code>/settings</code>.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <DialogFrame label="Desktop" width="max-w-md">
            <ProviderRecoveryDialogBody id="design-provider-recovery-desktop" />
          </DialogFrame>
          <DialogFrame label="Mobile · 390px" width="max-w-[390px]">
            <ProviderRecoveryDialogBody id="design-provider-recovery-mobile" />
          </DialogFrame>
        </div>
      </div>
    </div>
  );
}

function DialogFrame({
  children,
  label,
  width,
}: {
  children: React.ReactNode;
  label: string;
  width: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex justify-center rounded-2xl border border-border/60 bg-muted/20 p-6">
        <div
          className={`w-full ${width} rounded-xl border border-border bg-background p-6 shadow-lg md:p-7`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function MaintenanceDialogBody() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pr-10">
        <h2 className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
          Delete account
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Permanently deletes your account and all your data, including your
          subscription and login. This cannot be undone.
        </p>
      </div>

      <p
        role="alert"
        className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
      >
        {HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="design-account-delete-phrase">
          Type{" "}
          <span className="font-mono">
            {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          </span>{" "}
          to confirm
        </Label>
        <Input
          autoComplete="off"
          className="h-12 text-base"
          defaultValue={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          id="design-account-delete-phrase"
          inputMode="text"
          placeholder={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          readOnly
        />
      </div>

      <div className="flex flex-col gap-2">
        <Button type="button" size="xl" variant="destructive" className="w-full">
          Delete account
        </Button>
        <Button type="button" size="xl" variant="ghost" className="w-full">
          Cancel
        </Button>
      </div>
    </div>
  );
}

function ProviderRecoveryDialogBody({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pr-10">
        <h2 className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
          Delete account
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Permanently deletes your account and all your data, including your
          subscription and login. This cannot be undone.
        </p>
      </div>

      <p
        role="alert"
        className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive"
      >
        A provider connection did not finish safely. Remove Murph access in
        these provider accounts: Oura, Strava. Confirm that removal here, then
        try account deletion again.
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-phrase`}>
          Type{" "}
          <span className="font-mono">
            {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          </span>{" "}
          to confirm
        </Label>
        <Input
          className="h-12 text-base"
          defaultValue={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          id={`${id}-phrase`}
          readOnly
        />
      </div>

      <HostedAccountProviderAccessRemovalConfirmation
        checked={false}
        id={`${id}-confirmation`}
        onCheckedChange={() => {}}
      />

      <div className="flex flex-col gap-2">
        <Button disabled type="button" size="xl" variant="destructive" className="w-full">
          Delete account
        </Button>
        <Button type="button" size="xl" variant="ghost" className="w-full">
          Cancel
        </Button>
      </div>
    </div>
  );
}
