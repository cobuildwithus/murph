import type { Metadata } from "next";

import {
  createMurphOgImageRef,
  createMurphPageMetadata,
} from "@/src/lib/site-metadata";

import { SETTINGS_OG_ALT } from "./settings-share-card";

const SETTINGS_OG_IMAGE = createMurphOgImageRef({
  alt: SETTINGS_OG_ALT,
  url: "/settings/opengraph-image",
});

// Kept import-light (no page module) so tests can prove the share-preview
// metadata without mocking the settings page's server dependencies.
export const metadata: Metadata = createMurphPageMetadata({
  title: "Settings — Murph",
  description: "Manage your Murph account settings.",
  openGraph: { images: [SETTINGS_OG_IMAGE] },
  twitter: { images: [SETTINGS_OG_IMAGE] },
});
