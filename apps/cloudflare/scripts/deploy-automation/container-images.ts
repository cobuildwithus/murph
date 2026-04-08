import {
  isObjectRecord,
  normalizeOptionalString,
  requireConfiguredString,
} from "./shared.ts";

export interface HostedContainerImageListing {
  name: string;
  tags: string[];
}

export interface HostedContainerImageTagReference {
  image: string;
  repository: string;
  tag: string;
}

export function parseHostedContainerImageListOutput(
  output: string,
): HostedContainerImageListing[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    throw new Error(
      `Cloudflare image list output must be valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Cloudflare image list output must be an array.");
  }

  return parsed.map((entry, index) => parseHostedContainerImageListEntry(entry, index));
}

export function selectHostedContainerImageTagsForCleanup(input: {
  images: HostedContainerImageListing[];
  keepPerRepository: number;
}): HostedContainerImageTagReference[] {
  if (!Number.isInteger(input.keepPerRepository) || input.keepPerRepository < 0) {
    throw new Error("keepPerRepository must be a non-negative integer.");
  }

  return input.images.flatMap((image) => {
    const tagsToDelete = listHostedContainerImageTagsForCleanup(
      image.tags,
      input.keepPerRepository,
    );

    return tagsToDelete.map((tag) => ({
      image: `${image.name}:${tag}`,
      repository: image.name,
      tag,
    }));
  });
}

function parseHostedContainerImageListEntry(
  entry: unknown,
  index: number,
): HostedContainerImageListing {
  if (!isObjectRecord(entry)) {
    throw new Error(`Cloudflare image list entry ${index} must be an object.`);
  }

  return {
    name: requireConfiguredString(
      typeof entry.name === "string" ? entry.name : undefined,
      `Cloudflare image list entry ${index} name`,
    ),
    tags: normalizeHostedContainerImageTags(entry.tags),
  };
}

function normalizeHostedContainerImageTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => normalizeOptionalString(tag))
    .filter((tag): tag is string => tag !== null && !tag.startsWith("sha256"));
}

function listHostedContainerImageTagsForCleanup(
  tags: readonly string[],
  keepPerRepository: number,
): string[] {
  const sortedTags = [...new Set(tags)].sort(sortHostedContainerImageTagsDescending);
  return sortedTags.slice(keepPerRepository);
}

function sortHostedContainerImageTagsDescending(left: string, right: string): number {
  return right.localeCompare(left);
}
