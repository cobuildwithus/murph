import type { DatabaseSync } from 'node:sqlite'

import {
  gatewayPermissionStatusValues,
  gatewayPermissionRequestSchema,
  type GatewayPermissionRequest,
  type GatewayRespondToPermissionInput,
} from '@murphai/gateway-core'
import { sameGatewayConversationSession } from '@murphai/gateway-core'
import { normalizeNullableString } from '../shared.js'
import type { GatewaySnapshotState } from './snapshot-state.js'

export interface GatewayPermissionRow {
  action: string
  description: string | null
  note: string | null
  requestId: string
  requestedAt: string
  resolvedAt: string | null
  sessionKey: string | null
  status: GatewayPermissionRequest['status']
}

type SqliteRow = Record<string, unknown>

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected ${field} to be a string.`)
  }
  return value
}

function expectNullableString(value: unknown, field: string): string | null {
  if (value === null) {
    return null
  }
  return expectString(value, field)
}

function expectEnumString<TValue extends string>(
  value: unknown,
  field: string,
  allowedValues: readonly TValue[],
): TValue {
  const parsed = expectString(value, field)
  if (!allowedValues.includes(parsed as TValue)) {
    throw new TypeError(`Expected ${field} to be one of: ${allowedValues.join(', ')}.`)
  }
  return parsed as TValue
}

function decodePermissionRow(row: SqliteRow): GatewayPermissionRow {
  return {
    requestId: expectString(row.requestId, 'gateway_permissions.requestId'),
    sessionKey: expectNullableString(row.sessionKey, 'gateway_permissions.sessionKey'),
    action: expectString(row.action, 'gateway_permissions.action'),
    description: expectNullableString(row.description, 'gateway_permissions.description'),
    status: expectEnumString(
      row.status,
      'gateway_permissions.status',
      gatewayPermissionStatusValues,
    ),
    requestedAt: expectString(row.requestedAt, 'gateway_permissions.requestedAt'),
    resolvedAt: expectNullableString(row.resolvedAt, 'gateway_permissions.resolvedAt'),
    note: expectNullableString(row.note, 'gateway_permissions.note'),
  }
}

function permissionRequestFromRow(
  row: GatewayPermissionRow,
): GatewayPermissionRequest {
  return gatewayPermissionRequestSchema.parse({
    schema: 'murph.gateway-permission-request.v1',
    requestId: row.requestId,
    sessionKey: row.sessionKey,
    action: row.action,
    description: row.description,
    status: row.status,
    requestedAt: row.requestedAt,
    resolvedAt: row.resolvedAt,
    note: row.note,
  })
}

function readPermissionRowByRequestId(
  database: DatabaseSync,
  requestId: string,
): GatewayPermissionRow | null {
  const row = database
    .prepare(`
      SELECT
        request_id AS requestId,
        session_key AS sessionKey,
        action,
        description,
        status,
        requested_at AS requestedAt,
        resolved_at AS resolvedAt,
        note
      FROM gateway_permissions
      WHERE request_id = ?
    `)
    .get(requestId)

  return row ? decodePermissionRow(row) : null
}

export function readPermissionRows(database: DatabaseSync): GatewayPermissionRow[] {
  return database.prepare(`
    SELECT
      request_id AS requestId,
      session_key AS sessionKey,
      action,
      description,
      status,
      requested_at AS requestedAt,
      resolved_at AS resolvedAt,
      note
    FROM gateway_permissions
    ORDER BY requested_at ASC, request_id ASC
  `).all().map((row) => decodePermissionRow(row))
}

export function listOpenPermissionsFromDatabase(
  database: DatabaseSync,
  sessionKey: string | null,
): GatewayPermissionRequest[] {
  return readPermissionRows(database)
    .map((row) => permissionRequestFromRow(row))
    .filter((permission) => permission.status === 'open')
    .filter(
      (permission) =>
        !sessionKey ||
        (permission.sessionKey !== null &&
          sameGatewayConversationSession(permission.sessionKey, sessionKey)),
    )
}

export function respondToPermissionInDatabase(
  database: DatabaseSync,
  input: GatewayRespondToPermissionInput,
  readSnapshotState: (database: DatabaseSync) => GatewaySnapshotState,
  rebuildSnapshotStateFrom: (
    database: DatabaseSync,
    previousState: GatewaySnapshotState,
  ) => void,
): GatewayPermissionRequest | null {
  const existing = readPermissionRowByRequestId(database, input.requestId)
  if (!existing) {
    return null
  }

  if (existing.status !== 'open') {
    return permissionRequestFromRow(existing)
  }

  const resolvedAt = new Date().toISOString()
  const status = input.decision === 'approve' ? 'approved' : 'denied'
  const previousState = readSnapshotState(database)
  const updateResult = database.prepare(`
    UPDATE gateway_permissions
       SET status = ?,
           resolved_at = ?,
           note = ?
     WHERE request_id = ?
       AND status = 'open'
  `).run(status, resolvedAt, normalizeNullableString(input.note), input.requestId)
  if (updateResult.changes === 0) {
    const current = readPermissionRowByRequestId(database, input.requestId)
    return current ? permissionRequestFromRow(current) : null
  }

  rebuildSnapshotStateFrom(database, previousState)

  return gatewayPermissionRequestSchema.parse({
    schema: 'murph.gateway-permission-request.v1',
    requestId: existing.requestId,
    sessionKey: existing.sessionKey,
    action: existing.action,
    description: existing.description,
    status,
    requestedAt: existing.requestedAt,
    resolvedAt,
    note: normalizeNullableString(input.note),
  })
}
