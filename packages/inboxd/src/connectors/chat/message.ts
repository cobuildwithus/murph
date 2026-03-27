import type { InboundAttachment, InboundCapture } from "../../contracts/capture.ts";

export interface ChatAttachment extends InboundAttachment {}

export interface ChatMessage {
  externalId: string;
  thread: {
    id: string;
    title?: string | null;
    isDirect?: boolean;
  };
  actor: {
    id?: string | null;
    displayName?: string | null;
    isSelf: boolean;
  };
  occurredAt: string;
  receivedAt?: string | null;
  text: string | null;
  attachments: ChatAttachment[];
  raw: Record<string, unknown>;
}

export interface CreateInboundCaptureFromChatMessageInput {
  source: string;
  accountId?: string | null;
  message: ChatMessage;
}

export function createInboundCaptureFromChatMessage({
  source,
  accountId = null,
  message,
}: CreateInboundCaptureFromChatMessageInput): InboundCapture {
  return {
    source,
    externalId: message.externalId,
    accountId,
    thread: {
      id: message.thread.id,
      title: message.thread.title ?? null,
      isDirect: message.thread.isDirect,
    },
    actor: {
      id: message.actor.id ?? null,
      displayName: message.actor.displayName ?? null,
      isSelf: message.actor.isSelf,
    },
    occurredAt: message.occurredAt,
    receivedAt: message.receivedAt ?? null,
    text: message.text,
    attachments: message.attachments,
    raw: message.raw,
  };
}

export function compareInboundCaptures(left: InboundCapture, right: InboundCapture): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  return left.externalId.localeCompare(right.externalId);
}
