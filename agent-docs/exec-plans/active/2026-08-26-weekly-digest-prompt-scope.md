# Remove weekly digest prompt override

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make scheduled automations classified as `weekly_digest` follow their saved
  instructions without an engine-supplied digest override, while preserving
  compatibility with existing records and experiment consent checks.

## Product UX

- Outcome: A scheduled readout says what the member asked that automation to
  say, even when weekly-digest consent metadata is present.
- Reaches: Existing scheduled private and group automation deliveries.
- Proof: A production-derived synthetic daily-readout journey delivers a daily
  readout and contains no weekly-recap framing.

## Success criteria

- `weekly_digest` adds no support-scope instructions to the provider prompt.
- `reminder`, `check_in`, and `review` retain their existing scoped guidance.
- Existing `weekly_digest` records remain readable and retain their current
  plan-owner consent precondition.
- Deterministic composition coverage and one focused real-Codex journey pass.

## Scope

- In scope: scheduled-assistant prompt composition, focused deterministic and
  live-journey coverage, and member-visible changelog classification.
- Out of scope: removing the persisted enum value, migrating vault records,
  changing `supportSeriesId`, or redesigning the other support kinds.

## Constraints

- Technical constraints: preserve old-reader/new-reader compatibility and
  existing experiment authorization checks; avoid a new state owner or parser
  compatibility shim.
- Product/process constraints: use synthetic private-free fixtures and keep
  normal system safety, routing, delivery, and lifecycle instructions intact.

## Risks and mitigations

1. Risk: A legitimate weekly summary could expand beyond its saved purpose
   after losing the injected digest wording.
   Mitigation: Preserve the self-contained saved instructions as task authority
   and all existing weekly-digest consent checks; do not introduce a second,
   engine-authored version of that task.
2. Risk: Removing the enum outright would make existing automation records
   unreadable or bypass consent checks.
   Mitigation: Keep `weekly_digest` as typed consent metadata in this patch;
   remove only its provider-prompt behavior.

## Tasks

1. [x] Change support-scope composition so `weekly_digest` produces no overlay.
2. [x] Add focused regression coverage for the composed provider instructions.
3. [x] Run the production-derived synthetic real-Codex journey. The default
   subscription returned `ASSISTANT_CODEX_USAGE_LIMIT` before provider entry;
   the explicitly authorized alternate-home retry passed with the target model.
4. [ ] Complete the repository PR/review workflow after the live journey is
   `Ready`. The preliminary specialist pass returned two findings; parent
   dispositions and the accepted coverage remediation are recorded below. Two
   Ready-event attempts reached the host-support production-bundle job but
   failed its pre-build revision assertion when the mutable pull-request merge
   ref advanced beyond the event's base revision; the patch was not built by
   that job. The reproducible repository friction is recorded in Frog.

## Decisions

- Treat `weekly_digest` as typed consent and lifecycle metadata only; it must not
  change the provider-visible task instructions.
- Preserve the other three support-scope overlays in this patch.

## Preliminary specialist dispositions

1. Rejected restoring the weekly-digest prompt overlay. The member explicitly
   selected the architecture in which saved automation instructions own the
   task. `supportKind` selects the existing consent and lifecycle checks; it is
   not an independent task author because Murph persists both fields in the
   same operation. Restoring the overlay would reintroduce the observed prompt
   contradiction. The contracts comment now states this ownership boundary.
2. Accepted the live-proof finding. The first journey hand-assembled the saved
   task after deterministic composition and therefore could not itself fail on
   a cron-composer regression. The corrected journey persists a canonical
   automation, projects its real cron job, calls the exported production
   execution-instruction composer, asserts the conflicting overlay is absent,
   and sends that composed prompt to the real target model.

## Verification

- Passed: focused Assistant Engine Vitest composition regression (one test).
- Passed: focused Assistant Engine preservation coverage for `reminder`,
  `check_in`, and `review` (three tests).
- Passed: Assistant Engine package typecheck.
- Passed: focused changelog archive coverage (nine tests) and Web typecheck.
- Passed: the focused real-Codex journey through the authorized alternate local
  subscription produced one current-day readout with the exact supplied facts,
  no tool actions, and no weekly or recap framing. After specialist remediation,
  the corrected production-composed journey passed again. UX verdict: Ready.
- Preliminary specialist result: findings. The parent rejected the requested
  prompt-overlay restoration and accepted/remediated the production-composition
  coverage finding; no coverage patch artifact was attached.
- Blocked CI evidence: the host-support production-bundle job failed before
  dependency installation on both the original and refreshed Ready events
  because its mutable candidate first parent differed from the immutable event
  base. Other completed checks remained green; this is separate from the
  product patch and remains a required-CI blocker.
