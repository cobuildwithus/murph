import Image from "next/image";
import { AlertCircleIcon, MessageCircleIcon } from "lucide-react";
import { defaultAssistantVoiceOptionId } from "@murphai/contracts";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { MurphPulseLoader } from "@/src/components/ui/murph-pulse-loader";
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
  errorMessage,
  inert = false,
  pending,
  source,
  onConfirm,
  onOpenChange,
}: {
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
            {resolveDisconnectDialogDescription(source)}
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
): string {
  const description = source?.disconnectScope === "junction_account"
    ? "Murph will stop syncing new data from every source in this connection. Your history is kept."
    : `Murph will stop syncing new data from ${source?.name ?? "this source"}. Your history is kept.`;

  return source?.connectionAvailable === false
    ? `${description} You won’t be able to reconnect it through Murph until this connection becomes available.`
    : description;
}

export function ConnectRedirectDialog({
  sourceName,
}: {
  sourceName: string | null;
}) {
  return (
    <Dialog open={Boolean(sourceName)}>
      <DialogContent
        showCloseButton={false}
        className="max-w-sm gap-5 p-6 md:p-7"
      >
        <DialogHeader className="items-center text-center">
          <MurphPulseLoader className="mb-1 h-10 w-auto" />
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {sourceName ? `Connecting ${sourceName}` : "Connecting"}
          </DialogTitle>
          <DialogDescription>
            Hang tight &mdash; we&apos;re taking you to{" "}
            {sourceName ?? "your source"} to finish setting up the connection.
            This only takes a moment.
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
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
  const resolvedContactAction =
    contactAction ?? buildConnectIntentRecoveryFallbackContactAction();
  const contactLabel = resolveConnectIntentRecoveryContactLabel(
    resolvedContactAction,
  );

  return (
    <Dialog open={Boolean(request)} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md gap-6 rounded-2xl border border-border bg-popover p-6 text-popover-foreground ring-border md:p-7"
      >
        <DialogHeader className="items-center gap-4 text-center">
          <span
            aria-hidden="true"
            className="flex size-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive"
          >
            <AlertCircleIcon className="size-8" />
          </span>
          <div className="flex flex-col gap-2">
            <DialogTitle className="font-serif text-2xl/7 font-semibold tracking-normal text-foreground">
              Connection link unavailable
            </DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {request?.message ??
                "This connection link is no longer available."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <a
            aria-label={resolveConnectIntentRecoveryContactAriaLabel({
              action: resolvedContactAction,
              label: contactLabel,
              sourceName: request?.sourceName ?? null,
            })}
            className={buttonVariants({
              className: "w-full",
              size: "xl",
            })}
            href={resolvedContactAction.href}
            rel={resolvedContactAction.rel}
            target={resolvedContactAction.target}
          >
            <MessageCircleIcon data-icon="inline-start" />
            {contactLabel}
          </a>
          <Button
            type="button"
            className="w-full"
            size="xl"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Continue exploring
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildConnectIntentRecoveryFallbackContactAction(): MurphContactOption {
  return {
    href: buildMurphEmailHref({
      body: "Can you send me a fresh device connection link?",
      subject: "Fresh device connection link",
    }),
    kind: "email",
    label: "Email",
  };
}

function resolveConnectIntentRecoveryContactLabel(
  action: MurphContactOption,
): string {
  if (action.kind === "text" || action.kind === "telegram") {
    return "Text Murph";
  }

  return "Email Murph";
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
