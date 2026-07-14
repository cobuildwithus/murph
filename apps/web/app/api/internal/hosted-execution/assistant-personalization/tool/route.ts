import {
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
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
  const authority = readAssistantInputAuthority(request);
  if (body.action === "update" && authority === null) {
    throw new TypeError(
      "Assistant personalization update requires assistant input authority.",
    );
  }

  return jsonOk(await handleHostedRuntimeAssistantPersonalizationTool({
    memberId,
    ...(authority ?? {}),
    request: body,
    scheduleMailboxWake: scheduleMailboxWakeAfterResponse,
  }));
});

function readAssistantInputAuthority(request: Request): {
  authority: { assistantInputId: string };
} | null {
  const value = new URL(request.url).searchParams.get("assistantInputId");
  if (value === null) {
    return null;
  }
  return {
    authority: parseHostedRuntimeAssistantPersonalizationToolAuthority({
      assistantInputId: value,
    }),
  };
}

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
