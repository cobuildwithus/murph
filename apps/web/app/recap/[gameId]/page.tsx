import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { gameRecapAppUrl } from "@/src/lib/game/app-links";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

import { GameRecapView } from "./game-recap-view";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Your recap is in Murph",
    description: "Open Murph to watch your recap.",
    openGraph: { type: "website" },
    robots: MURPH_NOINDEX_PAGE_ROBOTS,
  }),
  referrer: "no-referrer",
};

export default async function GameRecapPage(props: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await props.params;
  // Same 8–64 character ID shape accepted by game commands. No existence lookup.
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(gameId)) notFound();
  return (
    <main className="min-h-dvh bg-background px-6 py-7 text-foreground sm:px-10 sm:py-9">
      <GameRecapView appUrl={gameRecapAppUrl(gameId)} />
    </main>
  );
}
