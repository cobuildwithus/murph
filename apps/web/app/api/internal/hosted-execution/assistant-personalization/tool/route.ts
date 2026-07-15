import {
  HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION,
  parseHostedRuntimeAssistantPreferenceCausalSeqRequest,
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
  parseHostedRuntimeAssistantPersonalizationToolRequest,
} from "@murphai/hosted-execution/assistant-personalization";
import { after } from "next/server";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
  resolveHostedRuntimeAssistantPreferenceCausalSeq,
} from "@/src/lib/hosted-execution/assistant-personalization-tool";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";

const BODY_LIMIT_BYTES = 2_048;

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const authority = readAssistantInputAuthority(request);
  if (isAssistantPreferenceCausalSeqRequest(payload)) {
    parseHostedRuntimeAssistantPreferenceCausalSeqRequest(payload);
    if (authority === null) {
      throw new TypeError(
        "Assistant preference causal sequence requires assistant input authority.",
      );
    }
    return jsonOk(await resolveHostedRuntimeAssistantPreferenceCausalSeq({
      ...authority,
      memberId,
    }));
  }

  const body = parseHostedRuntimeAssistantPersonalizationToolRequest(payload);
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

function isAssistantPreferenceCausalSeqRequest(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "action" in value
    && value.action === HOSTED_RUNTIME_ASSISTANT_PREFERENCE_CAUSAL_SEQ_ACTION;
}

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
