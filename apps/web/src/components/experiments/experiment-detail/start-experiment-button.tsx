"use client";

import { useMemo, useState } from "react";
import { ArrowRightIcon, MailIcon, MessageSquareTextIcon, SendIcon } from "lucide-react";
import { useUser } from "@privy-io/react-auth";

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
  const { user } = useUser();
  const contactDefaults = useExperimentStartContactContext();
  const resolvedInitialContactChannels =
    initialContactChannels ?? contactDefaults.initialContactChannels;
  const resolvedMurphPhoneNumber = murphPhoneNumber ?? contactDefaults.murphPhoneNumber;
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const startContactAction = useMemo(
    () => resolveExperimentStartContactAction({
      accountContainer: user,
      initialContactChannels: resolvedInitialContactChannels,
      murphPhoneNumber: resolvedMurphPhoneNumber,
      protocolTitle,
    }),
    [protocolTitle, resolvedInitialContactChannels, resolvedMurphPhoneNumber, user],
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

  return (
    <>
      <div className="flex flex-col items-stretch gap-2 md:shrink-0 md:items-center">
        <AuthButton
          size="lg"
          className="rounded-[10px] bg-primary py-4 text-base font-semibold text-background hover:bg-primary/90 md:px-12"
          onClick={handleAuthenticatedStartClick}
          connectLabel="Sign in to start"
        >
          <span>Start Experiment</span>
          <ArrowRightIcon data-icon="inline-end" />
        </AuthButton>
        <span className="text-center text-[11px]/3.5 text-muted-foreground/70">
          {protocolDays}-day protocol
        </span>
      </div>

      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] gap-5 border-border bg-card p-6 sm:max-w-lg md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-semibold tracking-tight text-foreground">
              Start from your connected channel
            </DialogTitle>
            <DialogDescription>
              Pick where Murph should receive the first note for this experiment.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3">
            {dialogOptions.map((option) => (
              <ContactOptionLink key={option.kind} option={option} />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
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
      className={cn(
        buttonVariants({ variant: "outline" }),
        "h-auto w-full justify-start gap-3 whitespace-normal rounded-lg border-border bg-background/70 px-4 py-3 text-left hover:bg-muted",
      )}
    >
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-foreground">{option.label}</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {option.meta}
          </span>
        </span>
        <span className="text-wrap text-xs leading-5 text-muted-foreground">
          {option.description}
        </span>
      </span>
    </a>
  );
}
