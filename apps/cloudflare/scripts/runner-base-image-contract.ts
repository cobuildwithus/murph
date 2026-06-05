export const hostedRunnerBaseImageRepository =
  "ghcr.io/cobuildwithus/murph-cloudflare-runner-base";

export const hostedLocalRunnerBaseImageTag =
  "murph-cloudflare-runner-base:node24.14.1-whisper1.8.1-codex0.135.0-base-en";

export const hostedRunnerBaseImageRemoteTag =
  `${hostedRunnerBaseImageRepository}:node24.14.1-whisper1.8.1-codex0.135.0-base-en`;

export const runnerBaseImageSourceFingerprintLabel =
  "murph.hosted.runner-base-source-sha256";

export function hostedRunnerBaseImageFingerprintTag(fingerprint: string): string {
  return `${hostedRunnerBaseImageRepository}:source-${fingerprint}`;
}
