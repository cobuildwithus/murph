"use client";

import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { LinkPageContactPill } from "@/src/components/link-page/link-page-contact";
import {
  LINK_PAGE_NIGHT_TOKENS,
  LinkPagePill,
} from "@/src/components/link-page/link-page-shell";
import { MurphContactChannelRows } from "@/src/components/murph/murph-contact-channel-rows";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";

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
    return <LinkPageContactPill option={options[0]} />;
  }

  return (
    <>
      <LinkPagePill aria-label={PRIMARY_LABEL} onClick={() => setOpen(true)}>
        <MessageCircle className="size-5 shrink-0" aria-hidden="true" />
        {PRIMARY_LABEL}
      </LinkPagePill>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="p-6 sm:max-w-md md:p-7" style={LINK_PAGE_NIGHT_TOKENS}>
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
