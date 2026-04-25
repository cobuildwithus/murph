import type { Metadata } from "next";
import type { ReactNode } from "react";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Overview — Murph",
  description: "A quick read on your recent notes, experiments, and tracked trends.",
});

export default function OverviewLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
