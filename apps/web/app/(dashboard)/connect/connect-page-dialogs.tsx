import {
  AlertCircleIcon,
  LoaderCircleIcon,
  MessageCircleIcon,
} from "lucide-react";

import { HostedLegalConsentCard } from "@/src/components/legal/hosted-legal-consent-card";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  buildMurphEmailHref,
  type MurphContactOption,
} from "@/src/lib/murph-contact-routing";

import type { ConnectIntentRecoveryRequest, ConnectSource } from "./connect-page-types";

export function ConnectConsentDialog({
  source,
  onAccepted,
  onOpenChange,
}: {
  onAccepted: (source: ConnectSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  source: ConnectSource | null;
}) {
  const open = Boolean(source);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {source ? `Before you connect ${source.name}` : "Before you connect"}
          </DialogTitle>
          <DialogDescription>
            Review Murph&apos;s current legal and health-data consent before continuing.
          </DialogDescription>
        </DialogHeader>
        {source ? (
          <HostedLegalConsentCard
            mode="compact"
            source="connect-page"
            onAccepted={async () => {
              await onAccepted(source);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ConnectDisconnectDialog({
  errorMessage,
  pending,
  source,
  onConfirm,
  onOpenChange,
}: {
  errorMessage: string | null;
  pending: boolean;
  source: ConnectSource | null;
  onConfirm: (source: ConnectSource) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(source)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-6 p-6 md:p-7">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            Disconnect {source?.name ?? "source"}?
          </DialogTitle>
          <DialogDescription>
            Murph will stop syncing new data from this connection. Your history is kept.
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

export function ConnectRedirectDialog({ sourceName }: { sourceName: string | null }) {
  return (
    <Dialog open={Boolean(sourceName)}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-5 p-6 md:p-7">
        <DialogHeader className="items-center text-center">
          <span
            aria-hidden="true"
            className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          </span>
          <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
            {sourceName ? `Connecting ${sourceName}` : "Connecting"}
          </DialogTitle>
          <DialogDescription>
            Hang tight &mdash; we&apos;re taking you to {sourceName ?? "your source"} to finish setting up
            the connection. This only takes a moment.
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
  const resolvedContactAction = contactAction ?? buildConnectIntentRecoveryFallbackContactAction();
  const contactLabel = resolveConnectIntentRecoveryContactLabel(resolvedContactAction);

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
              {request?.message ?? "This connection link is no longer available."}
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

function resolveConnectIntentRecoveryContactLabel(action: MurphContactOption): string {
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
  const suffix = input.action.target === "_blank" ? " (opens in a new tab)" : "";
  return `${input.label} for a fresh ${sourceName} connection link${suffix}`;
}
