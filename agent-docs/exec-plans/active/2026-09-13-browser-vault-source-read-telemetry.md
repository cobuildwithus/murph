# Distinguish slow Browser Vault source-read stages

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Distinguish which existing Browser Vault source-read operation consumes the
refresh deadline, using the existing bounded runtime diagnostic event. Preserve
refresh results, foreground priority, cancellation, and publication authority.

## Success criteria

- Synthetic delays in different source-read operations produce distinct safe
  diagnostic labels without changing results or adding side effects.
- Focused query/runtime proof, affected typechecks, parent review, final
  ReviewGPT, and required exact-head CI pass.

## Scope

- In scope: optional typed observation at the public query source boundary,
  existing runtime timeout telemetry, focused tests, and the diagnostic owner doc.
- Out of scope: timeout/retry changes, performance fixes without cause proof,
  provider work, product state, deployment configuration, and new monitoring.

## Constraints

- Keep the public query dependency acyclic and preserve existing operation order.
  No extra I/O, awaits, provider calls, file names, identifiers, or content in logs.
- ReviewGPT implements source and tests; parent inspects and verifies the patch.
  Production remains read-only except the user's gated telemetry-only rollout.

## Risks and mitigations

1. Delayed timers could blame the operation after a long synchronous step.
   Preserve existing yields and make timing attribution explicit in focused proof.
2. Diagnostic changes could affect refresh behavior or expand log volume.
   Reuse the existing event and validate unchanged cancellation, outputs, and calls.

## Tasks

1. Verify the observation gap and overlapping changes; obtain ReviewGPT patch.
2. Inspect/apply the scoped patch and run focused proof and affected typechecks.
3. Complete parent review, docs/complexity/privacy checks, commit and draft PR.
4. Run final ReviewGPT concurrently with exact-head CI, resolve findings, and
   close the plan. Recheck deployed ancestry before any authorized rollout.

## Decisions

- Existing source-read telemetry combines source loading, model construction,
  vocabulary reading, and metric projection. Its broad label cannot select a
  justified performance correction. Existing forced-timeout scheduling proof
  passes and preserves continuation priority.
- PR #3391 changes projected entity selection at the end of this same function.
  Its actual diff addresses different behavior; preserve that change on merge.
- Internal diagnostic outcome only; no member-facing changelog is needed.

## Verification

- Focused source observation and hosted refresh tests, affected query/runtime
  typechecks, docs gardening, complexity diff, whitespace and privacy inspection.
- Existing runtime continuation-priority tests passed in all four paths against
  source identical to the deployed revision; production timeout cause remains
  unproved. No production replay is authorized.

## Candidate evidence

- ReviewGPT supplied the exact eight-file implementation patch. Captured model
  metadata verifies `gpt-6-pro`; response SHA-256 is
  `425c95122d1fc588d7df657b560282a7bd72870a02b35ec5903add7d28bc06ff`.
  The response's self-reported model was unknown; the captured model metadata is
  the direct verification. The original response and patch remain in ignored
  task audit artifacts.
- Before applying production hunks, the two new query observations and all four
  runtime cases requiring source timing failed specifically on absent diagnostic
  observations/fields. Four original no-source-timing continuation cases passed.
- After applying the patch unchanged, the full selected query files pass 15 tests
  and the full selected runtime files pass 83 tests. This covers all five source
  operations, a deadline between operations, effective caller deadlines, timer
  delay, cancellation joining, empty/populated result parity, observer failure,
  publication boundaries, and continuation priority with/without timing.
- The new observation is two optional fields on the existing timeout done event;
  production recovery and performance cause still require natural traffic.

- Both affected package typechecks pass. Workspace-boundary verification and
  documentation gardening pass with zero issues. Complexity guard passes for
  four changed source files: total existing debt and maximum complexity are
  unchanged. Existing large runtime orchestration hotspots are untouched; the
  added observation does not justify a broader refactor.
- Parent privacy and diff inspection found only five fixed source labels and
  bounded timing. Existing event vocabulary, deadlines, source selection,
  cancellation, awaited operations, and publication calls are preserved. The
  applied source/test/owner-doc hunks reverse-check against ReviewGPT's patch.

- Both affected package builds pass, including emitted public query declarations
  and the consuming runtime package. Candidate review is Ready; final external
  review and exact-head CI remain pending.
