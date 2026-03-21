import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { readAssistantAutomationState } from '../src/assistant-state.js'
import { configureSetupChannels } from '../src/setup-services/channels.js'

test('configureSetupChannels enables Telegram auto-reply only after the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-channels-'))

  try {
    const doctorCalls: string[] = []
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        HEALTHYBOB_TELEGRAM_BOT_TOKEN: 'bot-token',
      },
      inboxServices: {
        async bootstrap() {
          throw new Error('bootstrap should not be called in this test')
        },
        async doctor(input) {
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
    assert.deepEqual(doctorCalls, ['telegram:bot'])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, [])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels persists Telegram auto-reply when the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-channels-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['telegram'],
      dryRun: false,
      env: {
        HEALTHYBOB_TELEGRAM_BOT_TOKEN: 'bot-token',
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

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['telegram'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})
