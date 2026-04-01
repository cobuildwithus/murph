import type { DatabaseSync } from 'node:sqlite'

import {
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
  `).all() as unknown as GatewayPermissionRow[]
}

export function listOpenPermissionsFromDatabase(
  database: DatabaseSync,
  sessionKey: string | null,
): GatewayPermissionRequest[] {
  return readPermissionRows(database)
    .map((row) =>
      gatewayPermissionRequestSchema.parse({
        schema: 'murph.gateway-permission-request.v1',
        requestId: row.requestId,
        sessionKey: row.sessionKey,
        action: row.action,
        description: row.description,
        status: row.status,
        requestedAt: row.requestedAt,
        resolvedAt: row.resolvedAt,
        note: row.note,
      }),
    )
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
  const existing = database
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
    .get(input.requestId) as GatewayPermissionRow | undefined

  if (!existing) {
    return null
  }

  const resolvedAt = new Date().toISOString()
  const status = input.decision === 'approve' ? 'approved' : 'denied'
  const previousState = readSnapshotState(database)
  database.prepare(`
    UPDATE gateway_permissions
       SET status = ?,
           resolved_at = ?,
           note = ?
     WHERE request_id = ?
  `).run(status, resolvedAt, normalizeNullableString(input.note), input.requestId)

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
