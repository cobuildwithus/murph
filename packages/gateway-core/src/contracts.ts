export const gatewayConversationDirectnessValues = ['direct', 'group', 'unknown'] as const
export const gatewayReplyRouteKindValues = ['participant', 'thread'] as const
export const gatewayDeliveryTargetKindValues = ['explicit', 'participant', 'thread'] as const

export type GatewayConversationDirectness = (typeof gatewayConversationDirectnessValues)[number]
export type GatewayReplyRouteKind = (typeof gatewayReplyRouteKindValues)[number]
export type GatewayDeliveryTargetKind = (typeof gatewayDeliveryTargetKindValues)[number]
