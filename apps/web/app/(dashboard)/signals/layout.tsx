import type { Metadata } from "next";
import type { ReactNode } from "react";

import { createMurphPageMetadata } from "@/src/lib/site-metadata";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Signals — Murph",
  description: "Sleep, recovery, activity, and body metrics from connected health data.",
});

export default function SignalsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
