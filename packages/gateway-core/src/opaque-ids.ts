import { createHash } from 'node:crypto'

interface GatewayOpaqueEnvelope {
  kind: string
  routeToken?: string
  version: 2
}

interface GatewayConversationEnvelope extends GatewayOpaqueEnvelope {
  kind: 'conversation'
}

interface GatewayMessageEnvelope extends GatewayOpaqueEnvelope {
  kind: 'capture-message' | 'outbox-message'
  sourceToken?: string
}

interface GatewayAttachmentEnvelope extends GatewayOpaqueEnvelope {
  kind: 'attachment'
  sourceToken?: string
}

const GATEWAY_CONVERSATION_PREFIX = 'gwcs_'
const GATEWAY_MESSAGE_PREFIX = 'gwcm_'
const GATEWAY_ATTACHMENT_PREFIX = 'gwca_'

/**
 * Gateway ids behave like opaque transport identifiers and only accept the current
 * route-token envelope shape.
 */
export function createGatewayConversationSessionKey(routeKeyOrToken: string): string {
  const envelope: GatewayConversationEnvelope = {
    kind: 'conversation',
    routeToken: normalizeGatewayRouteToken(routeKeyOrToken),
    version: 2,
  }
  return encodeGatewayOpaqueId(GATEWAY_CONVERSATION_PREFIX, envelope)
}

export function readGatewayConversationSessionToken(sessionKey: string): string {
  return readGatewayConversationEnvelope(sessionKey).routeToken
}

export function assertGatewayConversationSessionKey(sessionKey: string): string {
  readGatewayConversationEnvelope(sessionKey)
  return sessionKey
}

export function sameGatewayConversationSession(
  leftSessionKey: string,
  rightSessionKey: string,
): boolean {
  try {
    return (
      readGatewayConversationSessionToken(leftSessionKey) ===
      readGatewayConversationSessionToken(rightSessionKey)
    )
  } catch {
    return false
  }
}

export function createGatewayCaptureMessageId(
  routeKeyOrToken: string,
  captureId: string,
): string {
  const envelope: GatewayMessageEnvelope = {
    kind: 'capture-message',
    routeToken: normalizeGatewayRouteToken(routeKeyOrToken),
    sourceToken: createGatewaySourceToken('capture', captureId),
    version: 2,
  }
  return encodeGatewayOpaqueId(GATEWAY_MESSAGE_PREFIX, envelope)
}

export function createGatewayOutboxMessageId(
  routeKeyOrToken: string,
  intentId: string,
): string {
  const envelope: GatewayMessageEnvelope = {
    kind: 'outbox-message',
    routeToken: normalizeGatewayRouteToken(routeKeyOrToken),
    sourceToken: createGatewaySourceToken('outbox', intentId),
    version: 2,
  }
  return encodeGatewayOpaqueId(GATEWAY_MESSAGE_PREFIX, envelope)
}

export function readGatewayMessageRouteToken(messageId: string): string {
  return readGatewayMessageEnvelope(messageId).routeToken
}

export function readGatewayMessageKind(
  messageId: string,
): GatewayMessageEnvelope['kind'] {
  return readGatewayMessageEnvelope(messageId).kind
}

export function assertGatewayMessageId(messageId: string): string {
  readGatewayMessageEnvelope(messageId)
  return messageId
}

export function createGatewayAttachmentId(
  routeKeyOrToken: string,
  captureId: string,
  attachmentId: string,
): string {
  const envelope: GatewayAttachmentEnvelope = {
    kind: 'attachment',
    routeToken: normalizeGatewayRouteToken(routeKeyOrToken),
    sourceToken: createGatewaySourceToken('attachment', `${captureId}:${attachmentId}`),
    version: 2,
  }
  return encodeGatewayOpaqueId(GATEWAY_ATTACHMENT_PREFIX, envelope)
}

