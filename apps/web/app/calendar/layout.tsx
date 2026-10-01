import type { Metadata } from "next";

import {
  createMurphOgImageRef,
  createMurphPageMetadata,
  MURPH_NOINDEX_PAGE_ROBOTS,
} from "@/src/lib/site-metadata";

import { CALENDAR_OG_ALT } from "./calendar-share-card";

const description =
  "Review the event details, then open the invite in your calendar.";
const image = createMurphOgImageRef({
  alt: CALENDAR_OG_ALT,
  url: "/calendar/opengraph-image",
});

export const metadata: Metadata = createMurphPageMetadata({
  description,
  openGraph: { images: [image] },
  robots: MURPH_NOINDEX_PAGE_ROBOTS,
  title: "Add to Calendar",
  twitter: { images: [image] },
});

export default function CalendarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
