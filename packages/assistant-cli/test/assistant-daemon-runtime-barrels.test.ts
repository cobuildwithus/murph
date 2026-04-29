import assert from 'node:assert/strict'

import { test } from 'vitest'

import * as runtimeBarrel from '../src/assistant/runtime.ts'
import * as runtimeSurface from '../src/assistant-runtime.js'

test('assistant runtime barrel re-exports its package-level seam', () => {
  assert.equal(runtimeBarrel.runAssistantChat, runtimeSurface.runAssistantChat)
})
