import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { readAssistantAutomationState } from '@murphai/assistant-engine/assistant-state'
import type { InboxServices } from '@murphai/inbox-services'
import { configureSetupChannels } from '@murphai/setup-cli/setup-cli'

type InboxDoctorInput = Parameters<InboxServices['doctor']>[0]
type InboxSourceSetEnabledInput = Parameters<InboxServices['sourceSetEnabled']>[0]

function listAutoReplyChannels(
  state: Awaited<ReturnType<typeof readAssistantAutomationState>>,
): string[] {
  return state.autoReply.map((entry) => entry.channel)
}

test('configureSetupChannels enables Telegram auto-reply only after the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-setup-channels-'))

  try {
    const doctorCalls: string[] = []
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not be called in this test')
        },
        async doctor(input: InboxDoctorInput) {
          doctorCalls.push(input.sourceId ?? '')
          return {
            vault,
            checks: [
              {
                message: '401 unauthorized',
                name: 'probe',
                status: 'fail' as const,
              },
            ],
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
            databasePath: '.runtime/inboxd.sqlite',
            ok: false,
            parserToolchain: null,
            target: input.sourceId ?? null,
          }
        },
        async sourceAdd() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'bot',
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              options: {},
            },
            connectorCount: 1,
          }
        },
        async sourceList() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
          }
        },
      },
      requestId: null,
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'telegram')
    assert.equal(configured[0]?.configured, false)
    assert.equal(configured[0]?.autoReply, false)
    assert.deepEqual(configured[0]?.missingEnv, [])
    assert.deepEqual(doctorCalls, ['telegram:bot'])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(listAutoReplyChannels(automationState), [])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels persists Telegram auto-reply when the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-setup-channels-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not be called in this test')
        },
        async doctor() {
          return {
            vault,
            checks: [
              {
                message: 'bot authenticated',
                name: 'probe',
                status: 'pass' as const,
              },
            ],
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
            databasePath: '.runtime/inboxd.sqlite',
            ok: true,
            parserToolchain: null,
            target: 'telegram:bot',
          }
        },
        async sourceAdd() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'bot',
              id: 'telegram:bot',
              source: 'telegram',
              enabled: true,
              options: {},
            },
            connectorCount: 1,
          }
        },
        async sourceList() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
          }
        },
      },
      requestId: null,
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'telegram')
    assert.equal(configured[0]?.configured, true)
    assert.equal(configured[0]?.autoReply, true)
    assert.deepEqual(configured[0]?.missingEnv, [])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(listAutoReplyChannels(automationState), ['telegram'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels reuses a disabled Telegram connector and re-enables it before probing readiness', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-setup-channels-'))

  try {
    const doctorCalls: string[] = []
    const sourceSetEnabledCalls: Array<{
      connectorId: string
      enabled: boolean
    }> = []
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not be called in this test')
        },
        async doctor(input: InboxDoctorInput) {
          doctorCalls.push(input.sourceId ?? '')
          return {
            vault,
            checks: [
              {
                message: 'bot authenticated',
                name: 'probe',
                status: 'pass' as const,
              },
            ],
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
            databasePath: '.runtime/inboxd.sqlite',
            ok: true,
            parserToolchain: null,
            target: input.sourceId ?? null,
          }
        },
        async sourceAdd() {
          throw new Error('sourceAdd should not be called when a Telegram connector exists')
        },
        async sourceList() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connectors: [
              {
                accountId: 'bot',
                enabled: false,
                id: 'telegram:bot',
                options: {},
                source: 'telegram' as const,
              },
            ],
          }
        },
        async sourceSetEnabled(input: InboxSourceSetEnabledInput) {
          sourceSetEnabledCalls.push({
            connectorId: input.connectorId,
            enabled: input.enabled,
          })
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'bot',
              enabled: input.enabled,
              id: input.connectorId,
              options: {},
              source: 'telegram',
            },
            connectorCount: 1,
          }
        },
      },
      requestId: null,
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'telegram')
    assert.equal(configured[0]?.configured, true)
    assert.equal(configured[0]?.autoReply, true)
    assert.equal(configured[0]?.connectorId, 'telegram:bot')
    assert.deepEqual(doctorCalls, ['telegram:bot'])
    assert.deepEqual(sourceSetEnabledCalls, [
      {
        connectorId: 'telegram:bot',
        enabled: true,
      },
    ])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(listAutoReplyChannels(automationState), ['telegram'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels preserves unmanaged Linq connector and auto-reply state while adding Telegram', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'murph-setup-channels-linq-'))

  try {
    await import('@murphai/assistant-engine/assistant-state').then(({ saveAssistantAutomationState }) =>
      saveAssistantAutomationState(vault, {
        version: 1,
        autoReply: [
          {
            channel: 'linq',
            enabledAt: '2026-04-08T00:00:00.000Z',
            eligibleAfter: null,
          },
        ],
        updatedAt: '2026-04-08T00:00:00.000Z',
      }),
    )

    const sourceSetEnabledCalls: InboxSourceSetEnabledInput[] = []
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not be called in this test')
        },
        async doctor(input: InboxDoctorInput) {
          return {
            vault,
            checks: [
              {
                message: 'bot authenticated',
                name: 'probe',
                status: 'pass' as const,
              },
            ],
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
            databasePath: '.runtime/inboxd.sqlite',
            ok: true,
            parserToolchain: null,
            target: input.sourceId ?? null,
          }
        },
        async sourceAdd(input) {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: input.account ?? null,
              enabled: true,
              id: input.id,
              options: {},
              source: input.source,
            },
            connectorCount: 2,
          }
        },
        async sourceList() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connectors: [
              {
                accountId: 'default',
                enabled: true,
                id: 'linq:default',
                options: {
                  linqWebhookHost: '127.0.0.1',
                  linqWebhookPath: '/hooks/linq',
                  linqWebhookPort: 9911,
                },
                source: 'linq' as const,
              },
            ],
          }
        },
        async sourceSetEnabled(input: InboxSourceSetEnabledInput) {
          sourceSetEnabledCalls.push(input)
          throw new Error('Linq connector must remain unmanaged by Telegram setup')
        },
      },
      requestId: null,
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'telegram')
    assert.equal(configured[0]?.configured, true)
    assert.deepEqual(sourceSetEnabledCalls, [])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(listAutoReplyChannels(automationState), ['linq', 'telegram'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})
