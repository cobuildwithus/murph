# Stop staleness-only wearable outreach

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Keep Murph silent when a connected wearable is merely quiet, while preserving
  recovery help for an explicit provider-authentication failure.
- Remove both independent staleness-only paths that can produce duplicate or
  contradictory proactive messages during the same weekly window.

## Success criteria

- A healthy connected source with old `last_data_at` cannot enqueue a direct
  delivery-stall notification.
- The weekly health digest treats missing or stale wearable data as a reason to
  suppress claims, not as authority to ask the member to reconnect.
- An account or source that explicitly reports reauthorization-required state
  can still receive the existing verified reconnect flow.
- Existing queued digest occurrences and retired direct-notification intents
  reconcile safely without introducing another queue, state owner, or migration.
- Focused owner tests, typechecks, diff verification, and the Product UX
  walkthrough pass.

## Scope

- In scope: the Garmin delivery-stall notification added on 2026-08-23, its
  mailbox/provider-entry support, the weekly digest reconnect policy, tests,
  compatibility documentation, and the associated changelog entry.
- Out of scope: provider ingestion, source-health observability, explicit
  reconnect-required handling, and historical source-data repair.

## Constraints

- Technical constraints: preserve source-staleness health evaluation for
  operators; remove only the member-facing authority derived from elapsed time.
- Product/process constraints: silence is the default for ambiguous source
  intent; keep private production evidence out of repository artifacts; follow
  the iMessage reciprocity and exact-message ownership rules.

## Risks and mitigations

1. Risk: removing the notification could hide a real Garmin delivery outage.
   Mitigation: retain operational source-staleness evaluation and explicit
   reconnect-required states; only delete unsolicited member outreach based on
   elapsed time.
2. Risk: the weekly prompt could still interpret stale data as a reconnect
   problem.
   Mitigation: make the negative policy explicit and assert it in both managed
   automation test suites.
3. Risk: queued legacy notifications could survive the code change.
   Mitigation: keep collection as a pure suppression fence, advance an exact
   model-free mailbox item without delivery, and let the existing workspace
   runner be the only outbox terminalization owner on an assistant-delivery
   wake. The runner marks the phase progressed so the ordinary checkpoint
   persists the terminal state; the producer, materializer, copy, and
   provider-entry path remain deleted.
4. Risk: an already-due weekly digest could retain the retired reconnect prompt.
   Mitigation: patch only the exact retired managed seed while preserving its
   one-shot schedule and occurrence context.

## Tasks

1. [x] Reverse the member-facing delivery-stall feature while retaining
   operator source-health detection.
2. [x] Narrow the weekly digest reconnect branch to explicit auth/source
   recovery state and codify that staleness alone suppresses outreach.
3. [x] Run focused package and Web verification plus the Product UX
   walkthrough.
4. [x] Reconcile the branch with current `main`, independently triage the first
   ReviewGPT findings, and implement the accepted owner-boundary corrections.
5. [x] Relocate retired-outbox cleanup to one checkpoint-owning boundary and
   prove pending, retryable, and sending states survive checkpoint restoration
   without provider or model entry.
6. [x] Commit the corrected candidate, push it, and complete final ReviewGPT and
   CI on the exact head.

## Decisions

- Production evidence showed an active connection with no connection or source
  error. One message came from the new 72-hour delivery-stall notification; the
  later reconnect card came from the Monday weekly-digest policy. The failure is
  messaging authority, not provider ingestion.
- A freshness timestamp cannot distinguish an outage from intentional sparse
  wear, so elapsed time is not sufficient authority for direct outreach.
- Product UX Walkthrough: Ready. An intentionally or occasionally worn but
  healthy source now ends silently at both entry points; an explicit
  reauthorization-required state still reaches the existing verified connect
  link; an already-queued retired event terminates before assistant and
  provider entry. No new UI, consent step, or member action was added.
- Review findings were accepted where they exposed shipped durable state: an
  exact retired queued digest seed is now reconciled in place, and retired
  mailbox/outbox delivery state is reconciled through existing owners.
  No new durable state, lifecycle, queue, or background reconciliation pass was
  added. The optional specialist coverage artifact was not applied because the
  equivalent smaller identity-mismatch proof was restored directly.
- The final durability review exposed that collector-owned mutation could be
  discarded when an otherwise idle phase produced no checkpoint. Collection is
  now read-only; the workspace runner is the sole production caller of retired
  outbox terminalization, only on an assistant-delivery wake and only after a
  successful phase result, where it can force the existing checkpoint.
- The independently requested specialist-continuation policy is isolated in a
  docs-only pull request. The product candidate carries no completion-workflow
  behavior or contract changes.

## Verification

- Commands to run: focused device-syncd, hosted-execution, assistant-runtime,
  assistant-engine, and Web tests; relevant package/Web typechecks; repository
  diff checks and the standard diff-targeted verification command.
- Expected outcomes: no delivery-stall producer or copy remains; the legacy
  identity exists only as a terminal no-send tombstone; stale sources remain
  observable but non-message-producing; explicit auth recovery remains
  documented in the weekly prompt; all checks pass.
- Passed: frozen dependency installation; focused Assistant Engine (100),
  Assistant Runtime (61), hosted-execution (2), device-syncd (7), hosted Web
  (150), and changelog (45) tests; typechecks for all five affected owners;
  `git diff --check`.
- Direct scenario proof: the imported legacy-event test records zero delivery
  intents, never calls assistant execution, advances the mailbox item, and
  leaves no pending item. Prompt readback proves staleness alone requires
  suppression while explicit auth failure retains the connect action.
- Corrected-head focused proof: managed automations (56), retired mailbox
  notification state (62), durable callback retirement (1), restored exact
  notification integration (13), and hosted model-free admission (2) pass.
  Assistant Engine, Assistant Runtime, and hosted-execution typechecks pass.
- Durability-retrospective proof: all 358 hosted workspace entrypoint tests
  pass. The pending, retryable, and sending legacy-outbox cases each follow
  restore -> ordinary assistant-delivery wake -> checkpoint -> restore, reach a
  terminal state, and make zero provider or Codex-process calls. The callback
  collector remains read-only and filters the retired namespace. Another 457
  callback, runner, system-mailbox, and model-free notification tests pass, as
  does the Assistant Runtime typecheck.
- Current-main reconciliation proof: the combined Assistant Runtime owner suite
  passes all 815 tests. Managed automation (101), hosted Web (188),
  device-syncd (7), and hosted-execution (2) focused tests pass, together with
  typechecks for Assistant Engine, Assistant Runtime, device-syncd,
  hosted-execution, and hosted Web.
- Final ReviewGPT substantive round 3 passed its full sensitive audit on the
  exact pushed head with no qualifying findings. It validated the retrospective
  lineage, single checkpoint owner, restore-to-restore proof, model/provider
  exclusion, exact digest reconciliation, and split workflow-policy scope.
- The production-shaped real-Codex test is committed for both stale-only silence
  and explicit reauthorization with exactly one returned connect URL. Its local
  live run is credential-blocked because neither supported provider credential
  is configured; the same file compiles and its deterministic owner proofs pass.
Completed: 2026-08-24
