interface GatewayOpaqueEnvelope {
  kind: string
  routeKey: string
  version: 1
}

interface GatewayConversationEnvelope extends GatewayOpaqueEnvelope {
  kind: 'conversation'
}

interface GatewayCaptureMessageEnvelope extends GatewayOpaqueEnvelope {
  captureId: string
  kind: 'capture-message'
}

interface GatewayOutboxMessageEnvelope extends GatewayOpaqueEnvelope {
  intentId: string
  kind: 'outbox-message'
}

interface GatewayAttachmentEnvelope extends GatewayOpaqueEnvelope {
  attachmentId: string
  captureId: string
  kind: 'attachment'
}

const GATEWAY_CONVERSATION_PREFIX = 'gwcs_'
const GATEWAY_MESSAGE_PREFIX = 'gwcm_'
const GATEWAY_ATTACHMENT_PREFIX = 'gwca_'

export function createGatewayConversationSessionKey(routeKey: string): string {
  const envelope: GatewayConversationEnvelope = {
    kind: 'conversation',
    routeKey,
    version: 1,
  }
  return encodeGatewayOpaqueId(GATEWAY_CONVERSATION_PREFIX, envelope)
}

export function readGatewayConversationSessionKey(sessionKey: string): string {
  return readGatewayConversationEnvelope(sessionKey).routeKey
}

export function createGatewayCaptureMessageId(
  routeKey: string,
  captureId: string,
): string {
  const envelope: GatewayCaptureMessageEnvelope = {
    captureId,
    kind: 'capture-message',
    routeKey,
    version: 1,
  }
  return encodeGatewayOpaqueId(GATEWAY_MESSAGE_PREFIX, envelope)
}

export function createGatewayOutboxMessageId(
  routeKey: string,
  intentId: string,
): string {
  const envelope: GatewayOutboxMessageEnvelope = {
    intentId,
    kind: 'outbox-message',
    routeKey,
    version: 1,
  }
  return encodeGatewayOpaqueId(GATEWAY_MESSAGE_PREFIX, envelope)
}

export function readGatewayMessageRouteKey(messageId: string): string {
  return readGatewayMessageEnvelope(messageId).routeKey
}

export function readGatewayCaptureMessageId(
  messageId: string,
): GatewayCaptureMessageEnvelope {
  const envelope = readGatewayMessageEnvelope(messageId)
  if (envelope.kind !== 'capture-message') {
    throw new Error('Gateway message id does not refer to an inbox capture message.')
  }
  return envelope
}

export function readGatewayOutboxMessageId(
  messageId: string,
): GatewayOutboxMessageEnvelope {
  const envelope = readGatewayMessageEnvelope(messageId)
  if (envelope.kind !== 'outbox-message') {
    throw new Error('Gateway message id does not refer to an assistant outbox message.')
  }
  return envelope
}

export function createGatewayAttachmentId(
  routeKey: string,
  captureId: string,
  attachmentId: string,
): string {
  const envelope: GatewayAttachmentEnvelope = {
    attachmentId,
    captureId,
    kind: 'attachment',
    routeKey,
    version: 1,
  }
  return encodeGatewayOpaqueId(GATEWAY_ATTACHMENT_PREFIX, envelope)
}

export function readGatewayAttachmentId(
  attachmentId: string,
): GatewayAttachmentEnvelope {
  const envelope = decodeGatewayOpaqueId(attachmentId, GATEWAY_ATTACHMENT_PREFIX)
  if (envelope.kind !== 'attachment') {
    throw new Error('Gateway attachment id is invalid.')
  }
  if (typeof envelope.captureId !== 'string' || envelope.captureId.length === 0) {
    throw new Error('Gateway attachment id was missing the capture reference.')
  }
  if (typeof envelope.attachmentId !== 'string' || envelope.attachmentId.length === 0) {
    throw new Error('Gateway attachment id was missing the attachment reference.')
  }
  return envelope as unknown as GatewayAttachmentEnvelope
}

function readGatewayConversationEnvelope(
  sessionKey: string,
): GatewayConversationEnvelope {
  const envelope = decodeGatewayOpaqueId(sessionKey, GATEWAY_CONVERSATION_PREFIX)
  if (envelope.kind !== 'conversation') {
    throw new Error('Gateway session key is invalid.')
  }
  return envelope as unknown as GatewayConversationEnvelope
}

function readGatewayMessageEnvelope(
  messageId: string,
): GatewayCaptureMessageEnvelope | GatewayOutboxMessageEnvelope {
  const envelope = decodeGatewayOpaqueId(messageId, GATEWAY_MESSAGE_PREFIX)
  if (envelope.kind === 'capture-message') {
    if (typeof envelope.captureId !== 'string' || envelope.captureId.length === 0) {
      throw new Error('Gateway message id was missing the capture reference.')
    }
    return envelope as unknown as GatewayCaptureMessageEnvelope
  }
  if (envelope.kind === 'outbox-message') {
    if (typeof envelope.intentId !== 'string' || envelope.intentId.length === 0) {
      throw new Error('Gateway message id was missing the outbox intent reference.')
    }
    return envelope as unknown as GatewayOutboxMessageEnvelope
  }

  throw new Error('Gateway message id is invalid.')
}

function encodeGatewayOpaqueId<T extends GatewayOpaqueEnvelope>(
  prefix: string,
  envelope: T,
): string {
  return `${prefix}${Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url')}`
}

function decodeGatewayOpaqueId(
  value: string,
  prefix: string,
): Record<string, unknown> & GatewayOpaqueEnvelope {
  if (typeof value !== 'string' || !value.startsWith(prefix)) {
    throw new Error('Gateway opaque id is invalid.')
  }

  const encoded = value.slice(prefix.length)
  if (encoded.length === 0) {
    throw new Error('Gateway opaque id is invalid.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Gateway opaque id is invalid.')
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Gateway opaque id is invalid.')
  }

  const envelope = parsed as Record<string, unknown>
  if (envelope.version !== 1) {
    throw new Error('Gateway opaque id version is unsupported.')
  }
  if (typeof envelope.kind !== 'string' || envelope.kind.length === 0) {
    throw new Error('Gateway opaque id was missing the kind field.')
  }
  if (typeof envelope.routeKey !== 'string' || envelope.routeKey.length === 0) {
    throw new Error('Gateway opaque id was missing the route key.')
  }

  return envelope as Record<string, unknown> & GatewayOpaqueEnvelope
}
