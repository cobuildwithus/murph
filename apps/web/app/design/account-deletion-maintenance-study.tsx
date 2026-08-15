"use client";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { HostedAccountProviderAccessRemovalConfirmation } from "@/src/components/settings/hosted-data-privacy-settings";
import { HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE } from "@/src/lib/hosted-privacy/account-deletion-maintenance";
import {
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE,
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE,
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "@/src/lib/hosted-privacy/account-data-shared";

/**
 * Exceptional confirmation states of the delete-account dialog: maintenance,
 * an OAuth callback whose provider-side result is no longer knowable, and a
 * connected-app setup that still owns its completion window.
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
 * Once the OC buckets are retired, delete only the temporary maintenance copy
 * and frames. Keep the durable provider and connected-app recovery sections in
 * the catalog.
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
          <AccountDeletionMessageDialogBody
            id="design-maintenance-desktop"
            message={HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE}
          />
        </DialogFrame>
        <DialogFrame label="Mobile · 390px" width="max-w-[390px]">
          <AccountDeletionMessageDialogBody
            id="design-maintenance-mobile"
            message={HOSTED_ACCOUNT_DELETION_MAINTENANCE_MESSAGE}
          />
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

      <div
        className="flex flex-col gap-4"
        id="connected-app-completion-recovery"
      >
        <div className="max-w-2xl space-y-1">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Connected-app completion recovery
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            If one or several connected-app setups still own their completion
            window, the dialog keeps the typed confirmation visible and names
            the truthful retry boundary. A retry still requests fresh
            authorization.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <DialogFrame label="One setup · Desktop" width="max-w-md">
            <AccountDeletionMessageDialogBody
              id="design-connected-app-setup-desktop"
              message={HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE}
            />
          </DialogFrame>
          <DialogFrame label="One setup · Mobile · 390px" width="max-w-[390px]">
            <AccountDeletionMessageDialogBody
              id="design-connected-app-setup-mobile"
              message={HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE}
            />
          </DialogFrame>
          <DialogFrame label="Several setups · Desktop" width="max-w-md">
            <AccountDeletionMessageDialogBody
              id="design-connected-app-backlog-desktop"
              message={HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE}
            />
          </DialogFrame>
          <DialogFrame label="Several setups · Mobile · 390px" width="max-w-[390px]">
            <AccountDeletionMessageDialogBody
              id="design-connected-app-backlog-mobile"
              message={HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE}
            />
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

function ProviderRecoveryDialogBody({ id }: { id: string }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 pr-10">
        <h2 className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
          Delete account
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Deletes your account, data, subscription, and login permanently. This
          cannot be undone.
        </p>
      </div>

      <p
        role="alert"
        className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-5 text-destructive"
      >
        Remove Murph access from Oura and Strava, then confirm below.
      </p>

      <div className="flex flex-col gap-2">
        <Label className="block leading-5" htmlFor={`${id}-phrase`}>
          Type{" "}
          <span className="font-mono text-xs tracking-wide">
            {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          </span>{" "}
          to confirm
        </Label>
        <Input
          className="h-12 font-mono text-sm tracking-wide md:text-sm"
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

function AccountDeletionMessageDialogBody({
  id,
  message,
}: {
  id: string;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-6" data-design-state={id}>
      <div className="flex flex-col gap-2 pr-10">
        <h2 className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
          Delete account
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Deletes your account, data, subscription, and login permanently. This
          cannot be undone.
        </p>
      </div>

      <p
        className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-5 text-destructive [overflow-wrap:anywhere]"
        role="alert"
      >
        {message}
      </p>

      <div className="flex flex-col gap-2">
        <Label className="block leading-5" htmlFor={`${id}-phrase`}>
          Type{" "}
          <span className="font-mono text-xs tracking-wide">
            {HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          </span>{" "}
          to confirm
        </Label>
        <Input
          autoComplete="off"
          className="h-12 font-mono text-sm tracking-wide md:text-sm"
          defaultValue={HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE}
          id={`${id}-phrase`}
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
