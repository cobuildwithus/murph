import type { Metadata } from "next";
import type { ReactNode } from "react";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "History — Murph",
  description: "Recent notes, events, assessments, and daily summaries.",
});

export default function HistoryLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
