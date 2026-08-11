import {
  HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION,
  parseHostedRuntimeAssistantPersonalizationToolAuthority,
  parseHostedRuntimeAssistantPersonalizationToolRequest,
  type HostedRuntimeAssistantPersonalizationToolAuthority,
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

const BODY_LIMIT_BYTES = 2_048;
const RETIRED_PREFERENCE_CAUSAL_SEQ_ACTION = "resolve_preference_causal_seq";

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId: memberId } = await requireHostedCloudflareCallbackJsonRequest(request, {
    maxBodyBytes: BODY_LIMIT_BYTES,
  });
  const authority = readAssistantUpdateAuthority(request);
  if (isAssistantPreferenceCausalSeqRequest(payload)) {
    throw new TypeError(
      "Direct-vault assistant preference sequence resolution is retired.",
    );
  }
  const body = parseHostedRuntimeAssistantPersonalizationToolRequest(payload);
  if (
    (
      body.action === "update"
      || body.action === HOSTED_RUNTIME_ASSISTANT_PERSONALITY_UPDATE_ACTION
    )
    && authority === null
  ) {
    throw new TypeError(
      "Assistant personalization update requires accepted-input or scheduled-occurrence authority.",
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
    && value.action === RETIRED_PREFERENCE_CAUSAL_SEQ_ACTION;
}

function readAssistantUpdateAuthority(request: Request):
  | { authority: HostedRuntimeAssistantPersonalizationToolAuthority }
  | null {
  const search = new URL(request.url).searchParams;
  const assistantInputId = search.get("assistantInputId");
  const automationId = search.get("automationId");
  const occurrenceAt = search.get("occurrenceAt");
  const toolCallId = search.get("toolCallId");
  if (
    assistantInputId === null
    && automationId === null
    && occurrenceAt === null
    && toolCallId === null
  ) {
    return null;
  }
  if (
    assistantInputId !== null
    && automationId === null
    && occurrenceAt === null
  ) {
    return {
      authority: parseHostedRuntimeAssistantPersonalizationToolAuthority({
        assistantInputId,
        ...(toolCallId ? { toolCallId } : {}),
      }),
    };
  }
  if (
    assistantInputId === null
    && automationId !== null
    && occurrenceAt !== null
  ) {
    return {
      authority: parseHostedRuntimeAssistantPersonalizationToolAuthority({
        automationId,
        occurrenceAt,
        ...(toolCallId ? { toolCallId } : {}),
      }),
    };
  }
  throw new TypeError(
    "Hosted assistant personalization action authority is invalid.",
  );
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
