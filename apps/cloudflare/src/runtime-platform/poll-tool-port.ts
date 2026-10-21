import type { ConversationPollTool } from "@murphai/hosted-execution/conversation-polls";
import { conversationPollResponseSchema } from "@murphai/hosted-execution/conversation-polls";
import { fetchHostedWebControlPlaneJson, HOSTED_RUNNER_WEB_CONTROL_ROUTES, type HostedWebControlTransport } from "./web-control-transport.ts";

export function createHostedRuntimePollToolPort(input: {
  boundUserId: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  transport: HostedWebControlTransport;
}): ConversationPollTool {
  return {
    async request(request) {
      return conversationPollResponseSchema.parse(await fetchHostedWebControlPlaneJson({
        body: request,
        boundUserId: input.boundUserId,
        description: "Hosted conversation poll",
        fetchImpl: input.fetchImpl,
        route: HOSTED_RUNNER_WEB_CONTROL_ROUTES.pollTool,
        timeoutMs: input.timeoutMs,
        transport: input.transport,
      }));
    },
  };
}
