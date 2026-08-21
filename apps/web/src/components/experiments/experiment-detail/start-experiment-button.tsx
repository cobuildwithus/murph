"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  MailIcon,
  MessageSquareTextIcon,
  SendIcon,
} from "lucide-react";

import { AuthButton } from "@/src/components/ui/auth-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import {
  openExperimentStartContactOption,
  resolveExperimentStartContactAction,
  type ExperimentStartContactChannels,
  type ExperimentStartContactKind,
  type ExperimentStartContactOption,
} from "@/src/lib/experiments/start-experiment-contact";
import { useExperimentStartContactContext } from "./start-experiment-contact-context";

interface StartExperimentButtonProps {
  initialContactChannels?: Partial<ExperimentStartContactChannels> | null;
  murphEmailAddress?: string | null;
  murphPhoneNumber?: string | null;
  protocolDays: number;
  protocolTitle: string;
}

interface StartExperimentChannelDialogProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  options: ExperimentStartContactOption[];
  protocolDays: number;
  protocolTitle: string;
}

const CONTACT_OPTION_ICONS: Record<ExperimentStartContactKind, typeof MessageSquareTextIcon> = {
  email: MailIcon,
  telegram: SendIcon,
  text: MessageSquareTextIcon,
};

export function StartExperimentButton({
  initialContactChannels = null,
  murphEmailAddress = null,
  murphPhoneNumber = null,
  protocolDays,
  protocolTitle,
}: StartExperimentButtonProps) {
  const contactDefaults = useExperimentStartContactContext();
  const resolvedInitialContactChannels =
    initialContactChannels ?? contactDefaults.initialContactChannels;
  const resolvedMurphPhoneNumber = murphPhoneNumber ?? contactDefaults.murphPhoneNumber;
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const startContactAction = useMemo(
    () => resolveExperimentStartContactAction({
      initialContactChannels: resolvedInitialContactChannels,
      murphEmailAddress,
      murphPhoneNumber: resolvedMurphPhoneNumber,
      protocolTitle,
    }),
    [
      protocolTitle,
      resolvedInitialContactChannels,
      murphEmailAddress,
      resolvedMurphPhoneNumber,
    ],
  );

  function handleAuthenticatedStartClick() {
    if (startContactAction.kind === "choose") {
      setChannelDialogOpen(true);
      return;
    }

    openExperimentStartContactOption(startContactAction.option);
  }

  const dialogOptions = startContactAction.kind === "choose"
    ? startContactAction.options
    : [];
  const protocolSummary = `${protocolDays}-day protocol`;

  return (
    <>
      <div className="flex flex-col items-stretch gap-2 md:shrink-0 md:items-center">
        <AuthButton
          size="lg"
          className="rounded-2xl bg-primary py-4 text-base font-semibold text-primary-foreground hover:bg-chart-1 md:px-12"
          onClick={handleAuthenticatedStartClick}
          connectLabel="Start experiment"
        >
          <span>Start Experiment</span>
          <ArrowRightIcon data-icon="inline-end" />
        </AuthButton>
        <span className="text-center font-mono text-[10px]/3.5 uppercase tracking-[0.12em] text-muted-foreground/75">
          {protocolSummary}
        </span>
      </div>

      <StartExperimentChannelDialog
        onOpenChange={setChannelDialogOpen}
        open={channelDialogOpen}
        options={dialogOptions}
        protocolDays={protocolDays}
        protocolTitle={protocolTitle}
      />
    </>
  );
}

export function StartExperimentChannelDialog({
  onOpenChange,
  open,
  options,
  protocolDays,
  protocolTitle,
}: StartExperimentChannelDialogProps) {
  const protocolSummary = `${protocolDays}-day protocol`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!bottom-[max(env(safe-area-inset-bottom),0.75rem)] !left-3 !right-3 !top-auto !w-auto !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-2xl border-border bg-popover p-0 text-popover-foreground sm:!bottom-auto sm:!left-1/2 sm:!right-auto sm:!top-1/2 sm:!w-full sm:!max-w-[540px] sm:!-translate-x-1/2 sm:!-translate-y-1/2">
        <div className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-h-[calc(100dvh-3rem)]">
          <div className="bg-card px-5 pb-5 pt-5 sm:px-6 sm:pb-6 sm:pt-6">
            <DialogHeader className="gap-0 pr-8 sm:pr-9">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px]/3 uppercase tracking-[0.13em] text-primary">
                <span>Start experiment</span>
                <span aria-hidden="true" className="text-border">·</span>
                <span>{protocolSummary}</span>
              </div>
              <DialogTitle className="mt-3 text-pretty font-serif text-[1.65rem]/8 font-semibold tracking-[-0.02em] text-foreground sm:text-3xl/9">
                {protocolTitle}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-[48ch] text-pretty text-sm/6 text-muted-foreground">
                Choose the app you already use. Murph will prepare a short
                message for you to review and send.
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
            <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-muted-foreground">
              Choose an app
            </span>
            <div className="grid gap-2">
              {options.map((option) => (
                <ContactOptionLink key={option.kind} option={option} />
              ))}
            </div>
            <p className="pt-1 text-xs/5 text-muted-foreground">
              Review the message, then send when you&apos;re ready.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContactOptionLink({ option }: { option: ExperimentStartContactOption }) {
  const Icon = CONTACT_OPTION_ICONS[option.kind];
  const isExternal =
    option.kind === "telegram" && /^https?:\/\//u.test(option.href);

  return (
    <a
      href={option.href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      aria-label={`Continue experiment setup in ${option.label}`}
      className="group/channel flex min-h-16 w-full items-center gap-3.5 whitespace-normal rounded-lg border border-border bg-background/55 px-3 py-3 text-left text-foreground outline-none transition-[background-color,border-color,transform] duration-200 hover:border-primary/40 hover:bg-background active:translate-y-px focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover sm:min-h-[72px] sm:px-3.5"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
        <Icon className="size-[18px]" data-icon="inline-start" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-serif text-base/6 font-semibold tracking-normal text-foreground">
          {option.label}
        </span>
        <span className="break-words text-sm/5 text-muted-foreground">
          {option.description}
        </span>
      </span>
      <span className="flex shrink-0 items-center text-muted-foreground transition-[color,transform] duration-200 group-hover/channel:translate-x-0.5 group-hover/channel:text-primary">
        <ChevronRightIcon className="size-4" data-icon="inline-end" />
      </span>
    </a>
  );
}
