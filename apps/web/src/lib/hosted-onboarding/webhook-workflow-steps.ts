import {
  FatalError,
  RetryableError,
} from "workflow";
import {
  parseHostedExecutionWake,
} from "@murphai/hosted-execution/parsers";

import {
  decodeHostedMailboxStoredPayload,
  readHostedMailboxItemById,
  readHostedMailboxItemOwnerById,
  readHostedMailboxPayload,
} from "../hosted-mailbox/store";
import { nudgeHostedRunnerUserBestEffortResult } from "../hosted-runner/control";
import {
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
  type HostedWebhookNudgeWorkflowInput,
} from "./webhook-workflow-types";
import {
  HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
} from "./webhook-nudge-policy";
import {
  sendHostedLinqReadReceipt,
} from "./linq";
import {
  deriveHostedOnboardingTimingErrorName,
  finishHostedOnboardingTiming,
  startHostedOnboardingTiming,
} from "./logging";
import { withHostedWorkflowStepMaxRetries } from "./workflow-step-options";

const HOSTED_WEBHOOK_LINQ_READ_RECEIPT_TIMEOUT_MS = 5_000;

export async function nudgeHostedWebhookMailboxItemStep(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<void> {
  "use step";

  const mailboxItemOwner = await readHostedMailboxItemOwnerById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!mailboxItemOwner) {
    throw new FatalError("Hosted webhook mailbox item is missing.");
  }

  const result = await nudgeHostedRunnerUserBestEffortResult({
    context: resolveHostedNudgeWorkflowContext(input.source),
    timeoutMs: HOSTED_WEBHOOK_RUNNER_NUDGE_TIMEOUT_MS,
    userId: mailboxItemOwner.userId,
  });

  if (!result.accepted) {
    throw new RetryableError(
      "Hosted webhook runner nudge is temporarily unavailable.",
      {
        retryAfter: HOSTED_WEBHOOK_NUDGE_WORKFLOW_RETRY_AFTER,
      },
    );
  }
}

withHostedWorkflowStepMaxRetries(
  nudgeHostedWebhookMailboxItemStep,
  HOSTED_WEBHOOK_NUDGE_WORKFLOW_STEP_MAX_RETRIES,
);

export async function sendHostedWebhookLinqReadReceiptStep(
  input: HostedWebhookNudgeWorkflowInput,
): Promise<void> {
  "use step";

  if (input.source !== "linq") {
    return;
  }

  const timing = startHostedOnboardingTiming(
    "hosted-onboarding.workflow.linq.ingress-read-receipt",
    {
      mailboxItemIdPresent: input.mailboxItemId.trim().length > 0,
      timeoutMs: HOSTED_WEBHOOK_LINQ_READ_RECEIPT_TIMEOUT_MS,
    },
  );

  try {
    const chatId = await readHostedLinqChatIdFromMailboxItem({
      mailboxItemId: input.mailboxItemId,
    });

    if (!chatId) {
      finishHostedOnboardingTiming(timing, "skipped-missing-chat", {
        chatIdPresent: false,
      });
      return;
    }

    const result = await sendHostedLinqReadReceipt({
      chatId,
      timeoutMs: HOSTED_WEBHOOK_LINQ_READ_RECEIPT_TIMEOUT_MS,
    });

    finishHostedOnboardingTiming(timing, result.ok ? "sent" : "failed", {
      chatIdPresent: true,
      httpStatus: result.status,
    });
  } catch (error) {
    finishHostedOnboardingTiming(timing, "failed", {
      chatIdPresent: false,
      errorName: deriveHostedOnboardingTimingErrorName(error),
    });
  }
}

function resolveHostedNudgeWorkflowContext(
  source: HostedWebhookNudgeWorkflowInput["source"],
): string {
  return source === "device-sync"
    ? "device-sync.wake:workflow"
    : `webhook:${source}:workflow`;
}

async function readHostedLinqChatIdFromMailboxItem(input: {
  mailboxItemId: string;
}): Promise<string | null> {
  const item = await readHostedMailboxItemById({
    mailboxItemId: input.mailboxItemId,
  });

  if (!item || item.kind !== "conversation.message") {
    return null;
  }

  const payload = item.payloadInlineCiphertext
    ? null
    : await readHostedMailboxPayload({
      dedupeKey: item.dedupeKey,
      mailboxItemId: item.id,
      payloadRef: item.payloadRef,
      userId: item.userId,
    });
  const decoded = await decodeHostedMailboxStoredPayload({
    dedupeKey: item.dedupeKey,
    kind: item.kind,
    lane: item.lane,
    laneSeq: item.laneSeq,
    mailboxItemId: item.id,
    occurredAt: item.occurredAt,
    payloadCiphertext: payload?.payloadCiphertext ?? null,
    payloadInlineCiphertext: item.payloadInlineCiphertext ?? null,
    payloadSchema: item.payloadSchema,
    userId: item.userId,
  });

  if (!decoded) {
    return null;
  }

  const wake = parseHostedExecutionWake(decoded);
  if (wake.kind !== "conversation.message" || wake.message.channel !== "linq") {
    return null;
  }

  const chatId = wake.message.linqMessage.chatId.trim();
  return chatId.length > 0 ? chatId : null;
}
