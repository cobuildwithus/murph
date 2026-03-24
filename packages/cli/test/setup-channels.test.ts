import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { readAssistantAutomationState } from '../src/assistant-state.js'
import { createSetupAgentmailSelectionResolver } from '../src/setup-agentmail.js'
import { configureSetupChannels } from '../src/setup-services/channels.js'
import { VaultCliError } from '../src/vault-cli-errors.js'

test('configureSetupChannels enables Telegram auto-reply only after the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-channels-'))

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
    assert.deepEqual(configured[0]?.missingEnv, [])
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
    assert.deepEqual(automationState.autoReplyChannels, ['telegram'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels adds a Linq connector and persists auto-reply when the doctor probe passes', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-linq-'))

  try {
    const doctorCalls: string[] = []
    const sourceAddCalls: Array<Record<string, unknown>> = []
    const configured = await configureSetupChannels({
      channels: ['linq'],
      dryRun: false,
      env: {
        LINQ_API_TOKEN: 'linq-token',
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
                message: 'linq api reachable',
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
          sourceAddCalls.push(input as unknown as Record<string, unknown>)
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'default',
              id: 'linq:default',
              source: 'linq',
              enabled: true,
              options: {
                linqWebhookHost: '0.0.0.0',
                linqWebhookPath: '/linq-webhook',
                linqWebhookPort: 8789,
              },
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

    assert.equal(configured[0]?.channel, 'linq')
    assert.equal(configured[0]?.configured, true)
    assert.equal(configured[0]?.autoReply, true)
    assert.equal(configured[0]?.connectorId, 'linq:default')
    assert.deepEqual(configured[0]?.missingEnv, [])
    assert.match(configured[0]?.detail ?? '', /0\.0\.0\.0:8789\/linq-webhook/u)
    assert.deepEqual(doctorCalls, ['linq:default'])
    assert.deepEqual(sourceAddCalls, [
      {
        account: 'default',
        id: 'linq:default',
        requestId: null,
        source: 'linq',
        vault,
      },
    ])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['linq'])
    assert.deepEqual(automationState.preferredChannels, ['linq'])
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
        AGENTMAIL_API_KEY: 'am_test_123',
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
    assert.deepEqual(configured[0]?.missingEnv, [])
    assert.match(configured[0]?.detail ?? '', /healthybob@example\.test/u)

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['email'])
    assert.deepEqual(automationState.autoReplyBacklogChannels, ['email'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels keeps email selected in onboarding preferences even when AgentMail readiness fails', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-email-fail-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['email'],
      dryRun: false,
      env: {
        AGENTMAIL_API_KEY: 'am_test_123',
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
    assert.deepEqual(configured[0]?.missingEnv, [])
    assert.match(configured[0]?.detail ?? '', /401 unauthorized/u)

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, [])
    assert.deepEqual(automationState.preferredChannels, ['email'])
    assert.deepEqual(automationState.autoReplyBacklogChannels, [])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels treats an empty but reachable AgentMail inbox as configured and auto-reply ready', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-email-warn-'))

  try {
    const configured = await configureSetupChannels({
      channels: ['email'],
      dryRun: false,
      env: {
        AGENTMAIL_API_KEY: 'am_test_123',
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
                message: 'The AgentMail inbox responded but returned no unread messages.',
                name: 'probe',
                status: 'warn' as const,
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

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['email'])
    assert.deepEqual(automationState.preferredChannels, ['email'])
    assert.deepEqual(automationState.autoReplyBacklogChannels, ['email'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels disables stale setup connectors that were not selected in onboarding', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-channel-reconcile-'))

  try {
    const sourceSetEnabledCalls: Array<{
      connectorId: string
      enabled: boolean
    }> = []

    const configured = await configureSetupChannels({
      channels: ['email'],
      dryRun: false,
      env: {
        AGENTMAIL_API_KEY: 'am_test_123',
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
                message: 'The AgentMail inbox responded but returned no unread messages.',
                name: 'probe',
                status: 'warn' as const,
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
        async sourceList() {
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connectors: [
              {
                accountId: 'healthybob@agentmail.to',
                enabled: true,
                id: 'email:agentmail',
                options: {
                  emailAddress: 'healthybob@agentmail.to',
                },
                source: 'email' as const,
              },
              {
                accountId: 'self',
                enabled: true,
                id: 'imessage:self',
                options: {
                  includeOwnMessages: true,
                },
                source: 'imessage' as const,
              },
            ],
          }
        },
        async sourceAdd() {
          throw new Error('sourceAdd should not be called when an email connector already exists')
        },
        async sourceSetEnabled(input) {
          sourceSetEnabledCalls.push({
            connectorId: input.connectorId,
            enabled: input.enabled,
          })
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: input.connectorId === 'email:agentmail' ? 'healthybob@agentmail.to' : 'self',
              enabled: input.enabled,
              id: input.connectorId,
              options:
                input.connectorId === 'email:agentmail'
                  ? {
                      emailAddress: 'healthybob@agentmail.to',
                    }
                  : {
                      includeOwnMessages: true,
                    },
              source: input.connectorId === 'email:agentmail' ? 'email' : 'imessage',
            },
            connectorCount: 2,
          }
        },
      },
      requestId: null,
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'email')
    assert.equal(configured[0]?.configured, true)
    assert.deepEqual(sourceSetEnabledCalls, [
      {
        connectorId: 'imessage:self',
        enabled: false,
      },
    ])

    const automationState = await readAssistantAutomationState(vault)
    assert.deepEqual(automationState.autoReplyChannels, ['email'])
    assert.deepEqual(automationState.preferredChannels, ['email'])
    assert.deepEqual(automationState.autoReplyBacklogChannels, ['email'])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('configureSetupChannels reuses a discovered AgentMail inbox during onboarding before falling back to provisioning', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'healthybob-setup-email-discovered-'))

  try {
    const sourceAddCalls: Array<Record<string, unknown>> = []
    const configured = await configureSetupChannels({
      allowPrompt: true,
      channels: ['email'],
      dryRun: false,
      env: {
        AGENTMAIL_API_KEY: 'am_test_123',
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
        async sourceAdd(input) {
          sourceAddCalls.push(input as unknown as Record<string, unknown>)
          return {
            vault,
            configPath: '.runtime/inboxd/config.json',
            connector: {
              accountId: 'existing@example.test',
              id: 'email:agentmail',
              source: 'email',
              enabled: true,
              options: {
                emailAddress: 'existing@example.test',
              },
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
      resolveAgentmailInboxSelection: async () => ({
        accountId: 'existing@example.test',
        emailAddress: 'existing@example.test',
        mode: 'discovered' as const,
      }),
      steps: [],
      vault,
    })

    assert.equal(configured[0]?.channel, 'email')
    assert.equal(configured[0]?.configured, true)
    assert.equal(configured[0]?.autoReply, true)
    assert.deepEqual(sourceAddCalls, [
      {
        account: 'existing@example.test',
        address: 'existing@example.test',
        emailDisplayName: 'Healthy Bob',
        id: 'email:agentmail',
        provision: false,
        requestId: null,
        source: 'email',
        vault,
      },
    ])
  } finally {
    await rm(vault, { recursive: true, force: true })
  }
})

test('createSetupAgentmailSelectionResolver paginates AgentMail inbox discovery before prompting for selection', async () => {
  const listInboxesCalls: Array<{ pageToken?: string | null }> = []
  const chooserCalls: string[][] = []
  const resolver = createSetupAgentmailSelectionResolver({
    createClient() {
      return {
        apiKey: 'agentmail-key',
        baseUrl: 'https://api.agentmail.to/v0',
        async listInboxes(input?: { pageToken?: string | null }) {
          listInboxesCalls.push(input ?? {})
          if (!input?.pageToken) {
            return {
              count: 1,
              inboxes: [
                {
                  inbox_id: 'page-1@example.test',
                  email: 'page-1@example.test',
                },
              ],
              next_page_token: 'page-2',
            }
          }

          if (input.pageToken === 'page-2') {
            return {
              count: 1,
              inboxes: [
                {
                  inbox_id: 'page-2@example.test',
                  email: 'page-2@example.test',
                },
              ],
            }
          }

          throw new Error(`unexpected page token: ${String(input.pageToken)}`)
        },
      } as any
    },
    prompter: {
      async chooseInbox(input) {
        chooserCalls.push(input.inboxes.map((inbox) => inbox.inbox_id))
        return input.inboxes[1] ?? null
      },
      async promptManualInboxId() {
        throw new Error('promptManualInboxId should not be called in this test')
      },
    },
  })

  const selected = await resolver({
    allowPrompt: true,
    env: {
      AGENTMAIL_API_KEY: 'agentmail-key',
    },
  })

  assert.deepEqual(listInboxesCalls, [{}, { pageToken: 'page-2' }])
  assert.deepEqual(chooserCalls, [['page-1@example.test', 'page-2@example.test']])
  assert.deepEqual(selected, {
    accountId: 'page-2@example.test',
    emailAddress: 'page-2@example.test',
    mode: 'selected',
  })
})

test('createSetupAgentmailSelectionResolver returns a manual inbox id when discovery is forbidden and the operator enters one', async () => {
  const resolver = createSetupAgentmailSelectionResolver({
    createClient() {
      return {
        apiKey: 'agentmail-key',
        baseUrl: 'https://api.agentmail.to/v0',
        async listInboxes() {
          throw new VaultCliError('AGENTMAIL_REQUEST_FAILED', 'Forbidden', {
            status: 403,
            method: 'GET',
            path: '/inboxes',
          })
        },
      } as any
    },
    prompter: {
      async chooseInbox() {
        throw new Error('chooseInbox should not be called in this test')
      },
      async promptManualInboxId() {
        return 'manual@example.test'
      },
    },
  })

  const selected = await resolver({
    allowPrompt: true,
    env: {
      AGENTMAIL_API_KEY: 'agentmail-key',
    },
  })

  assert.deepEqual(selected, {
    accountId: 'manual@example.test',
    emailAddress: null,
    mode: 'manual',
  })
})

test('createSetupAgentmailSelectionResolver rethrows unexpected discovery failures instead of silently provisioning', async () => {
  const resolver = createSetupAgentmailSelectionResolver({
    createClient() {
      return {
        apiKey: 'agentmail-key',
        baseUrl: 'https://api.agentmail.to/v0',
        async listInboxes() {
          throw new Error('agentmail unavailable')
        },
      } as any
    },
  })

  await assert.rejects(
    resolver({
      allowPrompt: true,
      env: {
        AGENTMAIL_API_KEY: 'agentmail-key',
      },
    }),
    /agentmail unavailable/u,
  )
})
