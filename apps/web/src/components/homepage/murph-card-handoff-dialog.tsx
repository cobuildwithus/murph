"use client";

import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/src/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/src/components/ui/dialog";
import { cn } from "@/src/lib/utils";

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
        className="max-h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] overflow-y-auto border border-[#c4a882]/25 bg-[#fffcf6] p-0 text-[#2d3436] ring-[#c4a882]/20 sm:max-w-md"
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
    <div data-murph-card-handoff-panel="true">
      <div className="px-6 pb-7 pt-6 sm:px-8 sm:pb-8 sm:pt-8">
        <div className="flex items-center gap-3 pr-10">
          <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#c4a882]/25 bg-[#f5f0e8]">
            <Image
              alt=""
              aria-hidden="true"
              height={28}
              src="/icons/murph-mark.svg"
              width={42}
            />
          </span>
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.17em] text-[#5a6e32]">
              Shared from Messages
            </p>
            <p className="mt-1 text-xs text-[#736a58]">
              Murph for iPhone
            </p>
          </div>
        </div>

        <h2
          className="mt-7 max-w-[12ch] text-balance font-serif text-[2rem] font-semibold leading-[1.02] tracking-[-0.035em] text-[#2d3436] sm:text-[2.35rem]"
          id={TITLE_ID}
        >
          Open this card with Murph
        </h2>
        <p
          className="mt-4 max-w-[42ch] text-pretty text-[0.95rem] leading-6 text-[#736a58]"
          id={DESCRIPTION_ID}
        >
          Murph adds interactive workout and nutrition cards to your Messages
          conversations on iPhone.
        </p>

        <ol className="mt-7 grid border-y border-[#c4a882]/25 sm:grid-cols-2">
          <li className="py-4 sm:border-r sm:border-[#c4a882]/25 sm:pr-5">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
              01 · Get Murph
            </span>
            <p className="mt-2 text-sm leading-5 text-[#2d3436]">
              Install or open Murph from the App Store.
            </p>
          </li>
          <li className="border-t border-[#c4a882]/25 py-4 sm:border-l-0 sm:border-t-0 sm:pl-5">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-[#5a6e32]">
              02 · Return
            </span>
            <p className="mt-2 text-sm leading-5 text-[#2d3436]">
              Go back to Messages and tap the shared card again.
            </p>
          </li>
        </ol>
      </div>

      <div className="flex flex-col gap-2 border-t border-[#c4a882]/25 bg-[#f5f0e8] p-4 sm:flex-row-reverse sm:items-center sm:justify-start sm:px-6">
        <a
          aria-label="Get Murph for iPhone in the App Store (opens in a new tab)"
          className={cn(
            buttonVariants({ size: "lg" }),
            "min-h-12 w-full sm:w-auto",
          )}
          href={MURPH_IOS_APP_STORE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Get Murph for iPhone
          <ArrowUpRight aria-hidden="true" />
        </a>
        <Button
          className="min-h-11 w-full border-[#c4a882]/35 bg-transparent text-[#736a58] hover:bg-[#fffcf6] hover:text-[#2d3436] sm:w-auto"
          onClick={onDismiss}
          size="lg"
          type="button"
          variant="outline"
        >
          Not now
        </Button>
      </div>
    </div>
  );
}
