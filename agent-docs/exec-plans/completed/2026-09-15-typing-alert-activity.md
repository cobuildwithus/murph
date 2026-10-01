# Fix typing alert activity and telemetry persistence

Status: completed
Created: 2026-09-15
Updated: 2026-09-15

## Goal

Keep operational typing alerts focused on silent conversations and preserve
provider-accepted typing evidence through concurrent diagnostic callbacks.

## Scope and decisions

- Reuse the Linq provider-event and delivery ledgers for blinded exact-chat matching.
- Suppress a typing alert when a message was accepted in that chat during its
  observation window, or an earlier accepted typing session covered arrival.
- Keep the five-minute typing session bound, other-chat isolation, warm/cold
  thresholds, usage-denial exclusion, and immutable alert identity.
- Accepted-typing SQL waits for the existing short row lock; other milestones
  retain skip-locked behavior. Diagnostic callbacks remain outside the reply path.
- Retry transport exceptions within the existing finite milestone retry budget;
  report exhausted acceptance writes with content-free metadata.
- No new persistence, protocol, scheduler, provider calls, or production mutations.

## Product UX

Outcome: operators receive silence alerts without false alarms for active Linq chats.
Reaches: same-chat overlap and accepted sends; silent, unknown-route, expired-typing,
and different-chat cases keep alerting. Telegram thresholds are unchanged.
Proof: PostgreSQL alert query cases, concurrent accepted-typing writes, and runtime
retry tests. This changes operational diagnostics, not model input or member replies.

## Tasks

1. Implement exact-chat activity exclusion and accepted-typing write recovery.
2. Prove alert boundaries, locking, transport retry, and exhaustion diagnostics.
3. Run focused tests, typechecks, complexity review, and document the owner contract.
4. Open a PR, run final ReviewGPT alongside CI, and report the result.

## Verification

- Runtime channel activity suite: 27 passing, including transport and late-staging
  recovery, immutable acceptance timestamps, detached callbacks, and bounded
  content-free exhaustion reporting.
- PostgreSQL alert and concurrency suites: 13 passing against an isolated local
  database on the current schema. Includes a held-row-lock acceptance proof,
  exact-chat activity exclusions, negative cases, and the existing 1,005-row burst.
- Web latency store and alert cron suites: 44 passing.
- Web and assistant-runtime typechecks: passing.
- Focused Web ESLint and `git diff --check`: passing.
- `pnpm complexity:diff`: passing; the pre-existing dashboard complexity hotspot
  is unchanged. New alert filtering stays in one SQL predicate using existing indexes.
- Parent candidate review: Ready. No public changelog or real-Codex journey is
  applicable because this changes operator diagnostics without changing prompts,
  tools, provider inputs, or member replies.

## Completion handoff

Implementation and focused proof are complete. The owning session will open the
PR and run required ReviewGPT concurrently with exact-head CI. Their results
belong to PR evidence; this plan does not claim those pending gates have passed.
No merge or deployment is part of this task.
Completed: 2026-09-15
