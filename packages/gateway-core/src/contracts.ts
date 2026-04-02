import { z } from 'zod'

import { isoTimestampSchema } from './shared.js'

export const gatewayConversationDirectnessValues = [
  'direct',
  'group',
  'unknown',
] as const

export const gatewayMessageDirectionValues = [
  'inbound',
  'outbound',
  'system',
] as const

export const gatewayReplyRouteKindValues = ['participant', 'thread'] as const
export const gatewayDeliveryTargetKindValues = [
  'explicit',
  'participant',
  'thread',
] as const

export const gatewayEventKindValues = [
  'message.created',
  'conversation.updated',
  'permission.requested',
  'permission.resolved',
] as const

export const gatewayPermissionStatusValues = [
  'open',
  'approved',
  'denied',
  'expired',
] as const

export const gatewayPermissionDecisionValues = ['approve', 'deny'] as const
export const gatewayConversationTitleSourceValues = [
  'alias',
  'thread-title',
  'participant-display-name',
  'participant-id',
  'thread-id',
  'channel',
] as const

const gatewayOptionalStringSchema = z.string().min(1).nullable().default(null)

export const gatewayReplyRouteSchema = z
  .object({
    kind: z.enum(gatewayReplyRouteKindValues).nullable().default(null),
    target: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayConversationRouteSchema = z
  .object({
    channel: gatewayOptionalStringSchema,
    identityId: gatewayOptionalStringSchema,
    participantId: gatewayOptionalStringSchema,
    threadId: gatewayOptionalStringSchema,
    directness: z.enum(gatewayConversationDirectnessValues).nullable().default(null),
    reply: gatewayReplyRouteSchema.default({
      kind: null,
      target: null,
    }),
  })
  .strict()

export const gatewayConversationSchema = z
  .object({
    schema: z.literal('murph.gateway-conversation.v1'),
    sessionKey: z.string().min(1),
    title: gatewayOptionalStringSchema,
    titleSource: z.enum(gatewayConversationTitleSourceValues).nullable().default(null),
    lastMessagePreview: gatewayOptionalStringSchema,
    lastActivityAt: isoTimestampSchema.nullable().default(null),
    messageCount: z.number().int().nonnegative().nullable().default(null),
    canSend: z.boolean().default(false),
    route: gatewayConversationRouteSchema,
  })
  .strict()

export const gatewayAttachmentSchema = z
  .object({
    schema: z.literal('murph.gateway-attachment.v1'),
    attachmentId: z.string().min(1),
    messageId: z.string().min(1),
    kind: z.enum(['image', 'audio', 'video', 'document', 'other']),
    mime: gatewayOptionalStringSchema,
    fileName: gatewayOptionalStringSchema,
    byteSize: z.number().int().nonnegative().nullable().default(null),
    parseState: gatewayOptionalStringSchema,
    extractedText: z.string().nullable().default(null),
    transcriptText: z.string().nullable().default(null),
  })
  .strict()

export const gatewayMessageSchema = z
  .object({
    schema: z.literal('murph.gateway-message.v1'),
    messageId: z.string().min(1),
    sessionKey: z.string().min(1),
    direction: z.enum(gatewayMessageDirectionValues),
    createdAt: isoTimestampSchema,
    actorDisplayName: gatewayOptionalStringSchema,
    text: z.string().nullable().default(null),
    attachments: z.array(gatewayAttachmentSchema).default([]),
  })
  .strict()

export const gatewayEventSchema = z
  .object({
    schema: z.literal('murph.gateway-event.v1'),
    cursor: z.number().int().nonnegative(),
    kind: z.enum(gatewayEventKindValues),
    createdAt: isoTimestampSchema,
    sessionKey: gatewayOptionalStringSchema,
    messageId: gatewayOptionalStringSchema,
    permissionRequestId: gatewayOptionalStringSchema,
    summary: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayPermissionRequestSchema = z
  .object({
    schema: z.literal('murph.gateway-permission-request.v1'),
    requestId: z.string().min(1),
    sessionKey: gatewayOptionalStringSchema,
    action: z.string().min(1),
    description: gatewayOptionalStringSchema,
    status: z.enum(gatewayPermissionStatusValues),
    requestedAt: isoTimestampSchema,
    resolvedAt: isoTimestampSchema.nullable().default(null),
    note: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayProjectionSnapshotSchema = z
  .object({
    schema: z.literal('murph.gateway-projection-snapshot.v1'),
    generatedAt: isoTimestampSchema,
    conversations: z.array(gatewayConversationSchema).default([]),
    messages: z.array(gatewayMessageSchema).default([]),
    permissions: z.array(gatewayPermissionRequestSchema).default([]),
  })
  .strict()

export const gatewayListConversationsInputSchema = z
  .object({
    channel: gatewayOptionalStringSchema,
    includeDerivedTitles: z.boolean().optional().default(true),
    includeLastMessage: z.boolean().optional().default(true),
    limit: z.number().int().positive().max(200).optional().default(50),
    search: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayListConversationsResultSchema = z
  .object({
    conversations: z.array(gatewayConversationSchema).default([]),
    nextCursor: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayGetConversationInputSchema = z
  .object({
    sessionKey: z.string().min(1),
  })
  .strict()

export const gatewayReadMessagesInputSchema = z
  .object({
    afterMessageId: gatewayOptionalStringSchema,
    limit: z.number().int().positive().max(500).optional().default(100),
    oldestFirst: z.boolean().optional().default(false),
    sessionKey: z.string().min(1),
  })
  .strict()

export const gatewayReadMessagesResultSchema = z
  .object({
    messages: z.array(gatewayMessageSchema).default([]),
    nextCursor: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayFetchAttachmentsInputSchema = z
  .object({
    attachmentIds: z.array(z.string().min(1)).optional().default([]),
    messageId: gatewayOptionalStringSchema,
    sessionKey: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayPollEventsInputSchema = z
  .object({
    cursor: z.number().int().nonnegative().optional().default(0),
    kinds: z.array(z.enum(gatewayEventKindValues)).optional().default([]),
    limit: z.number().int().positive().max(200).optional().default(50),
    sessionKey: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayPollEventsResultSchema = z
  .object({
    events: z.array(gatewayEventSchema).default([]),
    nextCursor: z.number().int().nonnegative(),
    live: z.boolean().default(true),
  })
  .strict()

export const gatewayWaitForEventsInputSchema = gatewayPollEventsInputSchema.extend({
  timeoutMs: z.number().int().positive().max(120_000).optional().default(30_000),
})

export const gatewaySendMessageInputSchema = z
  .object({
    clientRequestId: gatewayOptionalStringSchema,
    replyToMessageId: gatewayOptionalStringSchema,
    sessionKey: z.string().min(1),
    text: z.string().min(1),
  })
  .strict()

export const gatewaySendMessageResultSchema = z
  .object({
    sessionKey: z.string().min(1),
    messageId: gatewayOptionalStringSchema,
    queued: z.boolean().default(false),
    delivery: z
      .object({
        channel: z.string().min(1),
        idempotencyKey: gatewayOptionalStringSchema,
        target: z.string().min(1),
        targetKind: z.enum(gatewayDeliveryTargetKindValues),
        sentAt: isoTimestampSchema,
        messageLength: z.number().int().nonnegative(),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()

export const gatewayListOpenPermissionsInputSchema = z
  .object({
    sessionKey: gatewayOptionalStringSchema,
  })
  .strict()

export const gatewayRespondToPermissionInputSchema = z
  .object({
    decision: z.enum(gatewayPermissionDecisionValues),
    note: gatewayOptionalStringSchema,
    requestId: z.string().min(1),
  })
  .strict()

export interface GatewayService {
  fetchAttachments(
    input: GatewayFetchAttachmentsInput,
  ): Promise<GatewayAttachment[]>
  getConversation(
    input: GatewayGetConversationInput,
  ): Promise<GatewayConversation | null>
  listConversations(
    input?: GatewayListConversationsInput,
  ): Promise<GatewayListConversationsResult>
  listOpenPermissions(
    input?: GatewayListOpenPermissionsInput,
  ): Promise<GatewayPermissionRequest[]>
  pollEvents(input?: GatewayPollEventsInput): Promise<GatewayPollEventsResult>
  readMessages(
    input: GatewayReadMessagesInput,
  ): Promise<GatewayReadMessagesResult>
  respondToPermission(
    input: GatewayRespondToPermissionInput,
  ): Promise<GatewayPermissionRequest | null>
  sendMessage(input: GatewaySendMessageInput): Promise<GatewaySendMessageResult>
  waitForEvents(
    input?: GatewayWaitForEventsInput,
  ): Promise<GatewayPollEventsResult>
}

export type GatewayAttachment = z.infer<typeof gatewayAttachmentSchema>
export type GatewayConversation = z.infer<typeof gatewayConversationSchema>
export type GatewayConversationTitleSource =
  (typeof gatewayConversationTitleSourceValues)[number]
export type GatewayChannelDelivery = z.infer<typeof gatewaySendMessageResultSchema>['delivery']
export type GatewayConversationDirectness =
  (typeof gatewayConversationDirectnessValues)[number]
export type GatewayConversationRoute = z.infer<typeof gatewayConversationRouteSchema>
export type GatewayEvent = z.infer<typeof gatewayEventSchema>
export type GatewayEventKind = (typeof gatewayEventKindValues)[number]
export type GatewayFetchAttachmentsInput = z.infer<typeof gatewayFetchAttachmentsInputSchema>
export type GatewayGetConversationInput = z.infer<typeof gatewayGetConversationInputSchema>
export type GatewayListConversationsInput = z.infer<typeof gatewayListConversationsInputSchema>
export type GatewayListConversationsResult = z.infer<
  typeof gatewayListConversationsResultSchema
>
export type GatewayListOpenPermissionsInput = z.infer<
  typeof gatewayListOpenPermissionsInputSchema
>
export type GatewayMessage = z.infer<typeof gatewayMessageSchema>
export type GatewayMessageDirection = (typeof gatewayMessageDirectionValues)[number]
export type GatewayPermissionDecision =
  (typeof gatewayPermissionDecisionValues)[number]
export type GatewayPermissionRequest = z.infer<typeof gatewayPermissionRequestSchema>
export type GatewayProjectionSnapshot = z.infer<typeof gatewayProjectionSnapshotSchema>
export type GatewayPermissionStatus = (typeof gatewayPermissionStatusValues)[number]
export type GatewayPollEventsInput = z.infer<typeof gatewayPollEventsInputSchema>
export type GatewayPollEventsResult = z.infer<typeof gatewayPollEventsResultSchema>
export type GatewayReadMessagesInput = z.infer<typeof gatewayReadMessagesInputSchema>
export type GatewayReadMessagesResult = z.infer<typeof gatewayReadMessagesResultSchema>
export type GatewayReplyRouteKind = (typeof gatewayReplyRouteKindValues)[number]
export type GatewayReplyRoute = z.infer<typeof gatewayReplyRouteSchema>
export type GatewayRespondToPermissionInput = z.infer<
  typeof gatewayRespondToPermissionInputSchema
>
export type GatewaySendMessageInput = z.input<typeof gatewaySendMessageInputSchema>
export type GatewaySendMessageResult = z.infer<typeof gatewaySendMessageResultSchema>
export type GatewayWaitForEventsInput = z.infer<typeof gatewayWaitForEventsInputSchema>
