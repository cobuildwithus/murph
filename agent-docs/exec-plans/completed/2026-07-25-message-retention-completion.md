# Complete 14-day inbound message retention

Status: completed
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Remove inbound-message verbatim content from every in-scope durable,
  searchable, and assistant-readable carrier after the receipt-anchored
  14-day window, while retaining structural conversation facts, distilled
  canonical memory, and restart-safe terminal handling for accepted work.

## Success criteria

- A reviewed carrier inventory names the retention behavior for the hosted
  mailbox, v1/v2 inbox captures and envelopes, SQLite projection/FTS rows,
  parser derivatives, assistant inputs/transcripts, and hosted mailbox
  quotations.
- One existing hosted idle-maintenance owner derives the earliest retention
  deadline for both capture-backed and captureless content and schedules a
  wake without unrelated member activity.
- Retention never deletes or hides an unconsumed conversational obligation
  without a durable terminal disposition owned by the existing accepted-work
  path.
- Partial cleanup is retry-safe: no canonical marker can prevent a later pass
  from clearing an in-scope snapshot-carried copy after a transient failure.
- Receipt time, not projection time, anchors expiry; protected work is
  re-evaluated at a bounded existing wake.
- Focused production-path regressions, the canonical repository acceptance
  command, required audits, final ReviewGPT, and PR CI all pass on the final
  pushed head.

## Scope

- In scope:
  - `HostedMailboxItem` live-read and cleanup retention behavior.
  - Inbox capture/envelope canonical records and raw content files.
  - Inbox SQLite projection, attachment text, and FTS state.
  - Capture-owned parser text derivatives.
  - Assistant input and transcript content plus their hosted snapshot wake.
  - Existing retention scheduling, retry, and checkpoint integration.
  - Current architecture, security, reliability, and verification docs.
- Out of scope:
  - Distilled canonical memory, promoted health/events, and ordinary durable
    captures intentionally created from a message.
  - Provider-side retention and unrelated stores not carrying inbound message
    bodies.
  - New retention services, queues, lifecycle tables, or reconciliation loops.

## Carrier inventory

| Carrier | Deadline behavior |
| --- | --- |
| Hosted mailbox inline/sidecar ciphertext | Clear payload fields and delete the sidecar in place; an unconsumed conversation becomes a durable policy non-reply without crossing a younger lane gap. |
| Inbox capture v2 | Clear inline/out-of-line text and provider raw content, stamp `textRetiredAt`, and preserve structural metadata. |
| Legacy inbox capture/envelope | Run the existing equivalence migration first, then redact the paired v1/v2 ledger copies; leave an unpaired legacy record visible and retry migration. |
| Inbox SQLite, attachment text, and FTS | Clear text/raw/derived-path projections before the canonical retention marker commits, then rebuild the search row. |
| Capture-owned parser bundles | Delete the owning `derived/inbox/<captureId>` files atomically with the canonical capture rewrite. |
| Assistant input events | Scan pending and already-terminal events; suppress unresolved accepted work first, then clear message, transcript, quote, inline-fragment, raw, and derived content while preserving routing structure. |
| Assistant user transcript entries | Persist the original receipt separately from transcript creation, redact at that inclusive deadline, and schedule the earliest captureless wake. |
| Hosted mailbox quotations | Retire with the encrypted mailbox payload; decoded Telegram quote context is cleared from the assistant input event, and the Linq group-reaction quote is cleared from its assistant-input sidecar before the event is stamped retired. Any transcript copy follows the same receipt deadline. |

## Constraints

- Technical constraints:
  - Reuse current owners and one existing retention wake pointer.
  - Keep canonical shard rewrites and owned-file deletion atomic.
  - Keep the foreground reply path free of retention work.
  - Preserve optional/additive persisted-shape compatibility and existing
    mailbox causal ordering.
- Product/process constraints:
  - The 14-day guarantee must be truthful across every declared carrier.
  - Accepted work must not become unexplained silence.
  - Redaction is irreversible, so deploy-skew and rollback behavior must be
    explicit.
  - Continue PR #936's immutable ReviewGPT baseline and retrospective rather
    than resetting the review history.

## Risks and mitigations

1. Risk: A privacy deadline silently erases accepted but unhandled work.
   Mitigation: route expiry through the existing terminal-disposition owner or
   retain the obligation without retaining its private payload.
2. Risk: Carrier-by-carrier patches leave a hidden verbatim copy or a
   non-retryable partial state.
   Mitigation: complete the inventory first, select one completion boundary,
   and test transient failure after each durable step.
3. Risk: A new scheduler or state owner makes retention less reliable.
   Mitigation: derive the earliest deadline through existing idle maintenance
   and reuse its current wake/backoff state.
