import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LinkPageFrame } from "@/src/components/link-page/link-page-shell";
import { healthWinAppUrl } from "@/src/lib/game/app-links";
import { createMurphPageMetadata, MURPH_NOINDEX_PAGE_ROBOTS } from "@/src/lib/site-metadata";

import { WIN_LINK_DESCRIPTION, WIN_LINK_TITLE, WinLinkView } from "./win-link-view";

const image = { url: "/brand-logos/murph-logo-avatar-light.png", alt: "Murph", width: 512, height: 512 };

export const metadata: Metadata = {
  ...createMurphPageMetadata({
    title: WIN_LINK_TITLE,
    description: WIN_LINK_DESCRIPTION,
    openGraph: { type: "website", images: [image] },
    twitter: { card: "summary", images: [image] },
    robots: MURPH_NOINDEX_PAGE_ROBOTS,
  }),
  referrer: "no-referrer",
};

export default async function WinLinkPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/u.test(ref)) notFound();
  return (
    <LinkPageFrame>
      <WinLinkView appUrl={healthWinAppUrl(ref)} />
    </LinkPageFrame>
  );
}
