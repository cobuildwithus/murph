import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { isAppleMobileUserAgent } from "@/src/lib/apple-mobile";
import { gameRecapAppUrl } from "@/src/lib/game/app-links";
import { createMurphOgImageRef, createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

import { GameRecapView } from "./game-recap-view";

const genericMetadata: Metadata = {
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

export async function generateMetadata(props: { params: Promise<{ gameId: string }>; searchParams: Promise<{ preview?: string }> }): Promise<Metadata> {
  const [{ gameId }, { preview }] = await Promise.all([props.params, props.searchParams]);
  if (!preview || !/^[A-Za-z0-9_-]{43}$/u.test(preview)) return genericMetadata;
  const { readRecapCoverPreview } = await import("@/src/lib/game/recap-preview");
  if (!await readRecapCoverPreview(gameId, preview)) return genericMetadata;
  const image = { url: `/recap/${encodeURIComponent(gameId)}/cover/${encodeURIComponent(preview)}`, alt: "Murph recap", type: "image/jpeg", width: 1200, height: 630 };
  return { ...genericMetadata, openGraph: { ...genericMetadata.openGraph, images: [image] }, twitter: { ...genericMetadata.twitter, images: [image] } };
}

export default async function GameRecapPage(props: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await props.params;
  // Same 8–64 character ID shape accepted by game commands. No existence lookup.
  if (!/^[A-Za-z0-9_-]{8,64}$/u.test(gameId)) notFound();
  if (isAppleMobileUserAgent((await headers()).get("user-agent"))) {
    return (
      <LinkPageFrame>
        <GameRecapView appUrl={gameRecapAppUrl(gameId)} />
      </LinkPageFrame>
    );
  }
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <GameRecapView recapUrl={`https://www.withmurph.ai/recap/${gameId}`} />
    </main>
  );
}
