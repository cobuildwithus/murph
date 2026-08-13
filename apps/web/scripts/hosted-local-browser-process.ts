export const HOSTED_LOCAL_BROWSER_RESULT_PREFIX = "MURPH_E2E_RESULT=";

interface HostedLocalBrowserSessionCookie {
  httpOnly: true;
  name: string;
  sameSite: "Lax";
  secure: boolean;
  url: string;
  value: string;
}

export function buildHostedLocalBrowserSessionCookie(input: {
  sessionCookie: string;
  webBaseUrl: string | URL;
}): HostedLocalBrowserSessionCookie {
  const pair = input.sessionCookie.split(";", 1)[0]?.trim() ?? "";
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    throw new Error("Hosted-local browser session cookie was malformed.");
  }

  const cookieName = pair.slice(0, separatorIndex);
  const cookieUrl = new URL(input.webBaseUrl);
  if (cookieName.startsWith("__Host-")) {
    cookieUrl.protocol = "https:";
  }

  return {
    httpOnly: true,
    name: cookieName,
    sameSite: "Lax",
    secure: cookieName.startsWith("__Host-") || cookieUrl.protocol === "https:",
    url: cookieUrl.toString(),
    value: decodeURIComponent(pair.slice(separatorIndex + 1)),
  };
}

export function clearHostedLocalBrowserEnvironment(
  keys: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of keys) {
    delete environment[key];
  }
}

export function formatHostedLocalBrowserResult(result: unknown): string {
  return `${HOSTED_LOCAL_BROWSER_RESULT_PREFIX}${JSON.stringify(result)}\n`;
}

export function readHostedLocalBrowserEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  key: string,
  runnerName: string,
): string {
  const value = environment[key]?.trim();
  if (!value) {
    throw new Error(`${runnerName} requires ${key}.`);
  }
  return value;
}

export function readHostedLocalBrowserTimeout(input: {
  defaultMs: number;
  environment: NodeJS.ProcessEnv;
  key: string;
  maximumMs: number;
  minimumMs: number;
  runnerName: string;
}): number {
  const configuredValue = input.environment[input.key]?.trim();
  const timeoutMs = Number(configuredValue || input.defaultMs);
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < input.minimumMs
    || timeoutMs > input.maximumMs
  ) {
    throw new Error(
      `${input.runnerName} requires ${input.key} to be an integer from ${input.minimumMs} to ${input.maximumMs}.`,
    );
  }
  return timeoutMs;
}
