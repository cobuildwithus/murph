import type { DatabaseSync } from 'node:sqlite'

import {
  DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
  type GatewayLocalProjectionSourceReader,
  pollGatewayEventLogState,
  waitForGatewayEventsByPolling,
  type GatewayListOpenPermissionsInput,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayProjectionSnapshot,
  type GatewayRespondToPermissionInput,
  type GatewayWaitForEventsInput,
} from '@murphai/gateway-core'
import {
  applySqliteRuntimeMigrations,
  openSqliteRuntimeDatabase,
  resolveGatewayRuntimePaths,
} from '@murphai/runtime-state/node'

import { normalizeNullableString } from './shared.js'
import {
  listOpenPermissionsFromDatabase,
  respondToPermissionInDatabase,
} from './store/permissions.js'
import {
  GATEWAY_STORE_SQLITE_SCHEMA_VERSION,
  ensureGatewayStoreBaseSchema,
  readMeta,
  readNumericMeta,
  resetGatewayServingSnapshotSchema,
  withGatewayImmediateTransaction,
  writeMeta,
} from './store/schema.js'
import {
  hasGatewayServingSnapshot,
  readGatewayTableCount,
  readSnapshotOrEmpty,
  readSnapshotState,
  rebuildSnapshotState,
  rebuildSnapshotStateFrom,
} from './store/snapshot-state.js'
import {
  clearCaptureSources,
  computeOutboxSyncSignature,
  computeSessionSyncSignature,
  loadCaptureSyncState,
  replaceCaptureSourcesForCaptureIds,
  replaceOutboxSources,
  replaceSessionSources,
  upsertCaptureSources,
} from './store/source-sync.js'

const CAPTURE_CURSOR_META_KEY = 'captures.cursor'
const CAPTURE_EMPTY_META_KEY = 'captures.empty'
const CAPTURE_INITIALIZED_META_KEY = 'captures.initialized'
const SESSION_SIGNATURE_META_KEY = 'sessions.signature'
const OUTBOX_SIGNATURE_META_KEY = 'outbox.signature'
const SQLITE_WAL_COMPANION_SUFFIXES = ['-shm', '-wal'] as const

const EMPTY_GATEWAY_LOCAL_PROJECTION_SOURCE_READER: GatewayLocalProjectionSourceReader = {
  async listOutboxSources() {
    return []
  },
  async listSessionSources() {
    return []
  },
}

