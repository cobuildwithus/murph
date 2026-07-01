import {
  ensureHostedThreadContainerRoute,
} from "@/src/lib/hosted-routing/thread-container-service";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  assertHostedOnboardingMutationOrigin(request);
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_THREAD_ROUTE_CONNECT_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Hosted thread route connect request body is too large.",
  });

  const channel = readRequiredStringField(body, "channel", "HOSTED_THREAD_ROUTE_CONNECT_CHANNEL_REQUIRED", "A thread-route channel is required.");
  if (channel !== "linq") {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_CONNECT_CHANNEL_UNSUPPORTED",
      httpStatus: 400,
      message: "Only Linq group-chat thread routes can be connected here right now.",
      retryable: false,
    });
  }
  const linqChatId = readRequiredStringField(body, "linqChatId", "HOSTED_THREAD_ROUTE_CONNECT_LINQ_CHAT_ID_REQUIRED", "A Linq chat id is required.");

  const prisma = getPrisma();
  const routing = await prisma.hostedMemberRouting.findUnique({
    where: { memberId: auth.member.id },
    select: { linqRecipientPhoneLookupKey: true },
  });
  const accountLookupKey = routing?.linqRecipientPhoneLookupKey ?? null;
  if (!accountLookupKey) {
    throw hostedOnboardingError({
      code: "HOSTED_THREAD_ROUTE_CONNECT_LINQ_RECIPIENT_REQUIRED",
      httpStatus: 409,
      message: "Connect your Linq recipient line before connecting a Linq group chat.",
      retryable: false,
    });
  }

  const result = await ensureHostedThreadContainerRoute({
    accountLookupKey,
    accountLookupKeys: [accountLookupKey],
    channel: "linq",
    ownerMemberId: auth.member.id,
    threadId: linqChatId,
  });

  return jsonOk({ ok: true, ...result });
});

function readRequiredStringField(
  body: Record<string, unknown>,
  key: string,
  code: string,
  message: string,
): string {
  const value = typeof body[key] === "string" ? body[key].trim() : "";
  if (!value) {
    throw hostedOnboardingError({ code, httpStatus: 400, message, retryable: false });
  }
  return value;
}
