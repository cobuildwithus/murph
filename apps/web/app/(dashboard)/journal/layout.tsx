import type { Metadata } from "next";
import type { ReactNode } from "react";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Journal | Murph",
  description: "Review your health events, context, and connected data in one timeline.",
});

export default function JournalLayout({ children }: { children: ReactNode }) {
  return children;
}
