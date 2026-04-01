type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveHostedLifecycleBucketNames(source: EnvSource = process.env): string[] {
  const bucketNames = dedupe([
    normalizeString(source.CF_BUNDLES_BUCKET),
    normalizeString(source.CF_BUNDLES_PREVIEW_BUCKET),
  ]);

  if (bucketNames.length === 0) {
    throw new Error("CF_BUNDLES_BUCKET or CF_BUNDLES_PREVIEW_BUCKET must be configured.");
  }

  return bucketNames;
}

export function buildHostedLifecycleWranglerArgs(input: {
  bucketName: string;
  lifecycleConfigPath: string;
}): string[] {
  return [
    "r2",
    "bucket",
    "lifecycle",
    "set",
    input.bucketName,
    "--file",
    input.lifecycleConfigPath,
  ];
}

function normalizeString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function dedupe(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}
