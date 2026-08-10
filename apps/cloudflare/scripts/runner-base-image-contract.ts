export const hostedRunnerBaseImageRepository =
  "ghcr.io/cobuildwithus/murph-cloudflare-runner-base";

export const hostedRunnerBaseImageVersionTag =
  "node24.14.1-codex0.147.0";

export const hostedRunnerBaseImageRemoteTag =
  `${hostedRunnerBaseImageRepository}:${hostedRunnerBaseImageVersionTag}`;

export const hostedLocalRunnerBaseImageTag = hostedRunnerBaseImageRemoteTag;

export const runnerBaseImageSourceFingerprintLabel =
  "murph.hosted.runner-base-source-sha256";

export function hostedRunnerBaseImageFingerprintTag(fingerprint: string): string {
  return `${hostedRunnerBaseImageRepository}:source-${fingerprint}`;
}
