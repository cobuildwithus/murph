import type { Metadata } from "next";

import {
  createMurphPageMetadata,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

import { PitchDeck } from "./pitch-deck";

const PITCH_OPEN_GRAPH_IMAGE = {
  alt: "Murph, the AI referee for health challenges.",
  height: 630,
  type: "image/png",
  url: "/pitch/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph · Pitch",
  description:
    "Murph turns group chats into health challenges. The AI referee for step bets, sleep experiments, and friend challenges across iMessage, WhatsApp, and Telegram.",
  openGraph: { images: [PITCH_OPEN_GRAPH_IMAGE] },
  twitter: { images: [PITCH_OPEN_GRAPH_IMAGE] },
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
});

export default function Page() {
  return <PitchDeck />;
}