4. Risk: Web and runner deploy out of order around irreversible deletion.
   Mitigation: preserve additive readers, state the safe deploy order, and
   prove warm-old-runner behavior before handoff.

## Tasks

1. Reconcile the branch with current `main`, inspect the current patch and all
   ReviewGPT findings, and trace every message-content carrier and owner.
2. Write the smallest owner-level design for mailbox terminality, captureless
   deadline scheduling, complete carrier cleanup, and retry-safe completion.
3. Add failing production-path regressions for the two unresolved ReviewGPT
   mechanisms and any inventory gap still present at the current head.
4. Implement the correction through existing owners, deleting or consolidating
   superseded carrier-specific machinery where possible.
5. Update durable owner docs and the PR intent/deployment contract to match the
   final behavior and carrier inventory.
6. Run focused checks and direct scenario proof, then
   `pnpm verify:acceptance`.
7. Run the required local product-experience review, parent final review, and
   exact-head completion workflow.
8. Close the plan with `scripts/finish-task`, push, run the next final
   ReviewGPT correction round concurrently with CI, resolve findings, and prove
   a clean merge with current `main`.

## Decisions

- Continue the original complete 14-day retention outcome rather than narrowing
  the PR to a partial guarantee.
- Treat the round-2 `RETROSPECTIVE_REQUIRED` result as the governing redesign
  checkpoint; do not add another isolated carrier patch.
- Accept all three preliminary specialist coverage findings. The returned
  artifact touched tests/direct-proof scaffolding only and passed full hunk
  inspection plus `git apply --check`; retain terminal conversation IDs in the
  checkpoint until the server acknowledgement floor advances while asserting
  that background selection treats their durable suppression as non-runnable.
- Re-baseline the hosted runner's entry, static-closure, and total byte guards
  to the measured retention-capable graph. Keep the existing small-growth
  tolerances and all forbidden-subsystem markers unchanged.

## Verification

- Completed proof:
  - Assistant Engine: 174 files passed, 1 skipped; 2,675 tests passed,
    5 skipped.
  - Assistant Runtime: 76 files passed; 1,872 tests passed, 2 skipped.
  - Inbox: 24 files passed; 220 tests passed, 3 skipped.
  - Focused Web retention owners: 134 tests passed.
  - Preliminary `completion-specialists` ReviewGPT: prompt and frontend lenses
    not applicable; three medium coverage findings accepted and resolved.
  - Specialist focused proof: Assistant Engine input replay 40 tests passed;
    Assistant Runtime selection/wake integration 58 tests passed; Web migration
    inventory 5 tests passed.
  - Isolated local-Postgres migration and Assistant Ask retention proof:
    3 tests passed after all 123 migrations applied, including real snapshot
    re-arming and sidecar deletion.
  - Exact hosted-local runner assembly passed with entry 1,659,721 bytes,
    static boot closure 7,896,210 bytes, and total output 9,619,301 bytes inside
    the reviewed guards.
  - Cloudflare's corrected bundle-budget assertion passed in its focused
    34-test file and in the canonical 44-file, 761-test app suite.
  - Scenario-manifest integrity: 204 scenarios, 11 sample inputs, and 28
    golden-output directories passed.
  - Production-path checkpoint/restore regression proves the retained unique
    phrase is absent from inbox search, capture raw/text, parser output,
    assistant input, transcript, and later-turn source after a second restore.
  - Canonical `pnpm test:diff` passed every affected typecheck plus Contracts,
    Assistant Engine, Assistant CLI, and Assistant Runtime before stopping on
    an unrelated current-`main` CLI audit mismatch: its unchanged test expects
    wording no longer present in the unchanged ReviewGPT prompt.
  - Parent final review found no remaining retention bug, competing lifecycle
    owner, foreground-turn cleanup, terminality gap, or cutoff/read mismatch.
  - Canonical `pnpm verify:acceptance` passed all 31 workspace typechecks,
    repository guards, Web's 514-file/6,551-test suite, Assistant Engine,
    Assistant Runtime, Inbox, Cloudflare, and every non-CLI package. It exited
    only for the same current-`main` CLI audit mismatch; both the failing test
    and ReviewGPT prompt are unchanged from `origin/main`.
- Remaining completion gates:
  - `scripts/finish-task`, final pushed-head ReviewGPT round 3, CI, and
    clean-merge proof.
- Expected final outcomes:
  - No in-scope unique phrase survives in a durable carrier after the scheduled
    retention pass and restore.
  - Structural facts and distilled canonical records remain.
  - Unconsumed accepted work has an explicit restart-safe terminal outcome.
  - Required audits, ReviewGPT, PR CI, and merge-conflict proof are green.
Completed: 2026-07-25
