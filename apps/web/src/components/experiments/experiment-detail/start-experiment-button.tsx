"use client";

import { useMemo, useState } from "react";
import {
  ArrowRightIcon,
  ChevronRightIcon,
  MailIcon,
  MessageSquareTextIcon,
  NotebookPenIcon,
  SendIcon,
} from "lucide-react";

import { AuthButton } from "@/src/components/ui/auth-button";
import { buttonVariants } from "@/src/components/ui/button";
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
import { cn } from "@/src/lib/utils";
import { useExperimentStartContactContext } from "./start-experiment-contact-context";

interface StartExperimentButtonProps {
  initialContactChannels?: Partial<ExperimentStartContactChannels> | null;
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
      murphPhoneNumber: resolvedMurphPhoneNumber,
      protocolTitle,
    }),
    [protocolTitle, resolvedInitialContactChannels, resolvedMurphPhoneNumber],
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
      <DialogContent className="!bottom-3 !left-3 !right-3 !top-auto !w-auto !max-w-none !translate-x-0 !translate-y-0 gap-0 overflow-hidden rounded-2xl border-border bg-popover p-0 text-popover-foreground sm:!bottom-auto sm:!left-1/2 sm:!right-auto sm:!top-1/2 sm:!w-full sm:!max-w-[620px] sm:!-translate-x-1/2 sm:!-translate-y-1/2">
        <div className="max-h-[calc(100dvh-1.5rem)] overflow-y-auto sm:max-h-[calc(100dvh-3rem)]">
          <div className="border-b border-border bg-card px-5 py-5 sm:px-7 sm:py-6">
            <DialogHeader className="gap-4 pr-8 sm:pr-9">
              <div className="flex items-start gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-3">
                  <span className="font-mono text-[10px]/3 uppercase tracking-[0.14em] text-primary">
                    Start Experiment
                  </span>
                  <DialogTitle className="text-balance font-serif text-2xl/7 font-semibold tracking-normal text-foreground sm:text-3xl/8">
                    Choose where to start.
                  </DialogTitle>
                  <DialogDescription className="max-w-[48ch] text-pretty text-sm leading-6">
                    Murph opens the app you pick. When a draft is available,
                    review it before sending.
                  </DialogDescription>
                </div>
                <div
                  aria-hidden="true"
                  className="hidden size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted text-primary sm:flex"
                >
                  <NotebookPenIcon />
                </div>
              </div>
            </DialogHeader>

            <div className="mt-5 flex flex-col gap-2 rounded-xl border border-border bg-background/65 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
              <div className="min-w-0">
                <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-muted-foreground">
                  Protocol
                </span>
                <p className="mt-1 truncate font-serif text-lg/6 font-semibold tracking-normal text-foreground">
                  {protocolTitle}
                </p>
              </div>
              <span className="shrink-0 font-mono text-[10px]/3 uppercase tracking-[0.12em] text-primary">
                {protocolSummary}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-5 py-5 sm:px-7 sm:py-6">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-muted-foreground">
                Ways to start
              </span>
              <span className="font-mono text-[10px]/3 uppercase tracking-[0.12em] text-primary">
                {options.length} available
              </span>
            </div>
            <div className="grid gap-3">
              {options.map((option) => (
                <ContactOptionLink key={option.kind} option={option} />
              ))}
            </div>
            <p className="text-xs/5 text-muted-foreground">
              Nothing is sent until you send it.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ContactOptionLink({ option }: { option: ExperimentStartContactOption }) {
  const Icon = CONTACT_OPTION_ICONS[option.kind];
  const isExternal = option.kind === "telegram";

  return (
    <a
      href={option.href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noreferrer" : undefined}
      aria-label={`Start experiment by ${option.label}`}
      className={cn(
        buttonVariants({ variant: "outline" }),
        "group/channel h-auto min-h-[92px] w-full justify-start gap-0 overflow-hidden whitespace-normal rounded-xl border-border bg-background/70 p-0 text-left hover:border-primary/40 hover:bg-card focus-visible:ring-primary/30 sm:min-h-[104px]",
      )}
    >
      <span className="flex min-w-0 flex-1 items-stretch">
        <span className="flex w-12 shrink-0 items-center justify-center border-r border-border bg-muted text-primary sm:w-16">
          <Icon data-icon="inline-start" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-2 px-3.5 py-3.5 sm:px-5">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-serif text-lg/6 font-semibold tracking-normal text-foreground">
              {option.label}
            </span>
            <span className="rounded-md bg-muted px-2 py-1 font-mono text-[10px]/3 uppercase tracking-[0.12em] text-muted-foreground">
              {option.meta}
            </span>
          </span>
          <span className="break-words text-wrap text-sm/5 text-muted-foreground">
            {option.description}
          </span>
        </span>
        <span className="flex shrink-0 items-center px-2 text-muted-foreground transition-[color,transform] duration-150 group-hover/channel:translate-x-0.5 group-hover/channel:text-primary sm:px-4">
          <ChevronRightIcon data-icon="inline-end" />
        </span>
      </span>
    </a>
  );
}
