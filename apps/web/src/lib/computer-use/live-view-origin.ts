export const HOSTED_COMPUTER_LIVE_VIEW_ORIGINS_ENV_KEY =
  "HOSTED_COMPUTER_LIVE_VIEW_ORIGINS";

type EnvSource = Readonly<Record<string, string | undefined>>;

export function readConfiguredComputerLiveViewOrigins(
  env: EnvSource = process.env,
): string[] {
  const raw = env[HOSTED_COMPUTER_LIVE_VIEW_ORIGINS_ENV_KEY]?.trim();
  if (!raw) {
    return [];
  }

  const origins = new Set<string>();
  for (const segment of raw.split(/[\s,]+/u)) {
    const origin = normalizeComputerLiveViewOrigin(segment);
    if (origin) {
      origins.add(origin);
    }
  }

  return [...origins];
}

export function isAllowedComputerLiveViewUrl(input: {
  env?: EnvSource;
  url: string;
}): boolean {
  let origin: string;
  try {
    origin = new URL(input.url).origin;
  } catch {
    return false;
  }

  return readConfiguredComputerLiveViewOrigins(input.env).includes(origin);
}

function normalizeComputerLiveViewOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}
