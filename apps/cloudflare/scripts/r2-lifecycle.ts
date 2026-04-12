import { normalizeOptionalString } from "./deploy-automation/shared.ts";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveHostedLifecycleBucketNames(source: EnvSource = process.env): string[] {
  const bucketNames = [...new Set([
    normalizeOptionalString(source.CF_BUNDLES_BUCKET),
    normalizeOptionalString(source.CF_BUNDLES_PREVIEW_BUCKET),
  ].filter((value): value is string => value !== null))];

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
