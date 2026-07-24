"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { MurphContactChannelRows } from "@/src/components/murph/murph-contact-channel-rows";
import { MurphContactLink } from "@/src/components/murph/murph-contact-link";
import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const PRIMARY_LABEL = "Reply to Murph";

export function ComputerHandoffReplyAction({
  options,
}: {
  options: MurphContactOption[];
}) {
  const [open, setOpen] = useState(false);

  if (options.length === 0) {
    return null;
  }

  if (options.length === 1) {
    const option = options[0];
    return (
      <MurphContactLink
        actionLabel={PRIMARY_LABEL}
        option={option}
        className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}
      >
        <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
        {PRIMARY_LABEL}
      </MurphContactLink>
    );
  }

  return (
    <>
      <Button
        type="button"
        size="lg"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
        aria-label={PRIMARY_LABEL}
      >
        <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
        {PRIMARY_LABEL}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6 sm:max-w-md md:p-7">
          <DialogHeader className="pr-10">
            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              {PRIMARY_LABEL}
            </DialogTitle>
            <DialogDescription>Pick how you want to reply.</DialogDescription>
          </DialogHeader>
          <MurphContactChannelRows
            actionLabel={PRIMARY_LABEL}
            onNavigate={() => setOpen(false)}
            options={options}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
