import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { initializeVault, readJsonlRecords } from '@murphai/core';
import { createInboxPipeline, openInboxRuntime } from '../src/runtime.ts';
import { normalizeHostedVoiceConversationCapture } from '../src/connectors/hosted-conversation.ts';

it('persists normalized voice through the canonical inbox and deduplicates replay', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-voice-inbox-'));
  try {
    await initializeVault({ vaultRoot, createdAt: '2026-09-21T12:00:00.000Z' });
    const runtime = await openInboxRuntime({ vaultRoot });
    const pipeline = await createInboxPipeline({ vaultRoot, runtime });
    try {
      const capture = normalizeHostedVoiceConversationCapture({
        callId: 'synthetic-call', inputId: 'synthetic-input',
        occurredAt: '2026-09-21T12:00:00.000Z', text: 'Read the current synthetic record.',
      });
      const first = await pipeline.processCapture(capture);
      const replay = await pipeline.processCapture(capture);
      expect(replay.captureId).toBe(first.captureId);
      expect(replay.deduped).toBe(true);
      expect(runtime.getCapture(first.captureId)).toMatchObject({
        source: 'voice', text: capture.text, thread: { id: 'synthetic-call', isDirect: true },
        attachments: [],
      });
      expect(runtime.listAttachmentParseJobs({ limit: 1 })).toEqual([]);
      const records = await readJsonlRecords({ vaultRoot, relativePath: 'ledger/inbox-captures/2026/2026-09.jsonl' });
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ source: 'voice', text: capture.text, externalId: capture.externalId });
    } finally {
      pipeline.close();
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true });
  }
});
