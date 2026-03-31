import test from 'node:test'
import assert from 'node:assert/strict'

import {
  collectPatchArtifactLabels,
  isThreadAttachmentCandidate,
} from './chatgpt-attachment-files.mjs'

test('rejects ChatGPT conversation links that only look like patch attachments by title', () => {
  assert.equal(
    isThreadAttachmentCandidate({
      text: 'Behavior-preserving Simplification Patch',
      href: 'https://chatgpt.com/c/69cb5d8c-8970-8333-9d3a-d25be95dbddb',
    }),
    false,
  )
})

test('accepts explicit downloadable patch artifacts', () => {
  assert.equal(
    isThreadAttachmentCandidate({
      text: 'simplification.patch',
      href: 'https://files.example.invalid/simplification.patch',
    }),
    true,
  )
  assert.deepEqual(
    collectPatchArtifactLabels([
      {
        text: 'simplification.patch',
        href: 'https://files.example.invalid/simplification.patch',
      },
      {
        text: 'patch bundle',
        href: 'https://chatgpt.com/c/69cb5d8c-8970-8333-9d3a-d25be95dbddb',
      },
      {
        text: 'review.zip',
        href: 'https://files.example.invalid/review.zip',
      },
    ]),
    ['simplification.patch', 'review.zip'],
  )
})

test('accepts download controls even when the label is not file-like', () => {
  assert.equal(
    isThreadAttachmentCandidate({
      text: 'Download file',
      href: null,
      download: true,
    }),
    true,
  )
})

test('treats assistant behavior patch buttons as downloadable patch artifacts', () => {
  const items = [
    {
      text: 'murph-audit-20260331-070947Z.zip',
      href: null,
      download: false,
      behaviorButton: false,
      insideAssistantMessage: false,
    },
    {
      text: 'Combined patch',
      href: null,
      behaviorButton: true,
      insideAssistantMessage: true,
    },
    {
      text: 'Extended Pro',
      href: null,
      behaviorButton: true,
      insideAssistantMessage: true,
    },
  ]

  assert.equal(isThreadAttachmentCandidate(items[1]), true)
  assert.deepEqual(collectPatchArtifactLabels(items), ['Combined patch'])
})

test('keeps real file-backed patch artifacts alongside assistant patch buttons', () => {
  const items = [
    {
      text: 'Combined patch',
      href: null,
      behaviorButton: true,
      insideAssistantMessage: true,
    },
    {
      text: 'foo__SLASH__bar.patched',
      href: 'https://files.example.invalid/foo__SLASH__bar.patched',
      behaviorButton: false,
      insideAssistantMessage: true,
    },
  ]

  assert.deepEqual(collectPatchArtifactLabels(items), [
    'Combined patch',
    'foo__SLASH__bar.patched',
  ])
})

test('keeps assistant download controls even when the visible label is generic', () => {
  const items = [
    {
      text: 'Combined patch',
      href: null,
      behaviorButton: true,
      insideAssistantMessage: true,
    },
    {
      text: 'Download',
      href: null,
      download: true,
      behaviorButton: false,
      insideAssistantMessage: true,
    },
  ]

  assert.deepEqual(collectPatchArtifactLabels(items), [
    'Combined patch',
    'Download',
  ])
})
