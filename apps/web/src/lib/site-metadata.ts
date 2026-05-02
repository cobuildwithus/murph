import type { Metadata } from "next";

type OpenGraphMetadata = NonNullable<Metadata["openGraph"]>;
type TwitterMetadata = NonNullable<Metadata["twitter"]>;

export const MURPH_DEFAULT_METADATA_TITLE =
  "Murph — Discover what actually makes you healthier";
export const MURPH_DEFAULT_METADATA_DESCRIPTION =
  "Your personal health assistant. Sync your signals, pick a protocol, see what actually makes you healthier.";

export const MURPH_DEFAULT_OPEN_GRAPH_IMAGE = {
  alt: "Murph — Wearable data, made useful.",
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
