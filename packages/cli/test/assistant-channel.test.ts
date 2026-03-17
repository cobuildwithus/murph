import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'vitest'
import {
  deliverAssistantMessage,
  resolveImessageDeliveryCandidates,
} from '../src/outbound-channel.js'

const cleanupPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map(async (target) => {
      await rm(target, {
        recursive: true,
        force: true,
      })
    }),
  )
})

test('resolveImessageDeliveryCandidates prefers explicit targets and otherwise uses the stored binding delivery', () => {
  assert.deepEqual(
    resolveImessageDeliveryCandidates({
      explicitTarget: 'chat-override',
      bindingDelivery: {
        kind: 'thread',
        target: 'chat-123',
      },
    }),
    [
      {
        kind: 'explicit',
        target: 'chat-override',
      },
    ],
  )

  assert.deepEqual(
    resolveImessageDeliveryCandidates({
      bindingDelivery: {
        kind: 'participant',
        target: '+15551234567',
      },
    }),
    [
      {
        kind: 'participant',
        target: '+15551234567',
      },
    ],
  )

  assert.deepEqual(
    resolveImessageDeliveryCandidates({
      bindingDelivery: {
        kind: 'thread',
        target: 'chat45e2b868',
      },
    }),
    [
      {
        kind: 'thread',
        target: 'chat45e2b868',
      },
    ],
  )
})

test('deliverAssistantMessage resolves a session, sends over iMessage, and records the latest assistant message', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const sent: Array<{ message: string; target: string }> = []
  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Lunch is logged.',
    },
    {
      sendImessage: async (input: { message: string; target: string }) => {
        sent.push(input)
      },
    },
  )

  assert.equal(sent.length, 1)
  assert.deepEqual(sent[0], {
    target: '+15551234567',
    message: 'Lunch is logged.',
  })
  assert.equal(result.delivery.channel, 'imessage')
  assert.equal(result.delivery.target, '+15551234567')
  assert.equal(result.delivery.targetKind, 'participant')
  assert.equal(result.session.binding.channel, 'imessage')
  assert.equal(result.session.binding.delivery?.target, '+15551234567')
  assert.equal(result.session.lastAssistantMessage, 'Lunch is logged.')
  assert.equal(result.session.turnCount, 0)
})

test('deliverAssistantMessage uses one-off targets only for the current send and does not rewrite the stored binding', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-override-'))
  const vaultRoot = path.join(parent, 'vault')
  await mkdir(vaultRoot)
  cleanupPaths.push(parent)

  const result = await deliverAssistantMessage(
    {
      vault: vaultRoot,
      channel: 'imessage',
      participantId: '+15551234567',
      message: 'Temporary override.',
      target: 'chat-override',
    },
    {
      sendImessage: async () => {},
    },
  )

  assert.equal(result.delivery.target, 'chat-override')
  assert.equal(result.delivery.targetKind, 'explicit')
  assert.equal(result.session.binding.delivery?.kind, 'participant')
  assert.equal(result.session.binding.delivery?.target, '+15551234567')
})

test('deliverAssistantMessage redacts HOME-based vault paths in its result payload', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'healthybob-assistant-channel-home-'))
  const homeRoot = path.join(parent, 'home')
  const vaultRoot = path.join(homeRoot, 'vault')
  await mkdir(vaultRoot, {
    recursive: true,
  })
  cleanupPaths.push(parent)

  const originalHome = process.env.HOME
  process.env.HOME = homeRoot

  try {
    const result = await deliverAssistantMessage(
      {
        vault: vaultRoot,
        channel: 'imessage',
        participantId: '+15551234567',
        message: 'Redact the vault path.',
      },
      {
        sendImessage: async () => {},
      },
    )

    assert.equal(result.vault, path.join('~', 'vault'))
  } finally {
    restoreEnvironmentVariable('HOME', originalHome)
  }
})

function restoreEnvironmentVariable(
  key: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[key]
    return
  }

  process.env[key] = value
}
