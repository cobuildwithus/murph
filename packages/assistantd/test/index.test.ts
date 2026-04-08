import assert from 'node:assert/strict'
import { test } from 'vitest'

import * as assistantd from '../src/index.js'
import { loadAssistantdEnvironment } from '../src/config.js'
import { startAssistantHttpServer } from '../src/http.js'
import { createAssistantLocalService } from '../src/service.js'

test('assistantd root entrypoint re-exports the package runtime seams', () => {
  assert.equal(assistantd.loadAssistantdEnvironment, loadAssistantdEnvironment)
  assert.equal(assistantd.startAssistantHttpServer, startAssistantHttpServer)
  assert.equal(assistantd.createAssistantLocalService, createAssistantLocalService)
})
