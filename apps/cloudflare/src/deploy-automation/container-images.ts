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
      `Cloudflare image list output must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Cloudflare image list output must be an array.");
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Cloudflare image list entry ${index} must be an object.`);
    }

    const record = entry as Record<string, unknown>;
    const name = requireString(
      typeof record.name === "string" ? record.name : undefined,
      `Cloudflare image list entry ${index} name`,
    );
    const tags = Array.isArray(record.tags)
      ? record.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0 && !tag.startsWith("sha256"))
      : [];

    return {
      name,
      tags,
    };
  });
}

export function selectHostedContainerImageTagsForCleanup(input: {
  images: HostedContainerImageListing[];
  keepPerRepository: number;
}): HostedContainerImageTagReference[] {
  if (!Number.isInteger(input.keepPerRepository) || input.keepPerRepository < 0) {
    throw new Error("keepPerRepository must be a non-negative integer.");
  }

  return input.images.flatMap((image) => {
    const sortedTags = [...new Set(image.tags)].sort((left, right) => right.localeCompare(left));
    const tagsToDelete = sortedTags.slice(input.keepPerRepository);

    return tagsToDelete.map((tag) => ({
      image: `${image.name}:${tag}`,
      repository: image.name,
      tag,
    }));
  });
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
