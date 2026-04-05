import { getVercelOidcToken } from "@vercel/oidc";

import { hostedOnboardingError } from "../hosted-onboarding/errors";

export function createHostedExecutionVercelOidcBearerTokenProvider(): () => Promise<string> {
  let tokenPromise: Promise<string> | null = null;

  return async () => {
    tokenPromise ??= readHostedExecutionVercelOidcBearerToken();
    return tokenPromise;
  };
}

async function readHostedExecutionVercelOidcBearerToken(): Promise<string> {
  const token = await getVercelOidcToken();

  if (typeof token !== "string" || token.trim().length === 0) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_VERCEL_OIDC_TOKEN_REQUIRED",
      message:
        "Vercel OIDC must be enabled and available before hosted execution requests can reach Cloudflare.",
      httpStatus: 500,
    });
  }

  return token.trim();
}
