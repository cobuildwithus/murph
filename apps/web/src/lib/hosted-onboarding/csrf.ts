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

  const requestOrigin = normalizeOrigin(request.url);

  if (!environment.isProduction && requestOrigin && requestOrigin === origin && isLoopbackOrigin(origin)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_ONBOARDING_ORIGIN_NOT_CONFIGURED",
    httpStatus: 500,
    message:
      "Hosted browser mutation routes require a canonical public origin configuration outside explicit localhost development.",
  });
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
  return protocol === "http:"
    && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]");
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return isLoopbackHost(url.hostname.toLowerCase(), url.protocol.toLowerCase());
  } catch {
    return false;
  }
}
