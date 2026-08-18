import type { Metadata } from "next";

type OpenGraphMetadata = NonNullable<Metadata["openGraph"]>;
type TwitterMetadata = NonNullable<Metadata["twitter"]>;

// Single source of truth for Murph's shared brand copy: the homepage and
// default OG headline, the metadata title, and both descriptions. Edit the
// copy here, nowhere else.
export const MURPH_TAGLINE_LINE_1 = "Health is hard.";
export const MURPH_TAGLINE_LINE_2 = "Don’t do it alone.";
export const MURPH_TAGLINE =
  `${MURPH_TAGLINE_LINE_1} ${MURPH_TAGLINE_LINE_2}`;

export const MURPH_DEFAULT_METADATA_TITLE =
  "Murph — Health is hard. Don’t do it alone.";
export const MURPH_DEFAULT_METADATA_DESCRIPTION =
  "Murph figures out what works for you—and gets your friends in on it. A personal health AI that runs experiments with you and challenges with your friends.";
export const MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION =
  "Murph figures out what works for you—and gets your friends in on it. A personal health AI that runs experiments with you and challenges with your friends.";
export const MURPH_IOS_APP_STORE_ID = "6786145859";
export const MURPH_PUBLIC_SITE_URL = "https://www.withmurph.ai";

export const MURPH_INDEXABLE_PAGE_ROBOTS = {
  follow: true,
  index: true,
} as const;

export const MURPH_NOINDEX_PAGE_ROBOTS = {
  follow: false,
  index: false,
} as const;

export const MURPH_DEFAULT_OPEN_GRAPH_IMAGE = {
  alt: MURPH_TAGLINE,
  height: 630,
  type: "image/png",
  url: "/opengraph-image",
  width: 1200,
} as const;

/**
 * Reference to a dedicated 1200x630 OG image route. Pass the result through
 * `openGraph.images` AND `twitter.images`: `createMurphPageMetadata` injects
 * the site default otherwise, and that explicit default also defeats Next's
 * file-convention inheritance, so child routes of an OG-bearing parent must
 * pass the parent's image through here or they fall back to the homepage card.
 */
export function createMurphOgImageRef(input: { alt: string; url: string }) {
  return {
    alt: input.alt,
    height: 630,
    type: "image/png",
    url: input.url,
    width: 1200,
  } as const;
}

export function withMurphOpenGraphDefaults(
  openGraph: OpenGraphMetadata,
): OpenGraphMetadata {
  return {
    siteName: "Murph",
    ...openGraph,
    images: openGraph.images ?? [MURPH_DEFAULT_OPEN_GRAPH_IMAGE],
  };
}

export function withMurphTwitterDefaults(
  twitter: TwitterMetadata,
): TwitterMetadata {
  return {
    card: "summary_large_image",
    ...twitter,
    images: twitter.images ?? [MURPH_DEFAULT_OPEN_GRAPH_IMAGE],
  };
}

export function createMurphPageMetadata(input: {
  alternates?: Metadata["alternates"];
  description: string;
  openGraph?: OpenGraphMetadata;
  robots?: Metadata["robots"];
  title: string;
  twitter?: TwitterMetadata;
}): Metadata {
  const metadata: Metadata = {
    description: input.description,
    itunes: {
      appId: MURPH_IOS_APP_STORE_ID,
    },
    openGraph: withMurphOpenGraphDefaults({
      description: input.description,
      title: input.title,
      ...input.openGraph,
    }),
    title: input.title,
    twitter: withMurphTwitterDefaults({
      description: input.description,
      title: input.title,
      ...input.twitter,
    }),
  };

  if (input.alternates) {
    metadata.alternates = input.alternates;
  }

  if (input.robots) {
    metadata.robots = input.robots;
  }

  return metadata;
}
