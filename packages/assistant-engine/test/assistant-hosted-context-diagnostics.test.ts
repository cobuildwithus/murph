import { describe, expect, it } from 'vitest'

import {
  buildHostedAssistantContextFingerprintDetails,
  fingerprintHostedAssistantContextValue,
  resolveHostedAssistantContextFingerprintSecret,
} from '../src/assistant/hosted-context-diagnostics.js'

describe('hosted assistant context diagnostics', () => {
  it('correlates matching actor fallback while separating different threads', () => {
    const env = {
      HOSTED_LOG_FINGERPRINT_SECRET: 'diagnostic-secret',
    }
    const first = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env,
      identityId: 'identity-alpha',
      threadId: 'thread-one',
      threadIsDirect: true,
    })
    const second = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env,
      identityId: 'identity-alpha',
      threadId: 'thread-two',
      threadIsDirect: true,
    })

    expect(first.fingerprintReady).toBe(true)
    expect(first.actorFingerprint).toEqual(second.actorFingerprint)
    expect(first.identityFingerprint).toEqual(second.identityFingerprint)
    expect(first.actorFallbackConversationFingerprint).toEqual(
      second.actorFallbackConversationFingerprint,
    )
    expect(first.threadFingerprint).not.toEqual(second.threadFingerprint)
    expect(first.primaryConversationFingerprint).not.toEqual(
      second.primaryConversationFingerprint,
    )
    expect(first.primaryConversationScope).toBe('thread')
    expect(first.actorFallbackConversationScope).toBe('actor')
    expect(JSON.stringify(first)).not.toContain('actor-alpha')
    expect(JSON.stringify(first)).not.toContain('identity-alpha')
    expect(JSON.stringify(first)).not.toContain('thread-one')
  })

  it('omits fingerprints when no platform secret is configured', () => {
    const details = buildHostedAssistantContextFingerprintDetails({
      actorId: 'actor-alpha',
      channel: 'linq',
      env: {},
      identityId: 'identity-alpha',
      threadId: 'thread-one',
      threadIsDirect: true,
    })

    expect(details).toEqual({
      actorFallbackConversationScope: 'actor',
      actorPresent: true,
      channel: 'linq',
      fingerprintReady: false,
      identityPresent: true,
      primaryConversationScope: 'thread',
      sessionPresent: false,
      threadIsDirect: true,
      threadPresent: true,
    })
  })

  it('falls back to the existing usage reporting secret', () => {
    expect(resolveHostedAssistantContextFingerprintSecret({
      HOSTED_AI_USAGE_REPORTING_SECRET: ' usage-secret ',
    })).toBe('usage-secret')
    expect(
      fingerprintHostedAssistantContextValue('usage-secret', 'thread', 'thread-one'),
    ).toMatch(/^h1_[a-f0-9]{24}$/u)
  })
})
