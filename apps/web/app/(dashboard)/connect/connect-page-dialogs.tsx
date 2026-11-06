import type { ReactNode } from "react";
import Image from "next/image";
import { MessageCircleIcon } from "lucide-react";
import { defaultAssistantVoiceOptionId } from "@murphai/contracts";

import { LinkPageContactPill } from "@/src/components/link-page/link-page-contact";
import { LinkPageDots } from "@/src/components/link-page/link-page-dots";
import { LinkPagePair } from "@/src/components/link-page/link-page-pair";
import {
  LINK_PAGE_LINK_CLASS,
  LINK_PAGE_PILL_CLASS,
  LinkPageLink,
  LinkPagePill,
  LinkPageScreen,
} from "@/src/components/link-page/link-page-shell";
import { LinkPageSignInScreen } from "@/src/components/link-page/link-page-sign-in";
import { LinkPageTakeover } from "@/src/components/link-page/link-page-takeover";
import { Button } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { VoiceMemoPlayer } from "@/src/components/ui/voice-memo-player";
import {
  buildMurphEmailHref,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

import type {
  ConnectIntentRecoveryRequest,
  ConnectSource,
} from "./connect-page-types";

const DEFAULT_GARMIN_HISTORICAL_DATA_VOICE_MEMO_SRC = `/audio/garmin-historical-data-memos/${defaultAssistantVoiceOptionId}.mp3`;

export function ConnectSourceDialog({
  children,
  inert = false,
  onOpenChange,
  source,
}: {
  children?: ReactNode;
  inert?: boolean;
  onOpenChange: (open: boolean) => void;
  source: Pick<ConnectSource, "name"> | null;
}) {
  const sourceName = source?.name ?? "Health source";

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-md gap-0 overflow-y-auto p-6 md:p-7"
        inert={inert || undefined}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{sourceName} connection</DialogTitle>
          <DialogDescription>
            Review the current connection status and available actions for {sourceName}.
          </DialogDescription>
        </DialogHeader>
        {source ? children : null}
      </DialogContent>
    </Dialog>
  );
}

