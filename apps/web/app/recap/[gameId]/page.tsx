import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { gameRecapAppUrl } from "@/src/lib/game/app-links";
import { createMurphOgImageRef, createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

import { GameRecapView } from "./game-recap-view";

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: "Watch your recap in Murph",
    description: "Who won, who owes, and the best of it.",
    openGraph: {
      type: "website",
      images: [createMurphOgImageRef({ url: "/recap-preview.png", alt: "Murph recap" })],
    },
    twitter: {
      images: [createMurphOgImageRef({ url: "/recap-preview.png", alt: "Murph recap" })],
    },
    robots: MURPH_NOINDEX_PAGE_ROBOTS,
  }),
  referrer: "no-referrer",
};

export default async function GameRecapPage(props: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await props.params;
  // Same 8–64 character ID shape accepted by game commands. No existence lookup.
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(gameId)) notFound();
  const userAgent = (await headers()).get("user-agent") ?? "";
  const isAppleMobile = /iPhone|iPad|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent));
  return (
    <main className={isAppleMobile
      ? "min-h-dvh bg-background px-6 py-7 text-foreground sm:px-10 sm:py-9"
      : "min-h-dvh bg-background text-foreground"}>
      <GameRecapView {...(isAppleMobile
        ? { appUrl: gameRecapAppUrl(gameId) }
        : { recapUrl: `https://www.withmurph.ai/recap/${gameId}` })} />
    </main>
  );
}
