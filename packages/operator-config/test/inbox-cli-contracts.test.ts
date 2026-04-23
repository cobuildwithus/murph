import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  normalizeInboxConnectorAccountId,
  normalizeInboxConnectorConfig,
  normalizeInboxRuntimeConfig,
} from '../src/inbox-cli-contracts.ts'

test('normalizeInboxConnectorAccountId applies source-specific defaults', () => {
  assert.equal(normalizeInboxConnectorAccountId('telegram', null), 'bot')
  assert.equal(normalizeInboxConnectorAccountId('telegram', 'team-bot'), 'team-bot')
  assert.equal(normalizeInboxConnectorAccountId('email', null), null)
  assert.equal(normalizeInboxConnectorAccountId('email', 'ops@example.com'), 'ops@example.com')
  assert.equal(normalizeInboxConnectorAccountId('linq', null), 'default')
  assert.equal(normalizeInboxConnectorAccountId('linq', 'partner-account'), 'partner-account')
})

test('normalizeInboxConnectorConfig and runtime config normalize connector account ids', () => {
  assert.deepEqual(
    normalizeInboxConnectorConfig({
      accountId: null,
      enabled: true,
      id: 'telegram-primary',
      options: {},
      source: 'telegram',
    }),
    {
      accountId: 'bot',
      enabled: true,
      id: 'telegram-primary',
      options: {},
      source: 'telegram',
    },
  )

  assert.deepEqual(
    normalizeInboxRuntimeConfig({
      connectors: [
        {
          accountId: null,
          enabled: true,
          id: 'telegram-primary',
          options: {},
          source: 'telegram',
        },
        {
          accountId: null,
          enabled: true,
          id: 'linq-default',
          options: {},
          source: 'linq',
        },
        {
          accountId: 'alerts@example.com',
          enabled: false,
          id: 'email-alerts',
          options: {},
          source: 'email',
        },
      ],
    }),
    {
      connectors: [
        {
          accountId: 'bot',
          enabled: true,
          id: 'telegram-primary',
          options: {},
          source: 'telegram',
        },
        {
          accountId: 'default',
          enabled: true,
          id: 'linq-default',
          options: {},
          source: 'linq',
        },
        {
          accountId: 'alerts@example.com',
          enabled: false,
          id: 'email-alerts',
          options: {},
          source: 'email',
        },
      ],
    },
  )
})

test('normalizeInboxConnectorAccountId rejects unsupported sources at runtime', () => {
  assert.throws(
    () => Reflect.apply(normalizeInboxConnectorAccountId, undefined, ['sms', null]),
    /Inbox source "sms" is not supported\./u,
  )
})
