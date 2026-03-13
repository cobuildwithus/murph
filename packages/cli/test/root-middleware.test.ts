import assert from 'node:assert/strict'
import { test } from 'vitest'
import { z } from 'incur'
import { wrapCommand } from '../src/root-middleware.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

test('wrapCommand reparses options and forwards request metadata', async () => {
  const command = wrapCommand({
    command: 'test wrap',
    description: 'Test command wrapper behavior.',
    args: z.object({}),
    options: z.object({
      vault: z.string(),
      format: z.enum(['json', 'md']).default('json'),
      requestId: z.string().optional(),
      count: z.coerce.number().int(),
    }),
    data: z.object({
      count: z.number().int(),
      vault: z.string(),
      requestId: z.string().nullable(),
      format: z.enum(['json', 'md']),
    }),
    async run({ vault, requestId, format, options }) {
      return {
        count: options.count,
        vault,
        requestId,
        format,
      }
    },
    renderMarkdown({ data }) {
      return `count=${data.count}`
    },
  })

  const result = await command.run({
    args: {},
    options: {
      vault: '/tmp/test-vault',
      format: 'md',
      requestId: 'req-123',
      count: '2',
    },
  })

  assert.equal(result.ok, true)
  if (!result.ok) {
    throw new Error('Expected success envelope.')
  }

  assert.deepEqual(result.data, {
    count: 2,
    vault: '/tmp/test-vault',
    requestId: 'req-123',
    format: 'md',
  })
  assert.equal(result.format, 'md')
  assert.equal(result.requestId, 'req-123')
  assert.equal(result.rendered, 'count=2')
})

test('wrapCommand normalizes thrown errors into failure envelopes', async () => {
  const command = wrapCommand({
    command: 'test wrap fail',
    description: 'Test command wrapper failures.',
    args: z.object({}),
    options: z.object({
      vault: z.string(),
      format: z.enum(['json', 'md']).default('json'),
      requestId: z.string().optional(),
    }),
    data: z.object({
      ok: z.boolean(),
    }),
    async run() {
      throw new VaultCliError('boom', 'Exploded on purpose.')
    },
  })

  const result = await command.run({
    args: {},
    options: {
      vault: '/tmp/test-vault',
      format: 'json',
      requestId: 'req-fail',
    },
  })

  assert.equal(result.ok, false)
  if (result.ok) {
    throw new Error('Expected failure envelope.')
  }

  assert.equal(result.command, 'test wrap fail')
  assert.equal(result.format, 'json')
  assert.equal(result.requestId, 'req-fail')
  assert.equal(result.error.code, 'boom')
  assert.equal(result.error.message, 'Exploded on purpose.')
})
