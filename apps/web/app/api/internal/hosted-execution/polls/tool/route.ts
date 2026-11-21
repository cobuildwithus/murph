import { RequestInputError } from "@murphai/hosted-execution/request-input";
import { readHostedExecutionRuntimeAuthority } from "@murphai/hosted-execution/auth";
import { conversationPollRequestSchema } from "@murphai/hosted-execution/conversation-polls";
import { requireHostedCloudflareCallbackJsonRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { handleHostedConversationPollTool } from "@/src/lib/hosted-polls/tool";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 8_192, runtimeAuthority: "caller_transaction" });
  const parsed = conversationPollRequestSchema.safeParse(payload);
  if (!parsed.success) throw new RequestInputError("Invalid conversation poll request.");
  const authority = readHostedExecutionRuntimeAuthority(new URL(request.url), request.headers);
  const result = await handleHostedConversationPollTool({
    memberId: userId,
    runtimeIdentity: authority ? { ...authority, userId } : null,
    request: parsed.data,
  });
  return jsonOk(parsed.data.includePollDetails ? result : { status: result.status, polls: result.polls });
});
