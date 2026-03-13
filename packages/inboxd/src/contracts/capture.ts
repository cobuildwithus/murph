export interface InboundAttachment {
  externalId?: string | null;
  kind: "image" | "audio" | "video" | "document" | "other";
  mime?: string | null;
  originalPath?: string | null;
  fileName?: string | null;
  byteSize?: number | null;
}

export interface InboundCapture {
  source: string;
  externalId: string;
  accountId?: string | null;
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
  attachments: InboundAttachment[];
  raw: Record<string, unknown>;
}

export interface StoredAttachment extends InboundAttachment {
  attachmentId: string;
  ordinal: number;
  storedPath?: string | null;
  sha256?: string | null;
}

export interface IndexedAttachment extends StoredAttachment {
  extractedText?: string | null;
  transcriptText?: string | null;
  derivedPath?: string | null;
  parserProviderId?: string | null;
  parseState?: string | null;
}

export interface StoredCapture {
  captureId: string;
  eventId: string;
  storedAt: string;
  sourceDirectory: string;
  envelopePath: string;
  attachments: StoredAttachment[];
}

export interface PersistedCapture {
  captureId: string;
  eventId: string;
  auditId?: string;
  envelopePath: string;
  createdAt: string;
  deduped: boolean;
}
