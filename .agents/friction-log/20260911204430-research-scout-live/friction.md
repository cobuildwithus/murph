---
title: 'Research scout live fixture hides replies when command logs are absent'
severity: 'minor'
---

## Expected Behavior

The existing ongoing-interest/repetition research journey prints each actual
assistant reply before reading command logs. No-CLI runs remain assertion
failures: both scenarios require exactly one retrieval before payload inspection.
The repeated scenario still requires zero writes and a quiet result.

## Current Behavior

The fixture creates calls.jsonl and retrievals.jsonl only when commands run.
Reading calls.jsonl before printing the reply throws ENOENT on a no-CLI turn,
obscuring the assistant outcome. Merely creating an empty retrieval log is not
sufficient: trim().split('\n') counts empty content as one entry and can defer
the failure to a missing payload instead of reporting the observed zero reads.

## Possible Solution

Precreate the two owned empty logs during fixture setup, print the actual reply
before any log read, filter empty lines, and fail with the observed retrieval
count before reading payload.json. Keep all original effect and quiet-result
assertions; do not change prompts, model selection, or provider behavior.

## Minimal Reproducible Example

This local synthetic filesystem reproduction makes no CLI or provider call:

```bash
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = await mkdtemp(path.join(tmpdir(), 'scout-empty-log-repro-'));
try {
  const printed = [];
  await assert.rejects(async () => {
    await readFile(path.join(directory, 'calls.jsonl'), 'utf8');
    printed.push('Synthetic no-CLI outcome');
  }, { code: 'ENOENT' });
  assert.deepEqual(printed, []);
  assert.equal(''.trim().split('\n').length, 1);
  assert.equal(''.trim().split('\n').filter(Boolean).length, 0);
} finally {
  await rm(directory, { recursive: true, force: true });
}
NODE
```

## Context

Owner: packages/assistant-engine/test/assistant-codex-real-e2e.test.ts, the
"shares relevant learning without an open decision and suppresses repeated
research" journey. Synthetic research and repetition state live in the injected
fixture. An apparently quiet no-CLI reply does not prove correct suppression.
The correction is diagnostic only; actual same-home live reply/action review
remains required. No private transcript, identity, home path, or production
payload is included.
