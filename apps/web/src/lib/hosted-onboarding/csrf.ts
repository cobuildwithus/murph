import { hostedOnboardingError } from "./errors";
import { getHostedOnboardingEnvironment } from "./runtime";

export function assertHostedOnboardingMutationOrigin(request: Request): void {
  const origin = normalizeOrigin(request.headers.get("origin"));

  if (!origin) {
    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_REQUIRED",
      httpStatus: 403,
      message: "Hosted browser mutation routes require an Origin header.",
    });
  }

  const environment = getHostedOnboardingEnvironment();
  const canonicalOrigin = normalizeOrigin(environment.publicBaseUrl);

  if (isAllowedConfiguredMutationOrigin(origin, environment.allowedMutationOrigins)) {
    return;
  }

  if (canonicalOrigin) {
    if (canonicalOrigin === origin) {
      return;
    }

    throw hostedOnboardingError({
      code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
      httpStatus: 403,
      message: "Hosted browser mutation origin is not allowed.",
    });
  }

  throw hostedOnboardingError({
    code: "HOSTED_ONBOARDING_ORIGIN_NOT_CONFIGURED",
    httpStatus: 500,
    message:
      "Hosted browser mutation routes require a canonical public origin or explicit allowed mutation origin configuration.",
  });
}

function isAllowedConfiguredMutationOrigin(
  origin: string,
  configuredOrigins: readonly string[] | undefined,
): boolean {
  if (!configuredOrigins) {
    return false;
  }

  return configuredOrigins.some((configuredOrigin) => normalizeOrigin(configuredOrigin) === origin);
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();

    if (protocol !== "https:" && !isLoopbackHost(hostname, protocol)) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string, protocol: string): boolean {
  if (protocol !== "http:") {
    return false;
  }

  const normalizedHostname =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1)
      : hostname;

  if (normalizedHostname === "localhost" || normalizedHostname === "::1") {
    return true;
  }

  const ipv4Parts = normalizedHostname.split(".");
  return ipv4Parts.length === 4
    && ipv4Parts.every((part) => /^[0-9]+$/u.test(part))
    && Number(ipv4Parts[0]) === 127
    && ipv4Parts.every((part) => Number(part) >= 0 && Number(part) <= 255);
}
