import type { Metadata } from "next";

type OpenGraphMetadata = NonNullable<Metadata["openGraph"]>;
type TwitterMetadata = NonNullable<Metadata["twitter"]>;

// Single source of truth for Murph's shared brand copy: the tagline (drawn on
// the default OG image), the metadata title, and both descriptions. Edit the
// copy here, nowhere else.
export const MURPH_TAGLINE_LINE_1 = "Everyone’s got a health goal.";
export const MURPH_TAGLINE_LINE_2 = "Almost nobody hits it alone.";

export const MURPH_DEFAULT_METADATA_TITLE =
  "Murph — Get healthier with your group chat";
export const MURPH_DEFAULT_METADATA_DESCRIPTION =
  "Get stronger, fix your sleep, lower your cholesterol. Murph reads your data, figures out what actually works, and gets your friends in on it so you don’t quit.";
// Longer variant for social unfurls, where the text is shown whole or not at
// all; the default description stays under Google's ~160-char truncation.
export const MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION =
  "Get stronger, fix your sleep, lower your cholesterol. Murph lives in your group chat, reads everything you throw at it, figures out what actually works, and gets your friends in on it so you don’t quit.";

export const MURPH_DEFAULT_OPEN_GRAPH_IMAGE = {
  alt: `Murph — ${MURPH_TAGLINE_LINE_1} ${MURPH_TAGLINE_LINE_2}`,
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
