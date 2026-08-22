import type { Metadata } from "next";

import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

import { CONNECT_OG_ALT } from "./connect-share-card";

const CONNECT_OG_IMAGE = createMurphOgImageRef({
  alt: CONNECT_OG_ALT,
  url: "/connect/opengraph-image",
});

// Kept import-light (no page module) so tests can prove the share-preview
// metadata without mocking the connect page's server dependencies.
export const metadata: Metadata = createMurphPageMetadata({
  title: "Connect Devices — Murph",
  description: "Connect your wearables and health data sources.",
  openGraph: { images: [CONNECT_OG_IMAGE] },
  twitter: { images: [CONNECT_OG_IMAGE] },
});
