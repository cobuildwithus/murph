import type { IndexedAttachment, InboundCapture } from "./capture.js";

export interface InboxCaptureRecord extends InboundCapture {
  captureId: string;
  eventId: string;
  envelopePath: string;
  createdAt: string;
  attachments: IndexedAttachment[];
}

export interface InboxListFilters {
  source?: string;
  accountId?: string | null;
  limit?: number;
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
  envelopePath: string;
}
