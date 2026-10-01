# Prove runtime recheck recovery from durable progress

Status: completed
Created: 2026-08-31
Updated: 2026-09-01

## Goal

- Close the existing ops recheck loop so operators can distinguish signal
  acknowledgement from checkpoint progress and actual recovery using existing
  canonical Web-owned facts.

## Success criteria

- Every successful bounded recheck captures and returns a request-time recovery
  witness before sending the signal.
- One authenticated, read-only, maximum-three verification action classifies
  requested, checkpoint advanced, progressing, recovered, or unknown.
- Recovery is tied to the request-time imported prefix; version-only changes,
  signals, logs, or discovery disappearance never prove recovery.
- One unresolved successful batch remains the only tracked browser witness until
  every signaled row is recovered or the operator explicitly discards that
  proof; failed-only batches never block the next bounded request.
- Focused service, route, database-boundary, UI, and design-study tests pass,
  followed by exact-head CI and final ReviewGPT.

## Scope

- In scope: the existing Web runtime-maintenance service, authenticated ops API,
  recheck panel, design representation, focused tests, and matching protocol
  documentation if its response contract changes.
- Out of scope: Temporal or Cloudflare execution, new persisted state, automatic
  polling, schedulers, queues, recovery ownership, and runtime-log authority.

## Constraints

- Reuse existing hosted runtime progress observations and canonical lane
  counters; keep scans and mutations bounded to three workspaces.
- Preserve active-access checks and the current statement that Requested means
  signal accepted only.
- Keep member identifiers inside the existing allowlisted authenticated ops
  response and UI, never aggregate logs or durable evidence.
- Use ReviewGPT for the implementation patch and final exact-head review.

## Risks and mitigations

1. Risk: administrative workspace changes look like runtime progress.
   Mitigation: require both version and checkpoint time for checkpoint proof;
   version alone remains Requested.
2. Risk: newer mailbox work prevents declaring an older prefix recovered.
   Mitigation: compare canonical system-lane consumption with the imported
   frontier captured before the signal.
3. Risk: retention or malformed projections create false recovery.
   Mitigation: classify ambiguity as Unknown unless canonical consumption
   proves the captured head/prefix was consumed.
4. Risk: a later HTTP-successful batch replaces unresolved signed witnesses.
   Mitigation: serialize successful signaled batches in the existing client and
   require explicit proof discard before another batch can replace them.

## Tasks

1. Inventory the existing bounded recheck and progress-observation owners.
2. Ask ReviewGPT for a scoped attachment-based implementation patch.
3. Apply and parent-review the patch, retaining only canonical-fact derivation.
4. Run focused verification, commit, open a draft PR, and complete exact-head CI
   plus final ReviewGPT.
5. Merge only after every required gate is green.

## Decisions

- Verification is manual and presentation-only; no new persisted recovery state
  or background monitor is introduced.
- Runtime logs remain supporting diagnostics and cannot establish non-execution
  or recovery.
- The signed witness keeps only the canonical captured head sequence. The live
  read keeps only the current pending head sequence; sequence allocation is
  monotonic and the existing live-head query owns retention and expiry checks.
- The browser retains at most one successful signaled batch. Automatic unlock
  requires every signaled row to be `Recovered`; an explicit stop-tracking
  action discards that ephemeral proof while preserving IDs still in the queue.

## Product UX plan

- Effort: small Product UX. This extends an internal operator recovery surface
  with one explicit verification action and five evidence-backed outcomes; it
  does not create a new member journey or background behavior.
- Affected people and states:
  - An operator who successfully requests one to three rechecks sees
    `Requested` as acknowledgement only, then can explicitly verify those same
    request-time prefixes.
  - If no durable fact moved, including a version-only change, the operator
    still sees `Requested` and is not told recovery occurred.
  - If the checkpoint or handled frontier moves, the operator sees the narrowest
    truthful intermediate state; once the request-time imported prefix is
    handled, they see `Recovered` even if newer work arrived.
  - If the baseline is malformed, missing, or made ambiguous by retention, the
    operator sees `Unknown` instead of false success and can retry diagnosis.
  - Partial signal or verification failures remain attributable per row, and
    both actions stay capped at three workspaces.
  - A second batch remains disabled while any successful signal is unresolved.
    Failed-only results do not block, full recovery unlocks automatically, and
    the operator has one clearly labeled escape hatch that discards the
    request-time proof without changing the remaining queue.
- System handoff: the authenticated Web action captures the recovery witness
  immediately before signaling Temporal and returns it only with successful
  acknowledgements. A later authenticated manual action submits at most three
  witnesses and rereads the same Web-owned facts to classify progress. Neither
  action delegates recovery state to the browser or runtime logs.
- Direct walkthrough: render and test requested, checkpoint-advanced,
  progressing, recovered, unknown, partial-failure, disabled/loading, and
  maximum-three states with synthetic identifiers; confirm the copy never
  equates signal acceptance with execution.

## Verification

- Focused runtime-maintenance, classifier, route, mounted-client, panel, and
  design-study tests pass (44 tests), including a six-ID, two-batch mounted
  journey and every nonterminal verification outcome.
- The production SQL passes its opt-in PostgreSQL boundary proof against an
  isolated worktree database, including exact retention and expiry boundaries.
- Web typecheck, focused ESLint, docs drift, complexity diff, and diff checks
  pass.
- The first candidate's production study was rendered and inspected at 1440px
  desktop and 390px phone widths. For the corrected candidate, the exact preview
  reached Ready and its authenticated `/screenshots/ops` route returned 200.
  The in-app browser was unavailable, so the serial-gate delta was reviewed
  through the mounted six-ID production-component journey plus static desktop
  and mobile layout inspection; no second rendered screenshot is claimed.
- ReviewGPT round 1 found the replaceable-witness UX gap and redundant mailbox
  head metadata. Both findings are accepted and corrected: one tracked batch
  now serializes requests, and the verifier deletes the duplicate head lookup
  and metadata in favor of the owning monotonic sequence.
- Every required exact-head CI check passed, including the Temporal reader
  compatibility matrix and the release build, app, and package coverage jobs.
- ReviewGPT round 2 performed a full-patch audit of the corrected exact head,
  verified both accepted round-1 remediations, and returned
  `ROUND_OUTCOME: PASS` with no remaining qualifying finding.
Completed: 2026-09-01
