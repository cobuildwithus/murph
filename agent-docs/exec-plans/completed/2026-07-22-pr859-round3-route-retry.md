# PR 859 ReviewGPT round 3 route retry remediation

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Keep the automatic meal closeout provider-entry route check scoped to the
  stable managed closeout automation id.
- When that check rejects a stale queued target before provider work, preserve
  the existing pending closeout occurrence so the ordinary cron retry resolves
  the current private route and creates a fresh intent.

## Accepted findings

- A terminal stale-route outbox failure currently consumes the closeout's
  pending occurrence, permanently losing that day's summary after photo
  analysis and cleanup.
- The provider-entry check currently applies to every direct Telegram
  automation carrying canonical automation authority, changing unrelated
  reminder behavior outside this feature.

## Constraints

- Reuse the current cron pending-occurrence and backoff owner; add no queue,
  scheduler, route snapshot, reconciliation loop, migration, or repair state.
- Keep the stale intent terminal and make zero provider calls to its old
  target.
- Preserve ordinary terminal-failure semantics for every unrelated
  automation.

## Tasks

1. Narrow the Telegram provider-entry check to the automatic meal closeout id.
2. Classify only that closeout's typed stale-route failure as non-consuming in
   cron delivery reconciliation.
3. Add production-path outbox/cron retry proof and unrelated-automation scope
   proof, while retaining all four stale Telegram transport checks.
4. Update the authority/reliability disclosure, run focused and canonical
   verification, commit and push the correction head, then run ReviewGPT round
   4 concurrently with CI.

## Verification

- Focused assistant-engine cron runtime: 141 passed.
- Focused assistant-runtime hosted callbacks: 202 passed.
- Assistant-engine and assistant-runtime typechecks passed.
- Canonical diff verification passed architecture guards, affected
  typechecks, package boundaries, assistant-engine (2,606 passed),
  assistant-runtime (1,796 passed, 2 skipped), assistant-cli (128 passed),
  assistantd (40 passed), CLI (1,081 passed, 1 skipped), setup CLI (124
  passed), Cloudflare Node (1,858 passed), Cloudflare Workers (1 passed), and
  app verification.
- Full acceptance verification passed, including all package coverage,
  package boundaries, Web (6,140 passed, 153 skipped), Cloudflare Node (1,858
  passed), Cloudflare Workers (1 passed), production build, lint, and smoke
  checks.
Completed: 2026-07-22
