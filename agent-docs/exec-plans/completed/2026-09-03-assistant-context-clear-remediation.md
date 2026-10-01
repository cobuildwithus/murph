# Preserve explicit workout context clears

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Keep unrelated assistant deliveries transparent to an earlier exact workout
  reference.
- Keep an explicit empty workout-context decision as a fail-closed barrier so
  an older workout can never be resurrected.
- Preserve newest-delivery receipt claiming and ordinary canonical mutation
  authority.

## Root Cause

- The workout delivery tracker already produces the needed three states:
  `undefined` for no decision, `[]` for an explicit clear, and one exact
  `activity_session` reference for continuity.
- Delivery normalizes the tracker's no-decision state to `null`, then the
  outbox collapses `null`, `[]`, and legacy omission before persistence. The
  initial continuity fix therefore cannot tell a transparent unrelated
  delivery from an intentional clear when it scans older references.

## Architecture

- Reuse the nullable/optional outbox reference field; add no schema, database
  migration, service, state owner, cache, queue, classifier, or dependency.
- Persist `null` for no decision, an empty array for an explicit clear, and a
  non-empty array for exact references.
- Let the newest raw eligible delivery continue to own the receipt claim.
  Separately, let the newest explicit context decision own trusted workout
  references; no-decision deliveries are transparent and an empty decision is
  a barrier.
- Treat legacy missing values as conservative barriers because their original
  meaning cannot be recovered. Newly written intents are unambiguous without a
  migration or cutover timestamp.

## Product UX Patch

- An unrelated assistant exchange no longer makes a member repeat the active
  workout before reporting a set.
- A conflicting, deleted, malformed, or explicitly cleared workout result
  never revives an older workout; Murph must resolve again or clarify.

## Tasks

1. Add focused failing persistence and auto-reply regressions for no-decision,
   explicit-clear, and latest-exact-reference ordering.
2. Preserve the existing three states through delivery and outbox persistence.
3. Select only the latest explicit context decision for trusted references.
4. Run focused deterministic and live-model proof, typechecks, complexity,
   privacy, exact-head ReviewGPT, and CI.

## Verification

- Focused outbox and auto-reply suites passed all 237 tests, including
  no-decision continuity, explicit clears, stale-reference suppression, and a
  conservative legacy-missing barrier.
- Existing workout context tracker and assistant service runtime suites passed
  all 83 tests; skill contract suites passed all 115 runnable tests.
- The focused real-Codex journey passed with one set write, 12 logged reps, an
  8/8 completed workout, no clarification, and a clear truthful reply.
- Assistant Engine and Operator Config typechecks passed. Docs drift,
  `pnpm complexity:diff`, `git diff --check`, and the private-identifier scan
  passed. Complexity debt decreased by one in both changed runtime owners.
- Exact-head ReviewGPT correction review and required CI remain merge gates.

## Product UX Walkthrough

- New unrelated delivery: the latest exact workout remains the sole trusted and
  model-visible reference while the unrelated delivery still owns the receipt
  claim.
- Explicit clear or ambiguous legacy omission: no earlier workout reference is
  trusted or shown to the model.
- Terse completion: real Codex logs only the intended final set and reports the
  completed workout without asking the member to repeat its identity.
- Verdict: Ready.

Completed: 2026-09-03
Completed: 2026-09-03
