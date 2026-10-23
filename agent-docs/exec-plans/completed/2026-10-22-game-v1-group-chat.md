# Game v1 group chat cancellation and tools

## Outcome and protected invariants

Cancelling an app change that was queued or sent announces that cancellation once to the same two-player room. It never changes agreed rules or cancels the challenge. Pending/failed unsent and chat-origin changes do not create backend announcements. Current audience and route authority remain required through dispatch; negotiating games are supported.

## Owner and cause

The canonical cancel transaction cleared the proposal and wrote history but reserved no lifecycle receipt. Existing receipt, minute drain, generated notification, bootstrap and outbox owners already provide durable delivery. Extend those owners; no queue, migration or health data is needed.

## Product UX — Ready

- Entry: proposer cancels in the app after the change entered chat delivery.
- Reaches: both players in the proven shared room, including negotiating games. No duplicate backend message for chat-origin proposals.
- Message: brief historical cancellation, no false challenge cancellation, acceptance, restart or current-state claim. A later request must not be described as cancelled.
- Tools: support 3–365 days and prize/dare stakes; tasks and stakes lock at kickoff. Photo guidance follows the returned check-in kind.
- Recovery: cancellation history and reservation commit together. Replay retains one identity; bootstrap metadata is queued before provider effects, including failed route attachment.

## Implementation and rollout

Reuse lifecycle reservations in the cancel transaction with a cancellation-specific template and per-proposal identity. Drain and dispatch through existing generated notifications. Preserve exact-player authorization and canonical cancellation-history checks.

Integrated merged PR 2 (`1a822eb0d486383d93f13c761ea2d24c4b8402b8`). PR 1 runtime floor is deployed with immediate rollout and proven convergence in protected run 39891959839. Cancellation uses existing generic notification/bootstrap wire shapes; the deployed runtime passes event IDs and instructions through without a new parser. Web owns reservation and dispatch authority. Verify Web after merge, then deploy and converge runtime tool text with immediate warm-runtime refresh. Retain the additive reader floor; no rollback is authorized.

## Review and verification

- Parent candidate review: scoped cancellation behavior, ordinary kickoff/proposal success paths, privacy, exact audience, bounded database work and deployment skew reviewed. Source overlap with rules is only the narrow reservation branch.
- Requested Astra deep review completed. Accepted bootstrap queued-status ordering and stale current-state copy findings; fixed at existing owners. Bootstrap attachment-failure regressions and historical instructions prove the fixes. No extra state owner added.
- All 301 non-PostgreSQL Web game tests pass. All 68 PostgreSQL game tests pass on an isolated loopback database with PR 2 migration, including 13 cancellation eligibility/concurrent replay/forced-rollback scenarios.
- Bootstrap regression suite: 28 pass. Runtime compatibility/notification tests: 21 pass. Assistant game tools: 16 pass.
- Web and package typechecks, Web lint, complexity, logs guard and docs drift pass. No new complexity hotspot; the export module's unrelated timing helper remains 25.
- Three real-Codex journeys pass: one queued cancellation message, live stake refusal with one read and no mutation, and 75-day/count read. Revised cancellation journey rerun passed after the review fix. Default and first alternate subscription homes failed before model action with routing 401; the next documented alternate succeeded.
- Full provider input: individual 155921 -> 155921 bytes; group 144355 -> 143888 bytes (-467, -0.3235%). Complete first provider request captured with identical fixtures and retained pre-v1 game descriptors; only nondeterministic cache key excluded. Exact target tokenizer unavailable; no token count claimed.
- Content-only changelog fragment `challenge-change-cancellation`: generation and four archive rendering tests pass. Existing production archive presentation reused.

## Completion

Implementation and focused proof complete for PR #4326. Plan closed before final external gates; ReviewGPT, exact-head CI, merge and production convergence remain tracked on the PR and shared lane status. Those gates are not represented as passed here.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
