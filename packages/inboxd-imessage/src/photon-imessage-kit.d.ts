declare module "@photon-ai/imessage-kit" {
  export interface Attachment {
    id?: string | null;
    filename?: string | null;
    path?: string | null;
    mimeType?: string | null;
    size?: number | null;
  }

  export interface Message {
    guid?: string | null;
    id?: string | null;
    text?: string | null;
    date?: Date | string | number | null;
    chatId?: string | null;
    sender?: string | null;
    senderName?: string | null;
    isFromMe?: boolean | null;
    attachments: Attachment[];
  }

  export interface ChatSummary {
    chatId?: string | null;
    displayName?: string | null;
    isGroup?: boolean | null;
  }

  export class IMessageSDK {
    getMessages(input?: {
      limit?: number;
      excludeOwnMessages?: boolean;
    }): Promise<{
      messages: Message[];
      total?: number;
      unreadCount?: number;
    }>;
    listChats(): Promise<ChatSummary[]>;
    startWatching(input: {
      onMessage?(message: Message): Promise<void> | void;
      onError?(error: Error): void;
    }): Promise<void>;
    stopWatching(): void;
    close(): Promise<void>;
  }
}
