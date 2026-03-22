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

test('configureSetupChannels provisions email and persists auto-reply when AgentMail readiness passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-email-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['email'],
      dryRun: false,
      env: {
        HEALTHYBOB_AGENTMAIL_API_KEY: 'am_test_123',
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
                message: 'email inbox reachable',
                name: 'driver-import',
                status: 'pass' as const,
              },
              {
                message: 'email inbox reachable',
                name: 'probe',
                status: 'pass' as const,
              },
            ],
            configPath: '.runtime/inboxd/config.json',
            connectors: [],
            databasePath: '.runtime/inboxd.sqlite',
            ok: true,
            parserToolchain: null,
            target: 'email:agentmail',
          }
        },
        async sourceAdd() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'inbox_123',
              id: 'email:agentmail',
              source: 'email',
              enabled: true,
              options: {
                emailAddress: 'healthybob@example.test',
              },
            },
            connectorCount: 1,
            provisionedMailbox: {
              inboxId: 'inbox_123',
              emailAddress: 'healthybob@example.test',
              displayName: 'Healthy Bob',
              clientId: null,
              provider: 'agentmail' as const,
            },
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

    assert.equal(configured[0]?.channel, 'email')
    assert.equal(configured[0]?.configured, true)
    assert.equal(configured[0]?.autoReply, true)
    assert.equal(configured[0]?.connectorId, 'email:agentmail')
    assert.match(configured[0]?.detail ?? '', /healthybob@example\.test/u)

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['email'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels keeps email configured but disables auto-reply when AgentMail readiness fails', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-email-fail-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['email'],
      dryRun: false,
      env: {
        HEALTHYBOB_AGENTMAIL_API_KEY: 'am_test_123',
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
                message: 'driver initialized',
                name: 'driver-import',
                status: 'pass' as const,
              },
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
            target: 'email:agentmail',
          }
        },
        async sourceAdd() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'inbox_123',
              id: 'email:agentmail',
              source: 'email',
              enabled: true,
              options: {
                emailAddress: 'healthybob@example.test',
              },
            },
            connectorCount: 1,
            provisionedMailbox: {
              inboxId: 'inbox_123',
              emailAddress: 'healthybob@example.test',
              displayName: 'Healthy Bob',
              clientId: null,
              provider: 'agentmail' as const,
            },
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

    assert.equal(configured[0]?.channel, 'email')
    assert.equal(configured[0]?.configured, false)
    assert.equal(configured[0]?.autoReply, false)
    assert.equal(configured[0]?.connectorId, 'email:agentmail')
    assert.match(configured[0]?.detail ?? '', /401 unauthorized/u)

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, [])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})
