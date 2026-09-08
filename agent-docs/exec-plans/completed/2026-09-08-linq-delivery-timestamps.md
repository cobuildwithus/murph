# Preserve first Linq delivery timestamps

Status: completed
Created: 2026-09-08

## Outcome and invariant

A repeated delivery event for the same provider message must not inflate its
reported reply latency. First-delivery timing and latest terminal-receipt
ordering are distinct facts. Preserve current retry, failure, group, multipart,
and onboarding behavior without sending or replaying any production message.

## Existing owner and proved cause

The Web Linq provider-event parser and delivery store own the correction.
The parser uses the event envelope time for delivered events, while scalar and
child receipt writers replace `deliveredAt` on every newer delivery event.
Acceptance catch-up also selects the latest receipt. Provider lifecycle time
must remain separate from event-ordering time. Multipart completion must still
wait for every required part and use the latest first-delivery time of those
parts. Replaced-original receipts must not contaminate the active replacement.

## Scope and design

- Reuse existing delivery/event records and receipt writers. Prefer atomic
  timestamp refinement and bounded derivation over a new state owner.
- Keep transactions database-only and work bounded by the existing message cap.
- No provider calls, retries, backfill, schema expansion unless independently
  justified, production repair, deployment, or merge in this task.
- Preserve the separate receipt/acceptance concurrency task. Its worktree is
  clean and has no competing implementation; do not resume or modify it.
- ReviewGPT owns substantive implementation under the production-sweep rule.
  Parent owns applying, reviewing, testing, PR completion, and handoff.

## Proof

- Parser: current and legacy delivery lifecycle fields; missing/invalid fallback.
- Store: later duplicate and earlier out-of-order receipts, latest failure/status
  ordering, no repeated terminal effects, and receipt-before-acceptance catch-up.
- Both scalar and child-message paths; multipart completion; original/replacement
  identity fencing. Use real local PostgreSQL for atomic/concurrent claims.
- Focused Web tests and typecheck, complexity, privacy/diff/docs checks, final
  ReviewGPT and required exact-head CI. No live sends or real-Codex journey is
  needed because this changes receipt bookkeeping, not assistant decisions.

## Product and release

Internal timing correctness only: no assistant text, route, audience, permission,
or send policy changes. Product UX is ready when composed receipt/latency proof
passes. No public changelog is planned for internal observability bookkeeping.
Document supported reader/writer skew and historical-record limitations after
implementation. Do not claim old stored values were repaired without proof.

## Progress

- Diagnosed the existing receipt writer and confirmed the provider's documented
  distinction between event creation and message delivery timestamps.
- Created an isolated task checkout from current fetched main. Existing Frog
  inventory inspected; no new repository friction identified.
- Implementation request prepared for ReviewGPT with only synthetic evidence.
- Current main already includes the shared exact-message receipt lock. Preserve
  it; this fix adds no competing receipt/acceptance serialization mechanism.
- Baseline proof passed: 224 parser/store/latency unit tests, 29 local PostgreSQL
  terminal-retry tests, and full Web typecheck. The isolated test database has
  all 216 existing migrations. Repeat affected proof after applying the patch.
- The latency dashboard currently derives completed reply receipt timing from
  `lastReceiptAt`; its reader must use the corrected delivery completion fact.
- ReviewGPT's implementation was applied after exact attachment checksum
  verification. The new regression tests failed 13 cases against the original
  source, including the inflated latency projection, and pass with the patch.
- Post-patch proof passed: 234 parser/store/latency tests, 44 real PostgreSQL
  tests, 11 terminal-retry unit tests, full Web typecheck, scoped ESLint, privacy,
  log-payload and provider-request guards, docs drift and gardening.
- Parent review confirmed the existing exact-message lock bounds acceptance to
  ten message IDs; catch-up stays on one transaction/connection with sequential
  exact-key work and no external calls. The added aggregate reads one minimum
  from the existing indexed event owner, including legacy missing metadata.
- ReviewGPT's bounded follow-up removed redundant receipt-key and signal checks
  and converts the selected dashboard timestamp once. The actual complexity
  guard now passes without increasing any file's debt or maximum; scalar receipt
  complexity is 19. Existing unrelated hotspots remain outside this fix.
- Final unit proof passes all 245 cases. Maximum-cardinality PostgreSQL proof
  observes actual forwarded SQL for ten children: one exact-key aggregate each,
  peak one active aggregate, and none when no receipt is buffered. All child
  first-delivery times and parent completion are checked, with no provider calls.
- Deployment remains Web-only with the same schema. Old readers ignore the new
  optional sanitized metadata leaf; new readers fall back for old events. Old
  writers can still overwrite timing during a mixed Web rollout. Correct timing
  converges only after all writers are updated and new receipt/catch-up evidence
  is applied. No historical backfill, deployment, or rollback is performed here.

## Candidate review

Parent reviewed the complete production diff and composed tests: latest status
ordering remains separate from monotonically earlier timing, current message
identity is revalidated for writes, existing locks and retry limits remain the
owners, and no new provider or authority operation is introduced. The test-only
query observer forwards raw queries and nested transactions to real PostgreSQL;
it adapts the existing fixture proxy pattern without type assertions.

The changed catch-up boundary has at most 53 ORM/raw operations for ten children
(five per child and three for parent recomputation), versus 33 before, all on
one existing transaction connection. No-receipt acceptance adds no timing query.
Initial provider input is unchanged for individual and group runtimes. Public
changelog and rendered UI proof do not apply to this internal bookkeeping fix.
Final exact-head ReviewGPT and CI are recorded on the PR; merge and deployment
remain outside this task.

Final local candidate proof: 245 unit tests and 44 real PostgreSQL tests passed,
including the observed ten-part case. Web typecheck, scoped lint, complexity,
privacy/log/provider guards, documentation checks and whitespace checks passed.
No new repository-actionable Frog entry was necessary. The implementation and
local verification are complete; external PR gates remain pending at closure.
Updated: 2026-09-08
Completed: 2026-09-08
