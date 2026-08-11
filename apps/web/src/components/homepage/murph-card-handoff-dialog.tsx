"use client";

import { ArrowUpRight, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from "@/src/components/ui/dialog";

export const MURPH_CARD_HASH_PREFIX = "#murph-card=";
export const MURPH_IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/murph-ai/id6786145859";

const TITLE_ID = "murph-card-handoff-title";
const DESCRIPTION_ID = "murph-card-handoff-description";

export function isMurphCardHash(hash: string): boolean {
  return hash.startsWith(MURPH_CARD_HASH_PREFIX)
    && hash.length > MURPH_CARD_HASH_PREFIX.length;
}

export function MurphCardHandoffGate() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const syncWithHash = () => {
      setOpen(isMurphCardHash(window.location.hash));
    };

    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    return () => window.removeEventListener("hashchange", syncWithHash);
  }, []);

  return <MurphCardHandoffDialog onOpenChange={setOpen} open={open} />;
}

export function MurphCardHandoffDialog({
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        aria-describedby={DESCRIPTION_ID}
        aria-labelledby={TITLE_ID}
        className="max-h-[calc(100dvh-2rem)] gap-6 overflow-y-auto p-6 sm:max-w-md md:p-7"
        showCloseButton={false}
      >
        <MurphCardHandoffPanel onDismiss={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function MurphCardHandoffPanel({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <div className="contents" data-murph-card-handoff-panel="true">
      <Button
        aria-label="Close"
        className="absolute right-4 top-4"
        onClick={onDismiss}
        size="icon-sm"
        type="button"
        variant="ghost"
      >
        <XIcon aria-hidden="true" />
      </Button>
      <DialogHeader className="gap-3 pr-12">
        <h2
          className="text-balance font-serif text-3xl/9 font-semibold tracking-tight text-foreground"
          id={TITLE_ID}
        >
          Continue on iPhone
        </h2>
        <p
          className="max-w-[38ch] text-pretty text-base/7 text-muted-foreground"
          id={DESCRIPTION_ID}
        >
          Install or open Murph from the App Store. Then return to Messages and
          tap the card again.
        </p>
      </DialogHeader>

      <DialogFooter className="-mx-6 -mb-6 flex-col p-6 sm:flex-col md:-mx-7 md:-mb-7 md:p-7">
        <a
          aria-label="Open App Store (opens in a new tab)"
          autoFocus
          className={buttonVariants({ className: "w-full", size: "xl" })}
          href={MURPH_IOS_APP_STORE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Open App Store
          <ArrowUpRight aria-hidden="true" />
        </a>
        <Button
          className="w-full"
          onClick={onDismiss}
          size="xl"
          type="button"
          variant="ghost"
        >
          Cancel
        </Button>
      </DialogFooter>
    </div>
  );
}
