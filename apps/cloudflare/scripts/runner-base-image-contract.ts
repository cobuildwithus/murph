export const hostedRunnerBaseImageRepository =
  "ghcr.io/cobuildwithus/murph-cloudflare-runner-base";

export const hostedRunnerBaseImageVersionTag =
  "node24.22.1-codex0.167.1-runtime1";

export const hostedRunnerBaseImageRemoteTag =
  `${hostedRunnerBaseImageRepository}:${hostedRunnerBaseImageVersionTag}`;

export const hostedLocalRunnerBaseImageTag = hostedRunnerBaseImageRemoteTag;

export const runnerBaseImageSourceFingerprintLabel =
  "murph.hosted.runner-base-source-sha256";

export function hostedRunnerBaseImageFingerprintTag(fingerprint: string): string {
  return `${hostedRunnerBaseImageRepository}:source-${fingerprint}`;
}

// The protected-main publisher and authorized local prebuilds write this cache.
// Ordinary local/PR builds import it; full source fingerprints still admit images.
export const hostedRunnerBaseImageBuildCacheTag =
  `${hostedRunnerBaseImageRepository}:buildcache-main`;