export function readGatewayAttachmentId(
  attachmentId: string,
): GatewayAttachmentEnvelope & { routeToken: string } {
  const envelope = normalizeGatewayAttachmentEnvelope(
    decodeGatewayOpaqueId(attachmentId, GATEWAY_ATTACHMENT_PREFIX),
  )
  if (envelope.kind !== 'attachment') {
    throw new Error('Gateway attachment id is invalid.')
  }
  return envelope
}

export function assertGatewayAttachmentId(attachmentId: string): string {
  readGatewayAttachmentId(attachmentId)
  return attachmentId
}

function readGatewayConversationEnvelope(
  sessionKey: string,
): GatewayConversationEnvelope & { routeToken: string } {
  const envelope = normalizeGatewayOpaqueEnvelope(
    decodeGatewayOpaqueId(sessionKey, GATEWAY_CONVERSATION_PREFIX),
  )
  if (envelope.kind !== 'conversation') {
    throw new Error('Gateway session key is invalid.')
  }
  return envelope as GatewayConversationEnvelope & { routeToken: string }
}

function readGatewayMessageEnvelope(
  messageId: string,
): GatewayMessageEnvelope & { routeToken: string } {
  const envelope = normalizeGatewayOpaqueEnvelope(
    decodeGatewayOpaqueId(messageId, GATEWAY_MESSAGE_PREFIX),
  )
  if (envelope.kind !== 'capture-message' && envelope.kind !== 'outbox-message') {
    throw new Error('Gateway message id is invalid.')
  }
  return envelope as GatewayMessageEnvelope & { routeToken: string }
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

  const envelope = parsed as Record<string, unknown> & GatewayOpaqueEnvelope
  if (envelope.version !== 2) {
    throw new Error('Gateway opaque id version is unsupported.')
  }
  if (typeof envelope.kind !== 'string' || envelope.kind.length === 0) {
    throw new Error('Gateway opaque id was missing the kind field.')
  }

  return envelope
}

function normalizeGatewayOpaqueEnvelope(
  envelope: Record<string, unknown> & GatewayOpaqueEnvelope,
): GatewayOpaqueEnvelope & { routeToken: string; sourceToken?: string } {
  return {
    ...envelope,
    routeToken: readGatewayRouteTokenField(envelope),
  }
}

function normalizeGatewayAttachmentEnvelope(
  envelope: Record<string, unknown> & GatewayOpaqueEnvelope,
): GatewayAttachmentEnvelope & { routeToken: string } {
  const normalized = normalizeGatewayOpaqueEnvelope(envelope)
  if (typeof normalized.sourceToken !== 'string' || normalized.sourceToken.length === 0) {
    throw new Error('Gateway attachment id was missing the attachment reference.')
  }
  return normalized as GatewayAttachmentEnvelope & { routeToken: string }
}

function readGatewayRouteTokenField(
  envelope: Record<string, unknown> & GatewayOpaqueEnvelope,
): string {
  if (typeof envelope.routeToken === 'string' && envelope.routeToken.length > 0) {
    return envelope.routeToken
  }
  throw new Error('Gateway opaque id was missing the route token.')
}

function normalizeGatewayRouteToken(routeKeyOrToken: string): string {
  if (typeof routeKeyOrToken !== 'string' || routeKeyOrToken.length === 0) {
    throw new Error('Gateway route token input is invalid.')
  }
  return looksLikeGatewayRouteToken(routeKeyOrToken)
    ? routeKeyOrToken
    : createGatewayRouteToken(routeKeyOrToken)
}

function looksLikeGatewayRouteToken(value: string): boolean {
  return !value.includes(':') && !value.includes('|')
}

function createGatewayRouteToken(routeKey: string): string {
  return createGatewayOpaqueToken('route', routeKey)
}

function createGatewaySourceToken(
  scope: 'attachment' | 'capture' | 'outbox',
  value: string,
): string {
  return createGatewayOpaqueToken(scope, value)
}

function createGatewayOpaqueToken(scope: string, value: string): string {
  return createHash('sha256')
    .update(scope)
    .update('\u0000')
    .update(value)
    .digest('base64url')
}
