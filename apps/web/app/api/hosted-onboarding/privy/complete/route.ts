import { withJsonError } from "@/src/lib/hosted-onboarding/http";
import { completeHostedPrivyRoute } from "@/src/lib/hosted-onboarding/privy-completion-route";
import { verifyHostedPrivyLegacyAuthIntent } from "@/src/lib/hosted-onboarding/privy-auth-intent";

/**
 * Temporary compatibility floor for browser bundles loaded before the strict
 * signed-intent protocol shipped. This route still requires a freshly issued,
 * signature-verified Privy identity token and the exact uniquely-newest
 * provider credential. New bundles never call it.
 */
export const POST = withJsonError(async (request: Request) => completeHostedPrivyRoute({
  request,
  resolveAuthIntent: ({ auth, body }) => verifyHostedPrivyLegacyAuthIntent({
    identityTokenIssuedAt: auth.identityTokenIssuedAt,
    method: readLegacyHostedPrivyAuthMethod(body),
  }),
  timingStep: "hosted-onboarding.route.privy-complete-legacy",
}));

function readLegacyHostedPrivyAuthMethod(body: Record<string, unknown>): unknown {
  const authIntent = body.authIntent;
  return isRecord(authIntent) ? authIntent.method : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
