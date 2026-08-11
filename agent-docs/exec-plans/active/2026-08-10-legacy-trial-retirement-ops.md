# Legacy trial retirement Ops control

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make the existing fail-closed legacy Pulse trial retirement available to an
  allowlisted operator in the Vercel production runtime, where the live Stripe
  credential is intentionally not downloadable.
- Complete the bounded cleanup with an aggregate dry-run, an exact-count apply,
  and an automatic verification that zero candidates remain.

## Success criteria

- `/ops/usage` renders one reusable production control with explicit loading,
  error, empty, candidate, confirmation, and converged states.
- Dry-run never mutates provider or database state; apply requires the exact
  candidate count from the displayed dry-run and prevalidates every candidate
  before the first mutation.
- Paid, ambiguous, unreadable, or count-changed state fails closed. Responses,
  logs, and UI expose aggregate counts only.
- The CLI and Ops route share one retirement owner instead of duplicating
  billing policy.
- The design catalog renders the production component against synthetic data,
  and focused service, route, and UI coverage passes with Web typecheck.
- Exact-head CI, preliminary specialist review, and final ReviewGPT complete
  with no unresolved actionable findings before merge and production use.

## Constraints

- Do not add a new Ops page, persisted job, queue, scheduler, or second billing
  state owner.
- Do not expose Stripe credentials, member identifiers, subscription
  identifiers, or production rows in output or durable artifacts.
- Keep the existing per-member billing lock and exact accepted Pulse Price as
  the final mutation authority.
- Do not pause Render, remove the shared Web-to-Cloudflare control URL, or
  intentionally interrupt hosted execution for this maintenance action.

## Tasks

1. Extract the existing CLI retirement behavior into one reusable service.
2. Add the authenticated same-origin Ops route and `/ops/usage` confirmation
   control, including automatic verification to zero.
3. Add design-catalog studies and focused domain, route, and client coverage.
4. Correct obsolete rollout text that would disable unrelated shared
   Web-to-Cloudflare operations.
5. Run focused verification and rendered desktop/mobile proof, inspect the
   complete diff, and push the exact review candidate.
6. Resolve exact-head specialist/final review and CI, merge and deploy, then run
   dry-run/apply/dry-run-to-zero from production Ops.

## Verification log

- A direct production CLI dry-run failed before database or Stripe access
  because Vercel correctly withheld the runtime-only Stripe credential from
  local environment execution. No production mutation occurred.
- Web TypeScript and focused ESLint passed.
- Twenty-four focused service, route, control, and parent-page tests passed.
  They prove aggregate-only dry-run, full preflight before mutation, exact-count
  refusal, paid-state refusal, automatic verification to zero, stale-action
  removal, and error recovery.
- The frontend design-proof policy suite passed all ten checks.
- The real production control rendered from the component catalog with inert
  synthetic candidate and zero states. The inspected hosted desktop crop is
  1792 by 1696 pixels; the inspected hosted mobile crop is 1026 by 2019 pixels.
- The required Fable UI double-check was attempted once and stopped at explicit
  usage-credit exhaustion, as required by the completion workflow. No local
  substitute was added.
- Changelog: not applicable. This is an allowlisted internal operator control
  and runbook correction, not a member-visible product change.
