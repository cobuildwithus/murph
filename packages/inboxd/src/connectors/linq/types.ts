export interface LinqWebhookEvent {
  api_version: 'v3'
  event_id: string
  created_at: string
  trace_id?: string | null
  partner_id?: string | null
  event_type: string
  data: unknown
}

export interface LinqMessageReceivedEvent extends LinqWebhookEvent {
  event_type: 'message.received'
  data: LinqMessageReceivedData
}

export interface LinqMessageReceivedData {
  chat_id: string
  from: string
  recipient_phone?: string | null
  received_at: string
  is_from_me: boolean
  service?: 'iMessage' | 'SMS' | 'RCS' | string | null
  message: LinqIncomingMessage
}

export interface LinqIncomingMessage {
  id: string
  parts: LinqMessagePart[]
  effect?: {
    type?: 'screen' | 'bubble' | string | null
    name?: string | null
  } | null
  reply_to?: {
    message_id?: string | null
    part_index?: number | null
  } | null
}

export interface LinqTextPart {
  type: 'text'
  value: string
}

export interface LinqMediaPart {
  type: 'media'
  url?: string | null
  attachment_id?: string | null
  filename?: string | null
  mime_type?: string | null
  size?: number | null
}

export type LinqMessagePart = LinqTextPart | LinqMediaPart

export interface LinqSendMessageResponse {
  chat_id?: string | null
  message?: {
    id?: string | null
  } | null
}

export interface LinqListPhoneNumbersResponse {
  phone_numbers?: Array<{
    phone_number?: string | null
  }> | null
}
