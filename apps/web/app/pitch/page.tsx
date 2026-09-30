import type { Metadata } from "next";

import {
  createMurphPageMetadata,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

import { PitchDeck } from "./pitch-deck";

const PITCH_OPEN_GRAPH_IMAGE = {
  alt: "Murph, your personal AI health team.",
  height: 630,
  type: "image/png",
  url: "/pitch/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph · Pitch",
  description:
    "Murph is your personal AI health team. It learns from your wearables, bloodwork, and health history, texts you first, and runs health challenges in your group chats.",
  openGraph: { images: [PITCH_OPEN_GRAPH_IMAGE] },
  twitter: { images: [PITCH_OPEN_GRAPH_IMAGE] },
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
});

export default function Page() {
  return <PitchDeck />;
}
