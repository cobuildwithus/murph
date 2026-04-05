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
  if (!isRecord(entry)) {
    throw new Error(`Cloudflare image list entry ${index} must be an object.`);
  }

  return {
    name: requireString(
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
    .map((tag) => normalizeString(tag))
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
function normalizeString(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function requireString(value: string | undefined, label: string): string {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new Error(`${label} must be configured.`);
  }

  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
