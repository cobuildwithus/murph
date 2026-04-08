import assert from 'node:assert/strict'

import { afterEach, test, vi } from 'vitest'

import {
  ensureImessageMessagesDbReadable,
  mapImessageMessagesDbRuntimeError,
  IMESSAGE_MESSAGES_DB_DISPLAY_PATH,
} from '../src/imessage-readiness.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'
import { importWithMocks } from './import-with-mocks.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

test('ensureImessageMessagesDbReadable rejects non-macOS and missing HOME before probing', async () => {
  await assert.rejects(
    () =>
      ensureImessageMessagesDbReadable(
        {
          platform: 'linux',
        },
        {
          permissionCode: 'NO_PERMISSION',
          permissionMessage: 'grant access',
          unavailableCode: 'NOT_MACOS',
          unavailableMessage: 'macOS only',
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'NOT_MACOS' &&
      error.message === 'macOS only',
  )

  await assert.rejects(
    () =>
      ensureImessageMessagesDbReadable(
        {
          homeDirectory: '   ',
          platform: 'darwin',
        },
        {
          permissionCode: 'NO_PERMISSION',
          permissionMessage: 'grant access',
          unavailableCode: 'HOME_REQUIRED',
          unavailableMessage: 'missing home',
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'HOME_REQUIRED' &&
      error.message.includes(IMESSAGE_MESSAGES_DB_DISPLAY_PATH),
  )
})

test('ensureImessageMessagesDbReadable probes the computed chat.db path and maps permission failures', async () => {
  const probedPaths: string[] = []

  await ensureImessageMessagesDbReadable(
    {
      homeDirectory: '/tmp/test-home',
      platform: 'darwin',
      probeMessagesDb: async (targetPath) => {
        probedPaths.push(targetPath)
      },
    },
    {
      permissionCode: 'NO_PERMISSION',
      permissionMessage: 'grant access',
      unavailableCode: 'UNAVAILABLE',
      unavailableMessage: 'not available',
    },
  )

  assert.deepEqual(probedPaths, ['/tmp/test-home/Library/Messages/chat.db'])

  await assert.rejects(
    () =>
      ensureImessageMessagesDbReadable(
        {
          homeDirectory: '/tmp/test-home',
          platform: 'darwin',
          probeMessagesDb: async () => {
            const error = new Error('authorization denied for chat.db')
            ;(error as Error & { code?: string }).code = 'SQLITE_PERM'
            throw error
          },
        },
        {
          permissionCode: 'NO_PERMISSION',
          permissionMessage: 'grant access',
          unavailableCode: 'UNAVAILABLE',
          unavailableMessage: 'not available',
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'NO_PERMISSION' &&
      error.context?.reason === 'messages_db_unreadable' &&
      error.context?.path === IMESSAGE_MESSAGES_DB_DISPLAY_PATH &&
      error.context?.causeCode === 'SQLITE_PERM',
  )

  await assert.rejects(
    () =>
      ensureImessageMessagesDbReadable(
        {
          platform: 'darwin',
          probeMessagesDb: async () => {
            throw 'plain failure'
          },
        },
        {
          permissionCode: 'NO_PERMISSION',
          permissionMessage: 'grant access',
          unavailableCode: 'UNAVAILABLE',
          unavailableMessage: 'not available',
        },
      ),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'NO_PERMISSION' &&
      error.context?.path === IMESSAGE_MESSAGES_DB_DISPLAY_PATH &&
      error.context?.causeCode === null,
  )
})

test('mapImessageMessagesDbRuntimeError distinguishes message-db access failures from generic runtime errors', () => {
  const databaseError = new Error('unable to open database file: chat.db')
  const mappedDatabaseError = mapImessageMessagesDbRuntimeError(databaseError, {
    fallbackCode: 'GENERIC_FAILURE',
    fallbackMessage: 'something broke',
    permissionCode: 'NO_PERMISSION',
    permissionMessage: 'grant access',
  })
  assert.equal(mappedDatabaseError.code, 'NO_PERMISSION')
  assert.equal(mappedDatabaseError.context?.reason, 'messages_db_unreadable')

  const mappedGenericError = mapImessageMessagesDbRuntimeError(new Error('different failure'), {
    fallbackCode: 'GENERIC_FAILURE',
    fallbackMessage: 'something broke',
    permissionCode: 'NO_PERMISSION',
    permissionMessage: 'grant access',
  })
  assert.equal(mappedGenericError.code, 'GENERIC_FAILURE')
  assert.equal(mappedGenericError.message, 'something broke')
})

test('probeImessageMessagesDb opens the runtime sqlite database read-only and closes it', async () => {
  const close = vi.fn()
  const get = vi.fn()
  const prepare = vi.fn(() => ({ get }))
  const openSqliteRuntimeDatabase = vi.fn(() => ({
    close,
    prepare,
  }))

  const { probeImessageMessagesDb } = await importWithMocks(
    '../src/imessage-readiness.ts',
    () => {
      vi.doMock('@murphai/runtime-state/node', () => ({
        openSqliteRuntimeDatabase,
      }))
    },
  )
  await probeImessageMessagesDb('/tmp/test-home/Library/Messages/chat.db')

  assert.deepEqual(openSqliteRuntimeDatabase.mock.calls, [
    [
      '/tmp/test-home/Library/Messages/chat.db',
      {
        create: false,
        foreignKeys: false,
        readOnly: true,
      },
    ],
  ])
  assert.deepEqual(prepare.mock.calls, [['SELECT 1']])
  assert.equal(get.mock.calls.length, 1)
  assert.equal(close.mock.calls.length, 1)
})
