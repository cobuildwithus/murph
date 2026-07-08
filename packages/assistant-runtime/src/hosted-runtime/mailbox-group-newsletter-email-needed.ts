import { createHash } from "node:crypto";

import type {
  HostedExecutionGroupNewsletterEmailNeededWake,
} from "@murphai/hosted-execution/contracts";
import {
  recordHostedMailboxAssistantInputItem,
  upsertAssistantInputEvent,
  type AssistantInputEventRecord,
  type UpsertAssistantInputEventInput,
} from "@murphai/assistant-engine";
import {
  normalizeAssistantRouteString,
} from "@murphai/operator-config/assistant/current-delivery-route";

import type {
  HostedMailboxItemImportOutcome,
  HostedMailboxResolvedImportItem,
} from "./mailbox-import.ts";
import {
  readCurrentDirectAssistantSessionRoute,
} from "./direct-assistant-session-route.ts";
import {
  enqueueHostedPendingAssistantInputId,
} from "./pending-input-index.ts";

const GROUP_NEWSLETTER_EMAIL_NEEDED_STAGED_REASON =
  "group-newsletter.email-needed.staged";
const GROUP_NEWSLETTER_EMAIL_NEEDED_NO_ROUTE_REASON =
  "group-newsletter.email-needed.no-direct-route";
const ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,191}$/u;
const DELIVERY_CHANNELS: readonly string[] = ["linq", "telegram"];

export async function importHostedGroupNewsletterEmailNeededMailboxItem(input: {
  item: HostedMailboxResolvedImportItem;
  vaultRoot: string;
  wake: HostedExecutionGroupNewsletterEmailNeededWake;
}): Promise<HostedMailboxItemImportOutcome> {
  if (
    input.item.route.action !== "import-group-newsletter-email-needed"
    || input.item.item.kind !== "group-newsletter.email-needed"
  ) {
    return {
      reasonCode: "group-newsletter.email-needed.route_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  if (
    input.wake.kind !== "group-newsletter.email-needed"
    || input.wake.userId !== input.item.item.userId
    || input.wake.eventId !== input.item.item.dedupeKey
  ) {
    return {
      reasonCode: "group-newsletter.email-needed.decode_mismatch",
      retryable: false,
      status: "blocked",
    };
  }

  const route =
    readGroupNewsletterWakeDirectAssistantRoute(input.wake)
    ?? await readCurrentDirectAssistantSessionRoute(input.vaultRoot);
  if (!route) {
    return {
      reasonCode: GROUP_NEWSLETTER_EMAIL_NEEDED_NO_ROUTE_REASON,
      status: "skipped",
    };
  }

  const event = await upsertAssistantInputEvent({
    event: createGroupNewsletterEmailNeededAssistantInputEvent({
      item: input.item,
      route,
      wake: input.wake,
    }),
    vault: input.vaultRoot,
  });
  await recordHostedMailboxAssistantInputItem({
    inputId: event.inputId,
    mailboxItemId: input.item.item.id,
    vault: input.vaultRoot,
  });
  if (input.item.durablyConsumed !== true) {
    await enqueueHostedPendingAssistantInputId({
      inputId: event.inputId,
      vaultRoot: input.vaultRoot,
    });
  }

  return {
    ...(input.item.durablyConsumed === true ? {} : { assistantInputId: event.inputId }),
    reasonCode: GROUP_NEWSLETTER_EMAIL_NEEDED_STAGED_REASON,
    status: "imported",
  };
}

function readGroupNewsletterWakeDirectAssistantRoute(
  wake: HostedExecutionGroupNewsletterEmailNeededWake,
): Pick<AssistantInputEventRecord, "conversation" | "replyTarget"> | null {
  const channel = normalizeAssistantRouteString(wake.directRoute?.channel);
  if (!channel || !DELIVERY_CHANNELS.includes(channel)) {
    return null;
  }
  const threadId = normalizeAssistantRouteString(wake.directRoute?.threadId);
  if (!threadId) {
    return null;
  }

  return {
    conversation: {
      accountId: null,
      actorId: null,
      actorIsSelf: false,
      source: channel,
      threadId,
      threadIsDirect: true,
    },
    replyTarget: {
      channel,
      messageId: null,
      threadId,
    },
  };
}

function createGroupNewsletterEmailNeededAssistantInputEvent(input: {
  item: HostedMailboxResolvedImportItem;
  route: Pick<AssistantInputEventRecord, "conversation" | "replyTarget">;
  wake: HostedExecutionGroupNewsletterEmailNeededWake;
}): UpsertAssistantInputEventInput {
  const text = renderGroupNewsletterEmailNeededSystemNote(input.wake);
  return {
    content: {
      attachmentDescriptors: [],
      text,
      transcriptText: text,
      userMessageContent: [{ text, type: "text" }],
    },
    conversation: input.route.conversation,
    occurredAt: input.wake.occurredAt,
    receivedAt: input.item.item.createdAt,
    replyTarget: input.route.replyTarget,
    sourceMetadata: null,
    sourceRef: {
      dedupeKey: safeHostedAssistantInputTokenOrHash(input.item.item.dedupeKey),
      eventId: safeHostedAssistantInputTokenOrHash(input.wake.eventId),
      itemId: safeHostedAssistantInputTokenOrHash(input.item.item.id),
      kind: "hosted-mailbox",
      lane: input.item.item.lane,
      laneSeq: safeHostedAssistantInputTokenOrHash(input.item.item.laneSeq),
      payloadSchema: safeHostedAssistantInputTokenOrHash(input.item.payload.payloadSchema),
      payloadSource: input.item.payload.source,
      source: "hosted-mailbox",
      wakeSchema: "murph.hosted-execution-wake.v1",
    },
  };
}

function renderGroupNewsletterEmailNeededSystemNote(
  wake: HostedExecutionGroupNewsletterEmailNeededWake,
): string {
  const groupName = normalizeGroupNewsletterDisplayName(wake.groupDisplayName);
  const groupPhrase = groupName ? `The group ${groupName}` : "This group";
  return `System note: ${groupPhrase} set up an email newsletter. This member granted email sharing for that group but has no verified email. If appropriate, mention once in the normal 1:1 conversation that they can add an email at /settings?addEmail=true. Keep it casual, private, and non-shaming.`;
}

function normalizeGroupNewsletterDisplayName(value: string | null | undefined): string | null {
  const normalized = value?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, 120);
}

function safeHostedAssistantInputTokenOrHash(value: string | null | undefined): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized.length > 0
    && normalized.length <= 192
    && ASSISTANT_INPUT_EVENT_SAFE_TOKEN_PATTERN.test(normalized)
    && !isUnsafeHostedAssistantInputToken(normalized)
  ) {
    return normalized;
  }

  return `tok_${createHash("sha256").update(normalized || "empty").digest("hex").slice(0, 32)}`;
}

function isUnsafeHostedAssistantInputToken(value: string): boolean {
  return (
    value.includes("://")
    || value.includes("@")
    || value.includes("/")
    || value.toLowerCase().includes("authorization")
  );
}
