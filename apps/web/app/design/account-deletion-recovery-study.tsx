"use client";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  HostedAccountDeletionErrorAlert,
  HostedAccountProviderAccessRemovalConfirmation,
} from "@/src/components/settings/hosted-data-privacy-settings";
import { HOSTED_STRIPE_EFFECT_PENDING_MESSAGE } from "@/src/lib/hosted-onboarding/errors";
import {
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_CLEANUP_BACKLOG_MESSAGE,
  HOSTED_ACCOUNT_DELETION_CONNECTED_APP_SETUP_IN_PROGRESS_MESSAGE,
  HOSTED_ACCOUNT_DELETION_CONFIRMATION_PHRASE,
} from "@/src/lib/hosted-privacy/account-data-shared";

/**
 * Exceptional confirmation states of the delete-account dialog: a concurrent
 * billing change, an OAuth callback whose provider-side result is no longer
 * knowable, and a connected-app setup that still owns its completion window.
 *
 * What this frame proves: the exact sentence a member reads, and that it fits
 * its container at desktop and mobile widths. The sentence is imported from the
 * same constant the route returns, so the copy cannot drift.
 *
 * What it does not prove: this reproduces the dialog shell rather than mounting
 * the stateful shipped flow, so it is not evidence about focus order, the close
 * affordance, or constrained-height scrolling. It does mount the production
 * error alert used by /settings. The arrival and retry paths are proven by the
 * route and component tests.
 */
export function AccountDeletionRecoveryStudy() {
  return (
    <div
      className="flex flex-col gap-8"
      data-design-study="account-deletion-recovery"
      id="account-deletion-recovery"
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        Recoverable delete-account conflicts in <code>/settings</code>. A billing
        change keeps the dialog, typed confirmation, and retry action in place.
        These frames use the production error alert to prove copy and
        containment; focus, close, and scroll behaviour belong to the real
        dialog.
      </p>

      <div
        className="flex flex-col gap-4"
        data-design-state="stripe-effect-pending"
      >
        <div className="max-w-2xl space-y-1">
          <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
            Billing change in progress
          </h3>
          <p className="text-sm leading-6 text-muted-foreground">
            The member can retry from the same confirmation state after the
            in-flight billing change finishes.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div data-design-proof="stripe-effect-pending-desktop">
            <DialogFrame label="Desktop" width="max-w-md">
              <AccountDeletionMessageDialogBody
                id="design-stripe-effect-pending-desktop"
                message={HOSTED_STRIPE_EFFECT_PENDING_MESSAGE}
              />
            </DialogFrame>
          </div>
          <div data-design-proof="stripe-effect-pending-mobile">
            <DialogFrame label="Mobile · 390px" width="max-w-[390px]">
              <AccountDeletionMessageDialogBody
                id="design-stripe-effect-pending-mobile"
                message={HOSTED_STRIPE_EFFECT_PENDING_MESSAGE}
              />
            </DialogFrame>
          </div>
        </div>
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

      <HostedAccountDeletionErrorAlert
        message="Remove Murph access from Oura and Strava, then confirm below."
        providerAccessRemovalRequired
      />

      <div className="flex flex-col gap-2">
        <Label className="block leading-5" htmlFor={`${id}-phrase`}>
          Type{" "}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] tracking-wide text-foreground">
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

      <HostedAccountDeletionErrorAlert message={message} />

      <div className="flex flex-col gap-2">
        <Label className="block leading-5" htmlFor={`${id}-phrase`}>
          Type{" "}
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] tracking-wide text-foreground">
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
