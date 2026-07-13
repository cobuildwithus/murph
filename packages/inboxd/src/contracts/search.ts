import type { IndexedAttachment, InboundCapture } from "./capture.ts";

export interface InboxCaptureRecord extends InboundCapture {
  captureId: string;
  eventId: string;
  sourceDirectory: string;
  createdAt: string;
  attachments: IndexedAttachment[];
}

export interface InboxListFilters {
  afterCaptureId?: string | null;
  afterCreatedAt?: string | null;
  afterOccurredAt?: string | null;
  source?: string;
  accountId?: string | null;
  limit?: number;
  oldestFirst?: boolean;
}

export interface InboxSearchFilters extends InboxListFilters {
  text: string;
}

export interface InboxSearchHit {
  captureId: string;
  source: string;
  accountId?: string | null;
  threadId: string;
  threadTitle?: string | null;
  occurredAt: string;
  text: string | null;
  snippet: string;
  score: number;
  sourceDirectory: string;
}
