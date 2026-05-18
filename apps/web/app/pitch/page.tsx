import type { Metadata } from "next";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { PitchDeck } from "./pitch-deck";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Pitch",
  description:
    "Murph turns group chats into health challenges. The AI referee for step bets, sleep experiments, and friend challenges across iMessage, WhatsApp, and Telegram.",
});

export default function Page() {
  return <PitchDeck />;
}
