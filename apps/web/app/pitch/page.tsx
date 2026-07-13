import type { Metadata } from "next";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { PitchDeck } from "./pitch-deck";

const PITCH_OPEN_GRAPH_IMAGE = {
  alt: "Murph, the private personal health assistant that remembers.",
  height: 630,
  type: "image/png",
  url: "/pitch/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph · Pitch",
  description:
    "Murph is a private personal health assistant that helps you understand, decide, act, and follow through while remembering the context that matters over time.",
  openGraph: { images: [PITCH_OPEN_GRAPH_IMAGE] },
  twitter: { images: [PITCH_OPEN_GRAPH_IMAGE] },
});

export default function Page() {
  return <PitchDeck />;
}
