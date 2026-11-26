import { RequestBodyTooLargeError, RequestInputError } from "@murphai/hosted-execution/request-input";

import type { HostedNativeMemberAuth } from "../better-auth/native-auth";
import { requireGameMemberAuth } from "../game/http/auth";
import { runWithHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { describeLoggedErrorType } from "../http";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { withJsonError } from "../hosted-onboarding/http";
import { assertHealthFeedEnabled } from "./flag";

const diagnosticClasses = new Set([
  "Error", "TypeError", "RangeError", "SyntaxError", "DOMException",
  "PrismaClientKnownRequestError", "PrismaClientInitializationError", "PrismaClientUnknownRequestError",
]);

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
      const auth = await requireHealthFeedAuth(request);
      return await runWithHostedDomainRootUnwrapCache(() => handler(request, auth, ...args));
    } catch (error) {
      if (isHostedOnboardingError(error) || error instanceof RequestInputError || error instanceof RequestBodyTooLargeError) {
        throw error;
      }
      // Even a dependency's error name can contain private data.
      const type = describeLoggedErrorType(error);
      console.error("Health wins request failed.", { errorClass: diagnosticClasses.has(type) ? type : "UnknownError" });
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
