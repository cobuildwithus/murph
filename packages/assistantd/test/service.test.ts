import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { createAssistantLocalService } from '../src/service.js'

const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'
const ORIGINAL_DISABLE_CLIENT = process.env[ASSISTANTD_DISABLE_CLIENT_ENV]

afterEach(() => {
  if (ORIGINAL_DISABLE_CLIENT === undefined) {
    delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
    return
  }
  process.env[ASSISTANTD_DISABLE_CLIENT_ENV] = ORIGINAL_DISABLE_CLIENT
})

test('createAssistantLocalService disables assistant daemon client recursion in-process', async () => {
  delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]

  const vaultRoot = await mkdtemp(join(tmpdir(), 'murph-assistantd-service-test-'))
  try {
    const service = createAssistantLocalService(vaultRoot)

    assert.equal(service.vault, vaultRoot)
    assert.equal(process.env[ASSISTANTD_DISABLE_CLIENT_ENV], '1')

    delete process.env[ASSISTANTD_DISABLE_CLIENT_ENV]
    await service.listSessions({ vault: vaultRoot })
    assert.equal(process.env[ASSISTANTD_DISABLE_CLIENT_ENV], '1')
  } finally {
    await rm(vaultRoot, { force: true, recursive: true })
  }
})
