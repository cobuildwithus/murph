import type { InboundCapture, PersistedCapture } from "../contracts/capture.js";

export type ConnectorKind = "poll" | "webhook";
export type Cursor = Record<string, unknown>;
export type EmitCapture = (capture: InboundCapture) => Promise<PersistedCapture>;

export interface BaseConnector {
  readonly id: string;
  readonly source: string;
  readonly accountId?: string | null;
  readonly kind: ConnectorKind;
  readonly capabilities: {
    backfill: boolean;
    watch: boolean;
    webhooks: boolean;
    attachments: boolean;
    ownMessages?: boolean;
  };
}

export interface PollConnector extends BaseConnector {
  kind: "poll";
  backfill(cursor: Cursor | null, emit: EmitCapture): Promise<Cursor | null>;
  watch(cursor: Cursor | null, emit: EmitCapture, signal: AbortSignal): Promise<void>;
  close?(): Promise<void>;
}

export interface WebhookConnector extends BaseConnector {
  kind: "webhook";
  handle(request: Request, emit: EmitCapture): Promise<Response>;
}
