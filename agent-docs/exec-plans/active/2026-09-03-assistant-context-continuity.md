# Preserve relevant assistant context across unrelated turns

Status: active
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Let a terse completion reply retain the exact canonical context carried by an
  earlier eligible assistant delivery when a newer same-session delivery has no
  context of its own.
- Keep receipt claiming, route isolation, and canonical mutation authority
  unchanged.

## Architecture

- Outcome and invariant: established same-route context reaches the next reply;
  runtime context remains interpretation input rather than write authority.
- Owner: the existing auto-reply prior-delivery projection in
  `packages/assistant-engine/src/assistant/automation/reply.ts`.
- Root-cause evidence: the unanchored path selects the newest delivery for its
  receipt claim, then explicitly clears references from every older delivery;
  the focused test currently expects the earlier workout reference to vanish.
- Simplest correction: delete that reference-clearing branch and let the
  existing projection discard irrelevant same-session messages naturally.
- State and failure behavior: add no state, resolver, or dependency. Preserve
  exact-route filtering, causal cutoff, settled-through watermarking, native
  reply handling, bounded context selection, and ordinary canonical reads and
  writes.
- Deployment: one assistant-engine implementation change with no schema,
  protocol, or mixed-version requirement.

## Product UX Patch

- Outcome: a member can report a completed set without repeating which active
  workout Murph just asked about.
- Reaches: an established private workout conversation with an earlier
  referenced reminder and a newer unrelated same-session assistant turn.
- Proof: deterministic auto-reply assembly retains the earlier exact reference
  while the newest delivery still owns the claim, then a focused real-Codex
  journey logs the intended set exactly once without asking which workout.

## Scope

- In scope: unanchored same-route prior-delivery projection, its focused
  regression, one synthetic real-Codex journey, and a member-visible changelog
  item.
- Out of scope: workout-specific lookup rules, new active-workout state,
  semantic relevance classification, route or authorization changes, and
  canonical workout mutation behavior.

## Tasks

1. Remove the latest-only reference erasure.
2. Replace the regression that blesses the context break with one proving
   continuity and unchanged receipt ownership.
3. Add and run a focused production-derived real-Codex completion journey.
4. Run focused tests, typecheck, complexity and diff checks, complete the
   Product UX walkthrough, and finish the PR/CI path.

## Verification

- Focused assistant auto-reply event-path Vitest regression.
- Focused real-Codex workout completion journey using the local subscription.
- Assistant Engine typecheck, `pnpm complexity:diff`, `git diff --check`, and a
  private-identifier scan.
- Exact-head required CI and risk-routed final review.

## Product UX Walkthrough

- Established private workout conversation: the Linq-shaped boundary test
  retains the earlier exact activity-session reference, omits the unrelated
  same-session message from injected context, and leaves the newest delivery as
  the receipt claim.
- Terse completion: the focused real-Codex journey logged set 8 exactly once as
  12 reps, completed the intended 8/8 workout, and did not ask which workout.
- Unchanged paths: explicit native replies, unrelated deliveries without
  context, route isolation, and watermark behavior remained green in the full
  107-test auto-reply owner suite.
- Differences from plan: none.
- Verdict: Ready.
