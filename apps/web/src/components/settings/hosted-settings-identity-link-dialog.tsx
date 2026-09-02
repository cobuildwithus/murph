"use client";

import {
  type User as PrivyUser,
  usePrivy,
  useUnlinkEmail,
  useUnlinkPhone,
  useUnlinkTelegram,
  useUser,
} from "@privy-io/react-auth";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { HostedAccountSettingsSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import {
  extractHostedPrivyEmailAccount,
  extractHostedPrivyPhoneAccount,
  extractHostedPrivyTelegramAccount,
  resolveHostedPrivyLinkedAccounts,
} from "@/src/lib/hosted-onboarding/privy-shared";
import type { HostedPrivyAuthMethod } from "@/src/lib/hosted-onboarding/types";

import { ConnectedAccountCard, SettingsStatusLine } from "./connected-account-card";
import { HostedEmailPrivyLinkHandOff } from "./hosted-email-privy-link-hand-off";
import { HostedEmailSettings } from "./hosted-email-settings";
import {
  finishHostedLinkedAccountRemovalWithRetry,
  toHostedLinkedAccountRemovalErrorMessage,
} from "./hosted-linked-account-removal";
import { useHostedPhoneLinkDiagnostics } from "./hosted-phone-link-diagnostics";
import { HostedPhoneSettings } from "./hosted-phone-settings";
import { formatMaskedPhoneNumber } from "./hosted-settings-utils";
import { HostedTelegramCardSettings } from "./hosted-telegram-card-settings";

type HostedSettingsIdentityLinkMode = "phone" | "email" | "telegram";
export type HostedSettingsIdentityDialogIntent = "manage" | "remove" | "replace";

export function HostedSettingsIdentityLinkDialog({
  account,
  expectedPrivyUserId,
  intent = "manage",
  initialMode,
  onOpenChange,
  privySessionMatchesAppSession,
}: {
  account: HostedAccountSettingsSnapshot;
  expectedPrivyUserId: string | null;
  intent?: HostedSettingsIdentityDialogIntent;
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
  privySessionMatchesAppSession: boolean;
}) {
  const router = useRouter();
  const { openAuthDialog } = useAuth();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const [providerAccountRemoved, setProviderAccountRemoved] = useState(false);
  const [telegramReplacementReady, setTelegramReplacementReady] = useState(false);
  const effectiveAccount = telegramReplacementReady
    ? {
        ...account,
        telegram: {
          telegramUserId: null,
          username: null,
        },
      }
    : account;
  const effectiveIntent = telegramReplacementReady ? "manage" : intent;

  const closeAndRefresh = () => {
    onOpenChange(false);
    router.refresh();
  };
  const promptClientAuth = () => {
    onOpenChange(false);
    openAuthDialog();
  };
  const handleOpenChange = (open: boolean) => {
    if (!open && providerAccountRemoved) {
      closeAndRefresh();
      return;
    }
    onOpenChange(open);
  };

  if (!appId) {
    return (
      <HostedSettingsIdentityDialogFrame
        account={effectiveAccount}
        intent={effectiveIntent}
        initialMode={initialMode}
        onOpenChange={handleOpenChange}
      >
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          Linking isn&apos;t available yet. Please try again later.
        </div>
      </HostedSettingsIdentityDialogFrame>
    );
  }

  return (
    <HostedSettingsIdentityMutationContent
      account={effectiveAccount}
      expectedPrivyUserId={expectedPrivyUserId}
      intent={effectiveIntent}
      initialMode={initialMode}
      onClientAuthRequired={promptClientAuth}
      onOpenChange={handleOpenChange}
      onProviderAccountRemoved={() => setProviderAccountRemoved(true)}
      onRemoved={() => {
        if (intent === "replace" && initialMode === "telegram") {
          setTelegramReplacementReady(true);
          return;
        }
        closeAndRefresh();
      }}
      onSynced={closeAndRefresh}
      privySessionMatchesAppSession={privySessionMatchesAppSession}
    />
  );
}

function HostedSettingsIdentityMutationContent({
  account,
  expectedPrivyUserId,
  intent,
  initialMode,
  onClientAuthRequired,
  onOpenChange,
  onProviderAccountRemoved,
  onRemoved,
  onSynced,
  privySessionMatchesAppSession,
}: {
  account: HostedAccountSettingsSnapshot;
  expectedPrivyUserId: string | null;
  intent: HostedSettingsIdentityDialogIntent;
  initialMode: HostedSettingsIdentityLinkMode;
  onClientAuthRequired: () => void;
  onOpenChange: (open: boolean) => void;
  onProviderAccountRemoved: () => void;
  onRemoved: () => void;
  onSynced: () => void;
  privySessionMatchesAppSession: boolean;
}) {
  const { authenticated, logout, ready } = usePrivy();
  const { user } = useUser();
  const [reauthError, setReauthError] = useState<string | null>(null);
  const [reauthPending, setReauthPending] = useState(false);
  const clientIdentityPending = !ready || (authenticated && user === null);
  const clientSessionMatchesAppSession =
    ready
    && authenticated
    && privySessionMatchesAppSession
    && expectedPrivyUserId !== null
    && user?.id === expectedPrivyUserId;
  const createPhoneDiagnosticReporter = useHostedPhoneLinkDiagnostics({
    appAuthenticated: true,
    clientUserMatchesExpected: expectedPrivyUserId !== null && user?.id === expectedPrivyUserId,
    clientUserPresent: Boolean(user?.id),
    expectedUserPresent: expectedPrivyUserId !== null,
    operation: user?.phone?.number ? "update" : "link",
    privyAuthenticated: authenticated,
    privyReady: ready,
    serverSessionMatches: privySessionMatchesAppSession,
    showLinkForm: initialMode === "phone",
    surface: "settings",
  });
  const hasExisting = initialMode === "phone"
    ? Boolean(account.phone.number)
    : initialMode === "email"
      ? Boolean(account.email.address)
      : Boolean(account.telegram.telegramUserId);

  async function handleClientAuthRequired() {
    if (reauthPending) {
      return;
    }

    setReauthError(null);
    setReauthPending(true);

    try {
      if (authenticated) {
        await logout();
      }
      onClientAuthRequired();
    } catch {
      setReauthError("Sign out did not finish. Try again.");
    } finally {
      setReauthPending(false);
    }
  }

  if (!clientSessionMatchesAppSession) {
    return (
      <HostedSettingsIdentityDialogFrame
        account={account}
        intent={intent}
        initialMode={initialMode}
        onOpenChange={onOpenChange}
      >
        {clientIdentityPending ? (
          <HostedIdentitySessionLoading />
        ) : (
          <HostedIdentitySessionMismatch
            disabled={reauthPending}
            errorMessage={reauthError}
            onSignInAgain={handleClientAuthRequired}
            pending={reauthPending}
          />
        )}
      </HostedSettingsIdentityDialogFrame>
    );
  }

  if (intent === "remove" || intent === "replace") {
    return (
      <HostedSettingsIdentityDialogFrame
        account={account}
        intent={intent}
        initialMode={initialMode}
        onOpenChange={onOpenChange}
      >
        <HostedSettingsIdentityRemoval
          account={account}
          intent={intent}
          method={initialMode}
          onCancel={() => onOpenChange(false)}
          onProviderAccountRemoved={onProviderAccountRemoved}
          onRemoved={onRemoved}
        />
      </HostedSettingsIdentityDialogFrame>
    );
  }

  // The server told us the Privy user has no email linked, which means the
  // inline update form cannot work — Privy only supports linking an email
  // through its own modal. Skip our dialog entirely and hand off to Privy's,
  // so the member sees a single dialog instead of two stacked ones.
  if (initialMode === "email" && account.email.privyEmailLinked === false) {
    return (
      <HostedEmailPrivyLinkHandOff
        onAborted={() => onOpenChange(false)}
        onSynced={onSynced}
      />
    );
  }

  if (initialMode === "phone") {
    return (
      <HostedPhoneSettings
        autoOpen
        diagnosticReporterFactory={createPhoneDiagnosticReporter}
        initialPhoneNumber={account.phone.number}
        onAborted={() => onOpenChange(false)}
        onLinked={onSynced}
      />
    );
  }

  return (
    <HostedSettingsIdentityDialogFrame
      account={account}
      intent={intent}
      initialMode={initialMode}
      onOpenChange={onOpenChange}
    >
      {initialMode === "telegram" ? (
        <HostedTelegramCardSettings
          authenticated
          autoLink={!hasExisting}
          initialTelegramAccount={account.telegram.telegramUserId
            ? {
                telegramUserId: account.telegram.telegramUserId,
                username: account.telegram.username ?? null,
              }
            : null}
          onSynced={onSynced}
          showHeading={false}
        />
      ) : null}
      {initialMode === "email" ? (
        <HostedEmailSettings
          authenticated
          changeFlow={hasExisting}
          initialEmail={toInitialEmail(account.email)}
          murphEmailAddress={account.email.murphEmailAddress}
          onClientAuthRequired={onClientAuthRequired}
          onSynced={onSynced}
        />
      ) : null}
    </HostedSettingsIdentityDialogFrame>
  );
}

export function HostedIdentitySessionLoading() {
  return (
    <p aria-live="polite" className="text-sm text-muted-foreground">
      Preparing secure account linking…
    </p>
  );
}

export function HostedIdentitySessionMismatch({
  disabled = false,
  errorMessage = null,
  onSignInAgain,
  pending = false,
}: {
  disabled?: boolean;
  errorMessage?: string | null;
  onSignInAgain: () => Promise<void> | void;
  pending?: boolean;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-muted-foreground">
        Your sign-in changed. Sign in again using a login method already linked
        to this Murph account before changing a linked account.
      </p>
      <Button
        type="button"
        size="xl"
        className="w-full"
        disabled={disabled}
        onClick={() => void onSignInAgain()}
      >
        {pending ? "Signing out…" : "Sign in again"}
      </Button>
      {errorMessage ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function HostedSettingsIdentityDialogFrame({
  account,
  children,
  intent = "manage",
  initialMode,
  onOpenChange,
}: {
  account: HostedAccountSettingsSnapshot;
  children: ReactNode;
  intent?: HostedSettingsIdentityDialogIntent;
  initialMode: HostedSettingsIdentityLinkMode;
  onOpenChange: (open: boolean) => void;
}) {
  const hasExisting = initialMode === "phone"
    ? Boolean(account.phone.number)
    : initialMode === "email"
      ? Boolean(account.email.address)
      : Boolean(account.telegram.telegramUserId);
  const copy = getSettingsIdentityLinkCopy(
    initialMode,
    hasExisting,
    account,
    intent,
  );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[min(30rem,calc(100vw-2rem))] gap-6 border border-border/80 bg-popover p-6 text-popover-foreground ring-border sm:max-w-[30rem] md:p-8">
        <DialogHeader className="gap-2 pr-10">
          <DialogTitle className="font-serif text-2xl/8 font-semibold tracking-normal text-popover-foreground">
            {copy.title}
          </DialogTitle>
          <DialogDescription className="max-w-[34ch] text-base/7 text-muted-foreground">
            {copy.description}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function getSettingsIdentityLinkCopy(
  mode: HostedSettingsIdentityLinkMode,
  hasExisting: boolean,
  account: HostedAccountSettingsSnapshot,
  intent: HostedSettingsIdentityDialogIntent,
): {
  description: string;
  title: string;
} {
  if (intent === "remove") {
    return {
      description: getSettingsIdentityRemovalConsequence(mode),
      title: `Remove ${getSettingsIdentityLabel(mode)}?`,
    };
  }

  if (intent === "replace" && mode === "telegram") {
    return {
      description:
        "Your current Telegram will be disconnected first. Then we'll open Telegram so you can link another account.",
      title: "Change Telegram",
    };
  }

  switch (mode) {
    case "phone": {
      if (!hasExisting) {
        return {
          description: "Verify the phone number Murph should use for SMS and iMessage.",
          title: "Link phone",
        };
      }
      const masked = account.phone.number ? formatMaskedPhoneNumber(account.phone.number) : null;
      const phoneVerified = Boolean(account.phone.verifiedAt);
      if (!phoneVerified && masked) {
        return {
          description: `Verify ${masked}, or enter a different number.`,
          title: "Verify phone number",
        };
      }
      return {
        description: masked
          ? `Your current number is ${masked}. Enter a new one below.`
          : "Enter and verify a new phone number.",
        title: "Change phone number",
      };
    }
    case "telegram":
      return hasExisting
        ? {
            description: "Connect a different Telegram account to replace the current one.",
            title: "Change Telegram",
          }
        : {
            description: "Connect your Telegram account so Murph can message you there.",
            title: "Link Telegram",
          };
    case "email": {
      if (!hasExisting) {
        return {
          description: "Verify the email address Murph should use for your account.",
          title: "Link email",
        };
      }
      const isVerified = Boolean(account.email.verifiedAt);
      if (!isVerified) {
        return {
          description: account.email.address
            ? `Verify ${account.email.address}, or enter a different address.`
            : "Verify the email address for your account.",
          title: "Verify email",
        };
      }
      return {
        description: `Your current email is ${account.email.address}. Enter a new one below.`,
        title: "Change email",
      };
    }
  }
}

function HostedSettingsIdentityRemoval({
  account,
  intent,
  method,
  onCancel,
  onProviderAccountRemoved,
  onRemoved,
}: {
  account: HostedAccountSettingsSnapshot;
  intent: "remove" | "replace";
  method: HostedPrivyAuthMethod;
  onCancel: () => void;
  onProviderAccountRemoved: () => void;
  onRemoved: () => void;
}) {
  const { user } = useUser();
  const { unlink: unlinkEmail } = useUnlinkEmail();
  const { unlink: unlinkPhone } = useUnlinkPhone();
  const { unlink: unlinkTelegram } = useUnlinkTelegram();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [providerAccountRemoved, setProviderAccountRemoved] = useState(false);
  const removable = account.removableSignInMethods?.includes(method) === true;
  const [expectedIdentity] = useState(() =>
    resolveSettingsIdentityProviderValue(method, user)
  );
  const displayValue = resolveSettingsIdentityDisplayValue(method, account);
  const label = getSettingsIdentityLabel(method);

  async function handleRemoval() {
    if (pending) {
      return;
    }
    if (!removable) {
      setErrorMessage(
        `Add another email, phone, or Telegram sign-in before removing ${label.toLowerCase()}.`,
      );
      return;
    }
    if (!expectedIdentity) {
      setErrorMessage("This sign-in changed. Refresh Settings and try again.");
      return;
    }

    setErrorMessage(null);
    setPending(true);
    let providerRemoved = providerAccountRemoved;

    try {
      if (!providerRemoved) {
        if (method === "phone") {
          await unlinkPhone({ phoneNumber: expectedIdentity });
        } else if (method === "email") {
          await unlinkEmail({ address: expectedIdentity });
        } else {
          await unlinkTelegram({ telegramUserId: expectedIdentity });
        }
        providerRemoved = true;
        setProviderAccountRemoved(true);
        onProviderAccountRemoved();
      }

      await finishHostedLinkedAccountRemovalWithRetry({
        expectedIdentity,
        method,
      });
      onRemoved();
    } catch (error) {
      setErrorMessage(
        toHostedLinkedAccountRemovalErrorMessage(error, providerRemoved),
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <HostedSettingsIdentityRemovalView
      displayValue={displayValue}
      errorMessage={errorMessage}
      intent={intent}
      label={label}
      onCancel={onCancel}
      onRemove={() => void handleRemoval()}
      pending={pending}
      providerAccountRemoved={providerAccountRemoved}
      removable={removable}
    />
  );
}

export function HostedSettingsIdentityRemovalView({
  displayValue,
  errorMessage,
  intent,
  label,
  onCancel,
  onRemove,
  pending,
  providerAccountRemoved,
  removable,
}: {
  displayValue: string;
  errorMessage: string | null;
  intent: "remove" | "replace";
  label: string;
  onCancel: () => void;
  onRemove: () => void;
  pending: boolean;
  providerAccountRemoved: boolean;
  removable: boolean;
}) {
  return (
    <div className="space-y-5">
      <ConnectedAccountCard
        label={`Current ${label.toLowerCase()}`}
        value={displayValue}
      />
      <p className="text-sm leading-6 text-muted-foreground">
        {removable
          ? "Another linked sign-in will keep your Murph account accessible. Existing messages and billing records stay in your account."
          : "Add another email, phone, or Telegram sign-in first so you don't lose access to your Murph account."}
      </p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant={intent === "remove" ? "destructive" : "default"}
          disabled={pending || !removable}
          onClick={onRemove}
        >
          {pending
            ? providerAccountRemoved
              ? "Finishing…"
              : "Removing…"
            : providerAccountRemoved
              ? "Finish removing"
              : intent === "replace"
                ? "Disconnect and continue"
                : `Remove ${label}`}
        </Button>
      </div>
      <SettingsStatusLine
        message={errorMessage}
        tone={errorMessage ? "destructive" : "neutral"}
      />
    </div>
  );
}

function resolveSettingsIdentityProviderValue(
  method: HostedPrivyAuthMethod,
  user: PrivyUser | null,
): string | null {
  if (method === "phone") {
    return extractHostedPrivyPhoneAccount(
      resolveHostedPrivyLinkedAccounts(user),
    )?.number ?? null;
  }
  if (method === "email") {
    return extractHostedPrivyEmailAccount(
      resolveHostedPrivyLinkedAccounts(user),
    )?.address ?? null;
  }

  return extractHostedPrivyTelegramAccount(user)?.telegramUserId ?? null;
}

function resolveSettingsIdentityDisplayValue(
  method: HostedPrivyAuthMethod,
  account: HostedAccountSettingsSnapshot,
): string {
  if (method === "phone") {
    return account.phone.number
      ? formatMaskedPhoneNumber(account.phone.number)
      : "Not connected";
  }
  if (method === "email") {
    return account.email.address ?? "Not connected";
  }

  return account.telegram.username
    ? `@${account.telegram.username}`
    : account.telegram.telegramUserId
      ? "Connected"
      : "Not connected";
}

function getSettingsIdentityLabel(mode: HostedPrivyAuthMethod): string {
  return mode === "phone" ? "Phone" : mode === "email" ? "Email" : "Telegram";
}

function getSettingsIdentityRemovalConsequence(
  mode: HostedPrivyAuthMethod,
): string {
  if (mode === "phone") {
    return "This removes phone sign-in and disconnects texting with Murph.";
  }
  if (mode === "email") {
    return "This removes email sign-in and disconnects email with Murph.";
  }
  return "This removes Telegram sign-in and disconnects Telegram messaging with Murph.";
}

function toInitialEmail(
  email: HostedAccountSettingsSnapshot["email"],
) {
  if (!email.address) {
    return null;
  }

  return {
    address: email.address,
    verifiedAt: toPrivyTimestampSeconds(email.verifiedAt),
  };
}

function toPrivyTimestampSeconds(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) ? Math.trunc(timestampMs / 1000) : null;
}
