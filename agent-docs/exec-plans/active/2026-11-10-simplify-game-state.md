# Simplify game delivery timing and row dependencies

Status: active
Created: 2026-11-10
Updated: 2026-11-10

## Outcome

App proposals, Talk notes and rematches return accepted state before optional
chat delivery. One existing Next `after` callback runs delivery; the existing
minute sweep recovers interrupted work. Non-request callers still await the
same delivery task. Pure row conversion now lives below the command service,
removing Talk and reminder back-imports without adding a repository layer.

## Architecture and product plan

- The game transaction remains the agreement and authorization owner.
- Existing delivery receipts commit before post-response work starts. No new
  state, queues, dependencies, retries, database calls or configuration.
- Private reminder activation remains awaited to preserve its preference order.
- Stored proposals, historical events, cancellation policy and provider fencing
  remain unchanged; prior readers and writers retain the same storage shape.
- Proof uses synthetic local PostgreSQL fixtures and a local-subscription Codex
  journey, with synthetic delivery ports and no member-facing messages.

## Disposition of every audit finding

1. **Duplicated delivery progress: retain after disproving full derivation.**
   `game.pending_change` records whether the request was published. A terminal
   receipt can lose `generation_queued`; mailbox tombstones can be pruned after
   30 days (`hosted-retention/cleanup.ts`), while games can last 365 days.
   Cancellation still needs that durable publication fact. Adding another
   marker to delete this one would not simplify the architecture. Existing
   failed-attempt hints and stored-format compatibility remain; provider terminal
   progress already overlays them on reads. The proposed extra cancellation
   queries and speculative reader/writer rollout were discarded.
2. **Synchronous optional delivery: implemented.** Two delivery helpers become
   one post-response task using the existing recovery owner. Saving the accepted
   request no longer waits for optional chat routing or delivery.
3. **Legacy rule retirement: retain historical interpretation.** A bounded,
   read-only structural check confirmed that settled game history still uses
   older stake/check-in semantics. No private rows or identifiers were copied.
   Removing only new writers would not justify changing historical results.
4. **Read/conversion cycles: implemented at the demonstrated seam.** Existing
   database-to-rule functions move to `game/row.ts`; Talk and reminder readers
   import them directly. Broader service/repository decomposition was rejected
   as more machinery without a proven requirement.
5. **Declined-history removal: rejected to preserve required behavior.** PR 4370
   deliberately allowed a later identical, word-free request from the decliner
   to apply as agreement. Different requests still create a fresh proposal;
   task/stake text requires fresh consent. Existing PostgreSQL cases protect
   these paths, and a focused live journey checks truthful acknowledgement
   without asking the original proposer again. The history is required consent
   evidence, not an obsolete state machine.

## Risks and proof

- Request completion may interrupt optional delivery. The committed receipt and
  existing sweep retain the accepted work; neither authority nor retry policy
  moved to the callback.
- The delayed-delivery regression asserts accepted state before callback work,
  exactly one delivery attempt, retained proposal and recoverable receipt after
  failure. Existing tests cover replay, chat-only suppression, re-requests,
  group votes, reminder settings and invite negotiation.
- Pure conversion is an exact move, with no data interpretation changes.
- No database migration or deploy ordering is needed; callback timing is local
  to each Web request and stored protocol formats are unchanged.

## Verification

- Focused unit/PostgreSQL run: 5 files, 301 tests passed against an isolated
  synthetic test database.
- Web typecheck and assistant-engine typecheck passed.
- Complexity diff against the branch base passed: zero new debt/hotspots;
  nine function bodies recognized as exact moves.
- Talk production-path suite: 1 file, 11 tests passed.
- Focused real Codex journey: pending supported patched binary. Initial command
  stopped before provider action because the default binary lacks the native
  patch. Existing Frog `20261026172108-local-live-runner` owns this friction;
  the assistant execution workstream owns the supported binary build.
- Final privacy/diff review, release note, scoped commit and draft PR: pending.

## Completion ownership

The parent session owns final candidate review, ReviewGPT, readiness, merge and
deployment. This workstream prepares the scoped draft PR and reports all retained
requirements. No production mutation or member messaging is authorized here.
