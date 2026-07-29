import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION,
  HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION,
  HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION,
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
  parseHostedRuntimeAssistantPersonalizationToolRequest,
} from "@murphai/hosted-execution/assistant-personalization";
import { after } from "next/server";

import {
  requireHostedCloudflareCallbackJsonRequest,
} from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  handleHostedRuntimeAssistantPersonalizationTool,
} from "@/src/lib/hosted-execution/assistant-personalization-tool";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { signalHostedMailboxAppendRuntime } from "@/src/lib/hosted-orchestration/signal-runtime";

const BODY_LIMIT_BYTES = 32 * 1_024;
const RETIRED_PREFERENCE_CAUSAL_SEQ_ACTION = "resolve_preference_causal_seq";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const authority = readAssistantInputAuthority(request);
  if (isAssistantPreferenceCausalSeqRequest(payload)) {
    throw new TypeError(
      "Direct-vault assistant preference sequence resolution is retired.",
    );
  }
  const body = parseHostedRuntimeAssistantPersonalizationToolRequest(payload);
  if (assistantPersonalizationActionRequiresInputAuthority(body.action) && authority === null) {
    throw new TypeError(
      "Assistant personalization action requires assistant input authority.",
    );
  }

  return jsonOk(await handleHostedRuntimeAssistantPersonalizationTool({
    memberId,
    ...(authority ?? {}),
    request: body,
    scheduleMailboxWake: scheduleMailboxWakeAfterResponse,
  }));
});

function assistantPersonalizationActionRequiresInputAuthority(
  action: string,
): boolean {
  return action === "update"
    || action === HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION
    || action === HOSTED_RUNTIME_PREPARE_NEXT_GROUP_ACTION
    || action === HOSTED_RUNTIME_READ_PENDING_GROUP_SETUP_ACTION
    || action === HOSTED_RUNTIME_CANCEL_PENDING_GROUP_SETUP_ACTION;
}

function isAssistantPreferenceCausalSeqRequest(value: unknown): boolean {
  return typeof value === "object"
    && value !== null
    && "action" in value
    && value.action === RETIRED_PREFERENCE_CAUSAL_SEQ_ACTION;
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
