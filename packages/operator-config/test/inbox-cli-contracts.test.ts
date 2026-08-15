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

test('normalizeInboxRuntimeConfig rejects the removed local email source', () => {
  assert.throws(
    () => Reflect.apply(normalizeInboxRuntimeConfig, undefined, [{
      connectors: [{
        accountId: 'alerts@example.test',
        enabled: false,
        id: 'email-alerts',
        options: {},
        source: 'email',
      }],
    }]),
    /Inbox source "email" is not supported\./u,
  )
})
