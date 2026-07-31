const HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN = /^[a-f0-9]{40}$/u;

export const HOSTED_EXECUTION_RUNNER_ENVIRONMENT_VOICE_PATH_PREFIX =
  "/environment-voice";

export function buildHostedExecutionRunnerEnvironmentVoicePath(
  audioKey: string,
): string {
  if (!HOSTED_ENVIRONMENT_VOICE_KEY_PATTERN.test(audioKey)) {
    throw new TypeError("Hosted environment voice key is invalid.");
  }
  return `${HOSTED_EXECUTION_RUNNER_ENVIRONMENT_VOICE_PATH_PREFIX}/${audioKey}`;
}

export function matchHostedExecutionRunnerEnvironmentVoicePath(
  pathname: string,
): string | null {
  const match =
    /^\/environment-voice\/(?<audioKey>[a-f0-9]{40})$/u.exec(pathname);
  return match?.groups?.audioKey ?? null;
}
