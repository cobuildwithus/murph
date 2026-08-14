export interface AgentmailMessageAttachment {
  attachment_id: string;
  size?: number | null;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
}

export interface AgentmailMessageLike {
  inbox_id: string;
  thread_id: string;
  message_id: string;
  labels?: string[] | null;
  timestamp?: string | null;
  from?: string | null;
  to?: string[] | null;
  size?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  reply_to?: string[] | null;
  cc?: string[] | null;
  bcc?: string[] | null;
  subject?: string | null;
  preview?: string | null;
  text?: string | null;
  html?: string | null;
  extracted_text?: string | null;
  extracted_html?: string | null;
  attachments?: AgentmailMessageAttachment[] | null;
  in_reply_to?: string | null;
  references?: string[] | null;
  headers?: Record<string, string> | null;
}

export interface AgentmailThreadLike {
  inbox_id: string;
  thread_id: string;
  labels?: string[] | null;
  timestamp?: string | null;
  senders?: string[] | null;
  recipients?: string[] | null;
  last_message_id?: string | null;
  message_count?: number | null;
  size?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  messages?: AgentmailMessageLike[] | null;
  received_timestamp?: string | null;
  sent_timestamp?: string | null;
  subject?: string | null;
  preview?: string | null;
  attachments?: AgentmailMessageAttachment[] | null;
}

export interface AgentmailListMessagesResponse {
  count: number;
  messages: AgentmailMessageLike[];
  limit?: number | null;
  next_page_token?: string | null;
}

export interface AgentmailAttachmentDownload {
  attachment_id: string;
  size?: number | null;
  download_url: string;
  expires_at?: string | null;
  filename?: string | null;
  content_type?: string | null;
  content_disposition?: string | null;
  content_id?: string | null;
}
