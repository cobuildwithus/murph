import {
  parseHostedRuntimeAssistantPersonalizationToolRequest,
} from "@murphai/hosted-execution/assistant-personalization";
import { after } from "next/server";

import {
  requireHostedCloudflareCallbackRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
} from "@/src/lib/hosted-execution/assistant-personalization-tool";
import { readRawBodyBuffer } from "@/src/lib/http";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const payloadText = (await readRawBodyBuffer(request, {
    limitBytes: BODY_LIMIT_BYTES,
  })).toString("utf8");
  const memberId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
    payloadText,
  });
  const body = parseHostedRuntimeAssistantPersonalizationToolRequest(
    payloadText.trim() ? JSON.parse(payloadText) : {},
  );

  return jsonOk(await handleHostedRuntimeAssistantPersonalizationTool({
    memberId,
    request: body,
    scheduleMailboxWake: scheduleMailboxWakeAfterResponse,
  }));
});

function scheduleMailboxWakeAfterResponse(input: {
  expectedUserId: string;
  mailboxItemId: string;
}): void {
  const task = async () => {
    try {
      await signalHostedMailboxAppendRuntime(input);
    } catch {
      // The durable mailbox item remains reconciliation truth when a wake is unavailable.
    }
  };

  try {
    after(task);
  } catch {
    void task();
  }
}
