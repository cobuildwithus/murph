/**
 * Headless conversation/message gateway surface for transport adapters such as
 * assistantd extensions, hosted HTTP/SSE bridges, and MCP compatibility layers.
 *
 * This boundary intentionally stays transport-neutral and route-centric: it models
 * conversations, channel transcripts, live events, and approval prompts without
 * assuming CLI command routing or a specific deployment mode.
 */

export {
  gatewayAttachmentSchema,
  gatewayConversationDirectnessValues,
  gatewayConversationRouteSchema,
  gatewayConversationTitleSourceValues,
  gatewayConversationSchema,
  gatewayEventKindValues,
  gatewayEventSchema,
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListConversationsResultSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayMessageDirectionValues,
  gatewayMessageSchema,
  gatewayPermissionDecisionValues,
  gatewayPermissionRequestSchema,
  gatewayPermissionStatusValues,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayProjectionSnapshotSchema,
  gatewayReadMessagesInputSchema,
  gatewayReadMessagesResultSchema,
  gatewayReplyRouteSchema,
  gatewayRespondToPermissionInputSchema,
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayConversationDirectness,
  type GatewayConversationRoute,
  type GatewayConversationTitleSource,
  type GatewayEvent,
  type GatewayEventKind,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayListOpenPermissionsInput,
  type GatewayMessage,
  type GatewayMessageDirection,
  type GatewayPermissionDecision,
  type GatewayPermissionRequest,
  type GatewayPermissionStatus,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
  type GatewayReplyRoute,
  type GatewayRespondToPermissionInput,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
  type GatewayService,
  type GatewayWaitForEventsInput,
} from './gateway/contracts.js'

export {
  gatewayChannelSupportsReplyToMessage,
  gatewayConversationRouteCanSend,
  gatewayConversationRouteFromBinding,
  gatewayConversationRouteFromCapture,
  gatewayConversationRouteFromOutboxIntent,
  mergeGatewayConversationRoutes,
  normalizeGatewayConversationRoute,
  resolveGatewayConversationRouteKey,
  type GatewayConversationRouteInput,
  type GatewayInboundCaptureRouteInput,
} from './gateway/routes.js'

export {
  applyGatewayProjectionSnapshotToEventLog,
  DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
  DEFAULT_GATEWAY_EVENT_RETENTION,
  pollGatewayEventLogState,
  waitForGatewayEventsByPolling,
  type GatewayEventLogState,
} from './gateway/event-log.js'

export {
  diffGatewayProjectionSnapshots,
  fetchGatewayAttachmentsFromSnapshot,
  getGatewayConversationFromSnapshot,
  listGatewayConversationsFromSnapshot,
  listGatewayOpenPermissionsFromSnapshot,
  readGatewayMessagesFromSnapshot,
  type GatewayEventEmission,
} from './gateway/snapshot.js'

export {
  readGatewayConversationSessionToken,
  readGatewayMessageKind,
  readGatewayMessageRouteToken,
  sameGatewayConversationSession,
} from './gateway/opaque-ids.js'
