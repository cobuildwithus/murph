export const hostedRunnerBaseImageRepository =
  "ghcr.io/cobuildwithus/murph-cloudflare-runner-base";

export const hostedRunnerBaseImageVersionTag =
  "node24.22.1-codex0.163.0-live1";

export const hostedRunnerBaseImageRemoteTag =
  `${hostedRunnerBaseImageRepository}:${hostedRunnerBaseImageVersionTag}`;

export const hostedLocalRunnerBaseImageTag = hostedRunnerBaseImageRemoteTag;

export const runnerBaseImageSourceFingerprintLabel =
  "murph.hosted.runner-base-source-sha256";

export function hostedRunnerBaseImageFingerprintTag(fingerprint: string): string {
  return `${hostedRunnerBaseImageRepository}:source-${fingerprint}`;
}

// Only the protected-main image publisher writes this cache. PRs and local
// builds import it; the complete Dockerfile/patch fingerprint still admits images.
export const hostedRunnerBaseImageBuildCacheTag =
  `${hostedRunnerBaseImageRepository}:buildcache-main`;
