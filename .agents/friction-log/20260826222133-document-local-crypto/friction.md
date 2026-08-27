---
title: 'Document local crypto prerequisites for the hosted group PostgreSQL suite'
severity: 'minor'
---

## Expected Behavior

The focused command documented for `hosted-group-join-outreach-reply-recovery-postgres.test.ts` should either prepare every required local test dependency or name the additional prerequisite setup.

## Current Behavior

With a migrated isolated loopback PostgreSQL database and the two documented environment variables, the full file reaches unrelated crypto-backed cases that fail because hosted crypto signing authority and a control-domain root are not configured. A name-filtered run of the intended Telegram concurrency cases passes, but the documented full-file command does not explain that distinction.

## Possible Solution

Give the suite one test-owned local crypto fixture, split the independently configured owner proofs, or document the exact safe local preparation command.

## Minimal Reproducible Example

Against a migrated local database named `murph_dev_example`, run:

```sh
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_dev_example \
MURPH_TEST_POSTGRES_CONCURRENCY=1 \
pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage \
  apps/web/test/hosted-group-join-outreach-reply-recovery-postgres.test.ts
```

The file reports missing hosted crypto authority/root setup in cases outside a focused concurrency change.

## Context

This makes the canonical local command ambiguous during database lock-order remediation and forces a narrower test-name workaround to separate target proof from unrelated environment setup.
