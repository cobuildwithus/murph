import { RequestBodyTooLargeError, RequestInputError } from "@murphai/hosted-execution/request-input";

import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { requireGameMemberAuth } from "../game/http/auth";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { describeKnownLoggedErrorType, InvalidJsonBodyError } from "../http";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { withJsonError } from "../hosted-onboarding/http";
import { assertHealthFeedEnabled } from "./flag";

export async function requireHealthFeedAuth(request: Request) {
  const auth = await requireGameMemberAuth(request);
  assertHealthFeedEnabled(auth.member.id);
  return auth;
}

/** Gate before parsing even an upload. Every response, including denials, is private. */
export function withHealthRoute<Args extends unknown[]>(
  handler: (request: Request, auth: HostedNativeMemberAuth, ...args: Args) => Promise<Response>,
) {
  const route = withJsonError(async (request: Request, ...args: Args) => {
    try {
      return await runWithHostedDomainRootUnwrapCache(async () => {
        const auth = await requireHealthFeedAuth(request);
        return handler(request, auth, ...args);
      });
    } catch (error) {
      // The JSON parser's cause can quote the private request body in the route log.
      if (error instanceof InvalidJsonBodyError) throw new InvalidJsonBodyError("Request body is not valid JSON.");
      if (isHostedOnboardingError(error) || error instanceof RequestInputError || error instanceof RequestBodyTooLargeError) {
        throw error;
      }
      console.error("Health wins request failed.", { errorClass: describeKnownLoggedErrorType(error) });
      return Response.json({ error: {
        code: "HEALTH_FEED_UNAVAILABLE", retryable: true,
        message: "Health wins could not load. Try again.",
      } }, { status: 503 });
    }
  });
  return async (request: Request, ...args: Args): Promise<Response> => {
    const response = await route(request, ...args);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  };
}