export async function exportGatewayProjectionSnapshotLocal(
  vault: string,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayProjectionSnapshot> {
  const store = new LocalGatewayProjectionStore(vault, dependencies)
  try {
    return await store.syncAndReadSnapshot()
  } finally {
    store.close()
  }
}

export async function listGatewayOpenPermissionsLocal(
  vault: string,
  input?: GatewayListOpenPermissionsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPermissionRequest[]> {
  const store = new LocalGatewayProjectionStore(vault, dependencies)
  try {
    await store.sync()
    return store.listOpenPermissions(input)
  } finally {
    store.close()
  }
}

export async function respondToGatewayPermissionLocal(
  vault: string,
  input: GatewayRespondToPermissionInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPermissionRequest | null> {
  const store = new LocalGatewayProjectionStore(vault, dependencies)
  try {
    await store.sync()
    return store.respondToPermission(input)
  } finally {
    store.close()
  }
}

export async function pollGatewayEventsLocal(
  vault: string,
  input?: GatewayPollEventsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPollEventsResult> {
  const store = new LocalGatewayProjectionStore(vault, dependencies)
  try {
    await store.sync()
    return store.pollEvents(input)
  } finally {
    store.close()
  }
}

export async function waitForGatewayEventsLocal(
  vault: string,
  input?: GatewayWaitForEventsInput,
  dependencies: LocalGatewayProjectionStoreDependencies = {},
): Promise<GatewayPollEventsResult> {
  const store = new LocalGatewayProjectionStore(vault, dependencies)
  try {
    return await waitForGatewayEventsByPolling(async (pollInput) => {
      await store.sync()
      return store.pollEvents(pollInput)
    }, input, {
      intervalMs: DEFAULT_GATEWAY_EVENT_POLL_INTERVAL_MS,
    })
  } finally {
    store.close()
  }
}

export interface LocalGatewayProjectionStoreDependencies {
  sourceReader?: GatewayLocalProjectionSourceReader
}

export class LocalGatewayProjectionStore {
  private readonly database: DatabaseSync
  private readonly sourceReader: GatewayLocalProjectionSourceReader

  constructor(
    private readonly vault: string,
    dependencies: LocalGatewayProjectionStoreDependencies = {},
  ) {
    const runtimePaths = resolveGatewayRuntimePaths(vault)
    this.database = openSqliteRuntimeDatabase(runtimePaths.gatewayDbPath)
    applySqliteRuntimeMigrations(this.database, {
      migrations: [
        {
          version: 1,
          migrate(candidateDatabase) {
            ensureGatewayStoreBaseSchema(candidateDatabase)
          },
        },
        {
          version: GATEWAY_STORE_SQLITE_SCHEMA_VERSION,
          migrate(candidateDatabase) {
            ensureGatewayStoreBaseSchema(candidateDatabase)
            resetGatewayServingSnapshotSchema(candidateDatabase)
          },
        },
      ],
      schemaVersion: GATEWAY_STORE_SQLITE_SCHEMA_VERSION,
      storeName: 'gateway local projection',
    })
    this.sourceReader =
      dependencies.sourceReader ?? EMPTY_GATEWAY_LOCAL_PROJECTION_SOURCE_READER
  }

  close(): void {
    this.database.close()
  }

  async sync(): Promise<void> {
    const storedCaptureCursor = readNumericMeta(this.database, CAPTURE_CURSOR_META_KEY)
    const captureSyncInitialized = readMeta(this.database, CAPTURE_INITIALIZED_META_KEY) === '1'
    const captureSyncEmpty = readMeta(this.database, CAPTURE_EMPTY_META_KEY) === '1'
    const captureSourceCount = readGatewayTableCount(this.database, 'gateway_capture_sources')
    const captureSyncState = await loadCaptureSyncState(
      this.vault,
      !captureSyncInitialized || (captureSourceCount === 0 && !captureSyncEmpty)
        ? null
        : storedCaptureCursor,
    )
    const [sessions, outboxIntents] = await Promise.all([
      this.sourceReader.listSessionSources(this.vault),
      this.sourceReader.listOutboxSources(this.vault),
    ])
    const sessionSignature = computeSessionSyncSignature(sessions)
    const outboxSignature = computeOutboxSyncSignature(outboxIntents)

    await withGatewayImmediateTransaction(this.database, async () => {
      let changed = false

      if (captureSyncState.kind === 'rebuild') {
        clearCaptureSources(this.database)
        upsertCaptureSources(this.database, captureSyncState.captures)
        writeMeta(this.database, CAPTURE_CURSOR_META_KEY, String(captureSyncState.headCursor))
        changed = true
      } else if (captureSyncState.kind === 'incremental') {
        replaceCaptureSourcesForCaptureIds(
          this.database,
          captureSyncState.changedCaptureIds,
          captureSyncState.captures,
        )
        writeMeta(this.database, CAPTURE_CURSOR_META_KEY, String(captureSyncState.headCursor))
        changed = true
      }

      if (captureSyncState.kind !== 'noop') {
        writeMeta(this.database, CAPTURE_INITIALIZED_META_KEY, '1')
        writeMeta(
          this.database,
          CAPTURE_EMPTY_META_KEY,
          readGatewayTableCount(this.database, 'gateway_capture_sources') === 0 ? '1' : '0',
        )
      }

      if (readMeta(this.database, SESSION_SIGNATURE_META_KEY) !== sessionSignature) {
        replaceSessionSources(this.database, sessions)
        writeMeta(this.database, SESSION_SIGNATURE_META_KEY, sessionSignature)
        changed = true
      }

      if (readMeta(this.database, OUTBOX_SIGNATURE_META_KEY) !== outboxSignature) {
        replaceOutboxSources(this.database, outboxIntents)
        writeMeta(this.database, OUTBOX_SIGNATURE_META_KEY, outboxSignature)
        changed = true
      }

      if (changed || !hasGatewayServingSnapshot(this.database)) {
        rebuildSnapshotState(this.database)
      }
    })
  }

  async syncAndReadSnapshot(): Promise<GatewayProjectionSnapshot> {
    await this.sync()
    return readSnapshotOrEmpty(this.database)
  }

  listOpenPermissions(input?: GatewayListOpenPermissionsInput): GatewayPermissionRequest[] {
    return listOpenPermissionsFromDatabase(this.database, input?.sessionKey ?? null)
  }

  respondToPermission(input: GatewayRespondToPermissionInput): GatewayPermissionRequest | null {
    return respondToPermissionInDatabase(
      this.database,
      input,
      readSnapshotState,
      rebuildSnapshotStateFrom,
    )
  }

  pollEvents(input?: GatewayPollEventsInput): GatewayPollEventsResult {
    return pollGatewayEventLogState(readSnapshotState(this.database), input)
  }

  readMessageProviderReplyTarget(messageId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT provider_message_id AS providerMessageId
           FROM gateway_outbox_sources
          WHERE message_id = ?
          UNION ALL
         SELECT provider_message_id AS providerMessageId
           FROM gateway_capture_sources
          WHERE message_id = ?
          LIMIT 1`,
      )
      .get(messageId, messageId) as { providerMessageId: string | null } | undefined

    return normalizeNullableString(row?.providerMessageId)
  }
}
