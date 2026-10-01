import { describe, expect, it } from 'vitest';
import { buildHostedExecutionConversationMessageWake } from '../src/builders.ts';
import { parseHostedExecutionWake } from '../src/parsers.ts';
import { readHostedExecutionConversationMessageText } from '../src/contracts.ts';
import { readHostedConversationAssistantIdentifierSecret } from '../src/assistant-identifiers.ts';

describe('native voice conversation contract', () => {
  const message = {
    channel: 'voice' as const,
    callId: 'synthetic-call',
    inputId: 'synthetic-input-1',
    text: 'Read the current synthetic record.',
  };
  const wake = buildHostedExecutionConversationMessageWake({
    eventId: 'synthetic-voice-event',
    userId: 'synthetic-member',
    occurredAt: '2026-09-21T12:00:00.000Z',
    message,
  });

  it('round trips through the existing conversation mailbox format', () => {
    expect(parseHostedExecutionWake(wake)).toEqual(wake);
    expect(wake.message).not.toBe(message);
    expect(readHostedExecutionConversationMessageText(message)).toBe(message.text);
    expect(readHostedConversationAssistantIdentifierSecret(wake)).toBe(message.callId);
    expect(readHostedConversationAssistantIdentifierSecret({ ...wake, eventId: 'next', message: { ...message, inputId: 'next' } }))
      .toBe(message.callId);
  });

  it.each(['callId', 'inputId', 'text'])('rejects missing %s instead of synthesizing speech', (field) => {
    expect(() => parseHostedExecutionWake({ ...wake, message: { ...message, [field]: '' } })).toThrow();
    expect(() => parseHostedExecutionWake({ ...wake, message: { ...message, [field]: null } })).toThrow();
  });
});