export function VitalConnectionDialog({
  onContinue,
  onOpenChange,
  source,
  voiceMemoSrc,
}: {
  onContinue: () => void;
  onOpenChange: (open: boolean) => void;
  source: Pick<ConnectSource, "id" | "logo" | "name" | "requiresReconnect"> | null;
  voiceMemoSrc?: string | null;
}) {
  const sourceName = source?.name ?? "your health source";
  const showGarminHistoricalData =
    source?.id === "garmin" && source.requiresReconnect !== true;

  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-5 p-6 sm:max-w-md md:p-7"
        finalFocus={true}
      >
        <DialogHeader className="items-center gap-4 pt-2 text-center">
          {source ? (
            <div aria-hidden="true" className="flex items-center gap-3">
              <span className="flex h-16 min-w-16 max-w-28 items-center justify-center rounded-2xl bg-background px-3 ring-1 ring-border">
                <Image
                  src={source.logo.src}
                  alt=""
                  width={source.logo.width}
                  height={source.logo.height}
                  className="h-auto max-h-10 w-auto max-w-24 object-contain"
                />
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1 rounded-full bg-muted-foreground/40" />
                <span className="size-1 rounded-full bg-muted-foreground/40" />
                <span className="size-1 rounded-full bg-muted-foreground/40" />
              </span>
              <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-background p-2.5 ring-1 ring-border">
                <Image
                  src="/icons/murph-mark.svg"
                  alt=""
                  width={66}
                  height={44}
                  className="h-auto w-full"
                />
              </span>
            </div>
          ) : null}
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl font-semibold tracking-normal text-foreground">
              Connect {sourceName} to Murph
            </DialogTitle>
            <DialogDescription className="leading-6">
              We use{" "}
              <a
                href="https://www.junction.com"
                target="_blank"
                rel="noreferrer"
              >
                Vital
              </a>{" "}
              to connect this health source to Murph.
            </DialogDescription>
          </div>
        </DialogHeader>

        {showGarminHistoricalData ? (
          <>
            <div className="border-t border-border pt-3 text-sm leading-6 text-muted-foreground">
              <p className="font-medium text-foreground">
                Turn on Historical Data
              </p>
              <p className="mt-1">
                When Garmin opens, turn on Historical Data before approving.
              </p>
            </div>

            <VoiceMemoPlayer
              accessibleLabel="Garmin Historical Data reminder"
              src={
                voiceMemoSrc ?? DEFAULT_GARMIN_HISTORICAL_DATA_VOICE_MEMO_SRC
              }
              bars={24}
              preload="metadata"
              containerClassName="rounded-lg bg-background px-3 py-2 ring-1 ring-border"
              accentClassName="bg-primary"
              fillClassName="bg-primary"
              trackClassName="bg-primary/20"
            />
          </>
        ) : null}

        <Button
          type="button"
          size="xl"
          className="h-auto min-h-14 w-full whitespace-normal py-3 text-center leading-tight"
          onClick={onContinue}
        >
          Continue to {sourceName}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function ConnectDisconnectDialog({
  affectedUnavailableSourceNames = [],
  errorMessage,
  inert = false,
  pending,
  source,
  onConfirm,
  onOpenChange,
}: {
  affectedUnavailableSourceNames?: readonly string[];
  errorMessage: string | null;
  inert?: boolean;
  pending: boolean;
  source: ConnectSource | null;
  onConfirm: (source: ConnectSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md gap-6 p-6 md:p-7"
        inert={inert || undefined}
      >
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {resolveDisconnectDialogTitle(source)}
          </DialogTitle>
          <DialogDescription>
            {resolveDisconnectDialogDescription(
              source,
              affectedUnavailableSourceNames,
            )}
          </DialogDescription>
        </DialogHeader>
        {errorMessage ? (
          <p role="alert" className="text-sm leading-relaxed text-destructive">
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xl"
            onClick={() => {
              if (source) {
                void onConfirm(source);
              }
            }}
            disabled={pending}
            className="w-full"
          >
            {pending ? "Disconnecting..." : "Disconnect"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="w-full"
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function resolveDisconnectDialogTitle(source: ConnectSource | null): string {
  if (source?.disconnectScope === "junction_account") {
    return "Disconnect account?";
  }

  return `Disconnect ${source?.name ?? "source"}?`;
}

function resolveDisconnectDialogDescription(
  source: ConnectSource | null,
  affectedUnavailableSourceNames: readonly string[],
): string {
  const reconnectUnavailable = source?.connectionAvailable === false;

  if (source?.disconnectScope === "junction_account") {
    const unavailableNames = [...new Set(affectedUnavailableSourceNames)];
    const consequence = unavailableNames.length === 0
      ? ""
      : unavailableNames.length === 1 && unavailableNames[0] === source.name
        ? ` You won't be able to reconnect ${source.name} yet.`
        : ` This also disconnects ${formatSourceNames(unavailableNames)}, which cannot be reconnected yet.`;
    return `Murph will stop syncing new data from every source in this connection. Your history is kept.${consequence}`;
  }

  const sourceName = source?.name ?? "this source";
  const consequence = reconnectUnavailable
    ? ` You won't be able to reconnect ${sourceName} yet.`
    : "";
  return `Murph will stop syncing new data from ${sourceName}. Your history is kept.${consequence}`;
}

function formatSourceNames(sourceNames: readonly string[]): string {
  if (sourceNames.length < 2) {
    return sourceNames[0] ?? "an unavailable source";
  }
  if (sourceNames.length === 2) {
    return `${sourceNames[0]} and ${sourceNames[1]}`;
  }
  return `${sourceNames.slice(0, -1).join(", ")}, and ${sourceNames.at(-1)}`;
}

const LINK_NOT_WORKING_TITLE = "This link isn’t working.";

export function ConnectLinkSignInTakeover({
  source,
}: {
  source: Pick<ConnectSource, "logo" | "name"> | null;
}) {
  return (
    <LinkPageTakeover label={connectLinkSignInTitle(source)}>
      <ConnectLinkSignInScreen source={source} />
    </LinkPageTakeover>
  );
}

export function ConnectLinkSignInScreen({
  source,
}: {
  source: Pick<ConnectSource, "logo" | "name"> | null;
}) {
  return (
    <LinkPageSignInScreen title={connectLinkSignInTitle(source)}>
      {source ? <LinkPagePair logoSrc={source.logo.src} name={source.name} /> : null}
    </LinkPageSignInScreen>
  );
}

function connectLinkSignInTitle(source: Pick<ConnectSource, "name"> | null): string {
  return `Sign in to connect ${source?.name ?? "your device"}.`;
}

export function ConnectLinkReadyTakeover({
  onContinue,
  onOpenChange,
  source,
  voiceMemoSrc,
}: {
  onContinue: () => void;
  onOpenChange: (open: boolean) => void;
  source: Pick<ConnectSource, "id" | "logo" | "name" | "requiresReconnect"> | null;
  voiceMemoSrc?: string | null;
}) {
  return (
    <LinkPageTakeover
      label={`Connect ${source?.name ?? "your device"}.`}
      onOpenChange={onOpenChange}
      open={Boolean(source)}
    >
      {source ? (
        <ConnectLinkReadyScreen
          onContinue={onContinue}
          source={source}
          voiceMemoSrc={voiceMemoSrc}
        />
      ) : null}
    </LinkPageTakeover>
  );
}

export function ConnectLinkReadyScreen({
  onContinue,
  source,
  voiceMemoSrc,
}: {
  onContinue?: () => void;
  source: Pick<ConnectSource, "id" | "logo" | "name" | "requiresReconnect">;
  voiceMemoSrc?: string | null;
}) {
  const showGarminHistoricalData =
    source.id === "garmin" && source.requiresReconnect !== true;

  return (
    <LinkPageScreen
      actions={
        <LinkPagePill onClick={onContinue}>Continue to {source.name}</LinkPagePill>
      }
      announceDetail={false}
      detail={showGarminHistoricalData
        ? "When Garmin opens, turn on Historical Data before approving."
        : `You’ll sign in at ${source.name}, then come back here.`}
      title={`Connect ${source.name}.`}
    >
      <LinkPagePair logoSrc={source.logo.src} name={source.name} />
      {showGarminHistoricalData ? (
        <VoiceMemoPlayer
          accessibleLabel="Garmin Historical Data reminder"
          accentClassName="bg-[#D9B969]"
          bars={24}
          containerClassName="mt-8 rounded-[18px] bg-[#2A2622] px-3 py-2"
          fillClassName="bg-[#D9B969]"
          preload="metadata"
          src={voiceMemoSrc ?? DEFAULT_GARMIN_HISTORICAL_DATA_VOICE_MEMO_SRC}
          trackClassName="bg-[#D9B969]/20"
        />
      ) : null}
    </LinkPageScreen>
  );
}

export function ConnectRedirectDialog({
  sourceName,
}: {
  sourceName: string | null;
}) {
  return (
    <LinkPageTakeover
      label={`Connecting ${sourceName ?? "your device"}.`}
      open={Boolean(sourceName)}
    >
      <ConnectRedirectScreen sourceName={sourceName} />
    </LinkPageTakeover>
  );
}

export function ConnectRedirectScreen({
  sourceName,
}: {
  sourceName: string | null;
}) {
  return (
    <LinkPageScreen
      detail={`Taking you to ${sourceName ?? "your source"}.`}
      title={sourceName ? `Connecting ${sourceName}.` : "Connecting."}
    >
      <LinkPageDots />
    </LinkPageScreen>
  );
}

export function ConnectIntentRecoveryDialog({
  contactAction,
  onOpenChange,
  request,
}: {
  contactAction: MurphContactOption | null;
  onOpenChange: (open: boolean) => void;
  request: ConnectIntentRecoveryRequest | null;
}) {
  return (
    <LinkPageTakeover
      label={LINK_NOT_WORKING_TITLE}
      onOpenChange={onOpenChange}
      open={Boolean(request)}
    >
      <ConnectIntentRecoveryScreen
        contactAction={contactAction}
        onContinueExploring={() => onOpenChange(false)}
        request={request}
      />
    </LinkPageTakeover>
  );
}

export function ConnectIntentRecoveryScreen({
  contactAction,
  onContinueExploring,
  request,
}: {
  contactAction: MurphContactOption | null;
  onContinueExploring?: () => void;
  request: ConnectIntentRecoveryRequest | null;
}) {
  const resolvedContactAction =
    contactAction ?? buildConnectIntentRecoveryFallbackContactAction();
  const usesPublicBootstrap = contactAction === null;
  const contactLabel = resolveConnectIntentRecoveryContactLabel(
    resolvedContactAction,
  );

  return (
    <LinkPageScreen
      actions={
        <>
          <a
            aria-label={resolveConnectIntentRecoveryContactAriaLabel({
              action: resolvedContactAction,
              label: contactLabel,
              sourceName: request?.sourceName ?? null,
            })}
            className={LINK_PAGE_PILL_CLASS}
            href={resolvedContactAction.href}
            rel={resolvedContactAction.rel}
            target={resolvedContactAction.target}
          >
            <MessageCircleIcon aria-hidden="true" className="size-5 shrink-0" />
            {contactLabel}
          </a>
          <LinkPageLink onClick={onContinueExploring}>Continue exploring</LinkPageLink>
        </>
      }
      detail={
        <>
          {request?.message ?? "This connection link is no longer available."}
          {usesPublicBootstrap
            ? " Email Murph to receive a private reply, then ask for a fresh connection link. If it does not arrive within a few minutes, resend the email."
            : null}
        </>
      }
      title={LINK_NOT_WORKING_TITLE}
    />
  );
}

export function ConnectLinkFailedTakeover({
  contactAction,
  onContinueExploring,
  onRetry,
  source,
}: {
  contactAction: MurphContactOption | null;
  onContinueExploring: () => void;
  onRetry: () => void;
  source: Pick<ConnectSource, "logo" | "name">;
}) {
  return (
    <LinkPageTakeover
      label={`${source.name} didn’t connect.`}
      onOpenChange={(open) => {
        if (!open) {
          onContinueExploring();
        }
      }}
    >
      <ConnectLinkFailedScreen
        contactAction={contactAction}
        onContinueExploring={onContinueExploring}
        onRetry={onRetry}
        source={source}
      />
    </LinkPageTakeover>
  );
}

export function ConnectLinkFailedScreen({
  contactAction,
  onContinueExploring,
  onRetry,
  source,
}: {
  contactAction: MurphContactOption | null;
  onContinueExploring?: () => void;
  onRetry?: () => void;
  source: Pick<ConnectSource, "logo" | "name">;
}) {
  return (
    <LinkPageScreen
      actions={
        <>
          <LinkPagePill onClick={onRetry}>Try again</LinkPagePill>
          {contactAction ? (
            <a
              className={LINK_PAGE_LINK_CLASS}
              href={contactAction.href}
              rel={contactAction.rel}
              target={contactAction.target}
            >
              Open {contactAction.label}
            </a>
          ) : (
            <LinkPageLink onClick={onContinueExploring}>Continue exploring</LinkPageLink>
          )}
        </>
      }
      detail="Nothing changed. Try again."
      title={`${source.name} didn’t connect.`}
    >
      <LinkPagePair logoSrc={source.logo.src} name={source.name} />
    </LinkPageScreen>
  );
}

/** The link was fine, but there is nothing for it to start. */
export function ConnectLinkSettledTakeover({
  contactAction,
  onContinueExploring,
  source,
}: {
  contactAction: MurphContactOption | null;
  onContinueExploring: () => void;
  source: Pick<ConnectSource, "logo" | "name"> | null;
}) {
  return (
    <LinkPageTakeover
      label={connectLinkSettledTitle(source)}
      onOpenChange={(open) => {
        if (!open) {
          onContinueExploring();
        }
      }}
    >
      <ConnectLinkSettledScreen
        contactAction={contactAction}
        onContinueExploring={onContinueExploring}
        source={source}
      />
    </LinkPageTakeover>
  );
}

export function ConnectLinkSettledScreen({
  contactAction,
  onContinueExploring,
  source,
}: {
  contactAction: MurphContactOption | null;
  onContinueExploring?: () => void;
  source: Pick<ConnectSource, "logo" | "name"> | null;
}) {
  return (
    <LinkPageScreen
      actions={
        <>
          {contactAction ? <LinkPageContactPill option={contactAction} /> : null}
          <LinkPageLink onClick={onContinueExploring}>Continue exploring</LinkPageLink>
        </>
      }
      detail={source ? "Go back to your chat." : "Ask Murph for a new one."}
      title={connectLinkSettledTitle(source)}
    >
      {source ? (
        <LinkPagePair joined logoSrc={source.logo.src} name={source.name} />
      ) : null}
    </LinkPageScreen>
  );
}

function connectLinkSettledTitle(source: Pick<ConnectSource, "name"> | null): string {
  return source ? `${source.name} is connected.` : LINK_NOT_WORKING_TITLE;
}

function buildConnectIntentRecoveryFallbackContactAction(): MurphContactOption {
  return {
    href: buildMurphEmailHref({
      body: "Please send me a private Murph reply.",
      subject: "Start a private Murph conversation",
    }),
    kind: "email",
    label: "Email",
  };
}

function resolveConnectIntentRecoveryContactLabel(
  action: MurphContactOption,
): string {
  if (action.kind === "text") {
    return "Open Messages";
  }

  return action.kind === "telegram" ? "Text Murph" : "Email Murph";
}

function resolveConnectIntentRecoveryContactAriaLabel(input: {
  action: MurphContactOption;
  label: string;
  sourceName: string | null;
}): string {
  const sourceName = input.sourceName ?? "device";
  const suffix =
    input.action.target === "_blank" ? " (opens in a new tab)" : "";
  return `${input.label} for a fresh ${sourceName} connection link${suffix}`;
}
