# Prepare Codex auth mailbox crypto before its transaction

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Keep provider-capable mailbox crypto work outside the Codex auth database
  transaction so a slow KMS/provider call cannot hold a pooled connection or
  the hosted-member row lock.

## Success criteria

- Codex auth prepares mailbox crypto before opening the transaction that
  commits a new auth attempt and mailbox wake.
- The transaction uses only the existing prepared-crypto append surface.
- Attempt, event, and dedupe identity remain stable across the supported single
  prepared-root retry.
- Focused tests and the hosted Web typecheck pass.
- A separate draft PR is opened and exact-head ReviewGPT gates pass after
  accepted remediation.

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
6. Apply accepted preliminary remediation and complete the final ReviewGPT
   follow-up round.

## Decisions

- Reuse `runWithPreparedHostedMailboxItemAppendCrypto` and
  `appendHostedMailboxEnvelopeWithPreparedCryptoTx`; do not introduce a new
  Codex-auth-specific crypto owner.
- Preserve one attempt ID across prepared-root re-entry rather than creating a
  second logical auth attempt.
- Preserve provider-independent terminal no-op and existing-wake reuse paths:
  those short locked decisions return without invoking mailbox crypto
  preparation.

## Verification

- Commands to run: focused Codex auth/mailbox Vitest files; scoped ESLint;
  hosted Web typecheck; `git diff --check`; exact static call-path searches.
- Expected outcomes: all checks pass, preparation occurs before the transaction
  that commits a new wake, terminal no-op and existing-wake reuse paths stay
  provider-independent, unrelated members are not blocked by preparation, and
  the Codex auth path contains no legacy provider-capable transaction append.
- Completed local proof:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-codex-auth-store.test.ts`
    passed.
  - After accepting the preliminary specialist finding, `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-codex-auth-store.test.ts apps/web/test/settings-chatgpt-route.test.ts`
    passed.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm --dir apps/web exec eslint src/lib/codex-auth/store.ts test/hosted-codex-auth-store.test.ts`
    passed.
  - After accepting the preliminary specialist finding,
    `pnpm --dir apps/web exec eslint src/lib/codex-auth/store.ts test/hosted-codex-auth-store.test.ts test/settings-chatgpt-route.test.ts`
    passed.
  - `git diff --check` passed.
  - Static diff searches found no credential/direct-identifier shapes, no
    remaining Codex-auth legacy mailbox append import, and no new `as any` or
    `as unknown` casts.

## ReviewGPT disposition

- Preliminary `completion-specialists` returned one finding: unconditional
  mailbox crypto preparation wrapped terminal no-op and existing-wake reuse
  outcomes. Accepted. Remediation keeps those paths provider-independent,
  prepares crypto only for a new wake commit, and revalidates under the member
  lock before appending.
- Final PR ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` on the initial
  candidate head.
- Final PR ReviewGPT round 2 returned `ROUND_OUTCOME: PASS` on the remediated
  head and confirmed the accepted preliminary finding was resolved.
Completed: 2026-08-26
