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

export const MURPH_DEFAULT_OPEN_GRAPH_IMAGE = {
  alt: MURPH_TAGLINE,
  height: 630,
  type: "image/png",
  url: "/opengraph-image",
  width: 1200,
} as const;

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

  return metadata;
}
