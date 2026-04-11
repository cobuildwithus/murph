import assert from 'node:assert/strict'
import { test } from 'vitest'

import { startAssistantHttpServer } from '../src/http.js'
import type { AssistantLocalService } from '../src/service.js'

test('assistantd http server rejects URL-bracket listener hosts before binding', async () => {
  await assert.rejects(
    () =>
      startAssistantHttpServer({
        controlToken: 'control-secret',
        host: '[::1]',
        port: 0,
        service: {} as AssistantLocalService,
      }),
    /Assistant daemon listener host must be a loopback hostname or address\./u,
  )
})
