import type { Metadata } from "next";
import type { ReactNode } from "react";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Patterns — Murph",
  description: "See which repeated actions and next-day outcomes tend to move together.",
});

export default function PatternsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
