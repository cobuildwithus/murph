# Stop staleness-only wearable outreach

Status: active
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
- Preliminary specialist findings can be dispositioned and fixed in the active
  turn; final cross-cutting findings retain their mutation pause.
- Focused owner tests, typechecks, diff verification, and the Product UX
  walkthrough pass.

## Scope

- In scope: the Garmin delivery-stall notification added on 2026-08-23, its
  mailbox/provider-entry support, the weekly digest reconnect policy, tests,
  compatibility documentation, the associated changelog entry, and the
  completion-workflow specialist continuation rule.
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
   Mitigation: retain only the old namespace as model-free drain authority and
   terminate matching mailbox and outbox state at their existing durable owners
   before assistant or provider entry; remove the producer, source materializer,
   copy, and provider-entry path.
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
5. [x] Update the completion workflow so preliminary specialist remediation can
   continue after the parent disposition update while final findings still pause.
6. [ ] Commit the corrected candidate, push it, and complete final ReviewGPT and
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
  mailbox/outbox delivery state is terminalized through existing owners.
  No new durable state, lifecycle, queue, or background reconciliation pass was
  added. The optional specialist coverage artifact was not applied because the
  equivalent smaller identity-mismatch proof was restored directly.

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
  notification integration (13), hosted model-free admission (2), and workflow
  documentation contracts (46) pass. Assistant Engine, Assistant Runtime,
  hosted-execution, and CLI typechecks pass.
- The production-shaped real-Codex test is committed for both stale-only silence
  and explicit reauthorization with exactly one returned connect URL. Its local
  live run is credential-blocked because neither supported provider credential
  is configured; the same file compiles and its deterministic owner proofs pass.
