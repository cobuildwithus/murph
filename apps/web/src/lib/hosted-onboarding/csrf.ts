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

  const publicBaseUrl = normalizeOrigin(getHostedOnboardingEnvironment().publicBaseUrl);
  const allowedOrigins = new Set<string>();

  if (publicBaseUrl) {
    allowedOrigins.add(publicBaseUrl);
  } else {
    const requestOrigin = normalizeOrigin(request.url);
    if (requestOrigin) {
      allowedOrigins.add(requestOrigin);
    }
  }

  if (allowedOrigins.has(origin)) {
    return;
  }

  throw hostedOnboardingError({
    code: "HOSTED_ONBOARDING_ORIGIN_MISMATCH",
    httpStatus: 403,
    message: "Hosted browser mutation origin is not allowed.",
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
