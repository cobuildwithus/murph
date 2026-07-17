"use client";

import Link from "next/link";

import { Button } from "@/src/components/ui/button";

export default function MurphSafeError(input: { reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
      <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground">
        MURPH SAFE
      </p>
      <h1 className="mt-4 max-w-2xl font-serif text-4xl font-semibold tracking-[-0.035em] text-foreground sm:text-5xl">
        Murph Safe could not be loaded.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
        Murph Safe is unavailable right now. Try again, or return to product
        search.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button type="button" size="lg" onClick={input.reset}>
          Try again
        </Button>
        <Link
          href="/search"
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-md px-3 text-sm text-foreground underline decoration-border underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Return to search
        </Link>
      </div>
    </main>
  );
}
