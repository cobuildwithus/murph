# Prepare Codex auth mailbox crypto before its transaction

Status: active - local proof complete, PR gates pending
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep provider-capable mailbox crypto work outside the Codex auth database
  transaction so a slow KMS/provider call cannot hold a pooled connection or
  the hosted-member row lock.

## Success criteria

- Codex auth prepares mailbox crypto before opening its transaction.
- The transaction uses only the existing prepared-crypto append surface.
- Attempt, event, and dedupe identity remain stable across the supported single
  prepared-root retry.
- Focused tests and the hosted Web typecheck pass.
- A separate draft PR is opened and exact-head ReviewGPT gates are started.

## Scope

- In scope: `beginHostedCodexAuthAttempt` and its focused store tests.
- Out of scope: device credentials, identity crypto, Linq lock ordering,
  account deletion, member actions, and other legacy mailbox callers.

## Constraints

- Technical constraints: reuse the existing prepared mailbox crypto owner and
  transaction adapter; add no new state, queue, manager, or abstraction.
- Product/process constraints: preserve connect/disconnect behavior and
  idempotency; keep the PR draft; do not merge or mark Ready.

## Risks and mitigations

1. Risk: preparing crypto outside the transaction could change retry identity.
   Mitigation: allocate the next attempt ID once before the existing one-retry
   owner and prove stable attempt, event, and dedupe identity in a focused test.
2. Risk: a provider-capable fallback remains reachable under the lock.
   Mitigation: replace the legacy transaction append with the prepared-only
   adapter and assert preparation ordering plus root-client isolation.

## Tasks

1. Validate the ReviewGPT disposition, artifact hash, scope, and architecture.
2. Apply the agreed two-file patch and inspect it as untrusted intent.
3. Run focused behavioral, lint, type, and diff checks.
4. Commit and push the exact candidate, then open a separate draft PR.
5. Start preliminary specialist and final ReviewGPT against the exact PR head
   concurrently with required CI.

## Decisions

- Reuse `runWithPreparedHostedMailboxItemAppendCrypto` and
  `appendHostedMailboxEnvelopeWithPreparedCryptoTx`; do not introduce a new
  Codex-auth-specific crypto owner.
- Preserve one attempt ID across prepared-root re-entry rather than creating a
  second logical auth attempt.

## Verification

- Commands to run: focused Codex auth/mailbox Vitest files; scoped ESLint;
  hosted Web typecheck; `git diff --check`; exact static call-path searches.
- Expected outcomes: all checks pass, preparation occurs before any transaction
  or member lock, unrelated members are not blocked by preparation, and the
  Codex auth path contains no legacy provider-capable transaction append.
- Completed local proof:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-codex-auth-store.test.ts`
    passed.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm --dir apps/web exec eslint src/lib/codex-auth/store.ts test/hosted-codex-auth-store.test.ts`
    passed.
  - `git diff --check` passed.
  - Static diff searches found no credential/direct-identifier shapes, no
    remaining Codex-auth legacy mailbox append import, and no new `as any` or
    `as unknown` casts.
