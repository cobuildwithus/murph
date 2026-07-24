# PR 890 Round 4 Engagement Contract

Status: completed
Created: 2026-07-23
Updated: 2026-07-23

## Goal

Make the implemented engagement contract explicit after ReviewGPT Round 4:
an accepted meal-photo upload is member-wide engagement under the existing
28-day automation policy, not closeout-only authorization.

## Decision

- The engagement gate is a member-activity policy, not per-automation consent.
- An explicit accepted upload is engagement even when canonical import later
  retries.
- AI-usage authorization, current route authority, and ordinary cron ownership
  remain unchanged.
- Do not add automation identity to reconciliation, another processing mode,
  state owner, scheduler, queue, lifecycle, or compatibility path.

## Tasks

1. Correct durable architecture and deliverability wording.
2. Rename the existing generic-wake regression proof so its scope is explicit.
3. Update the PR intent contract and current change shape.
4. Run focused proof, canonical verification, exact-head CI, and the
   disclosure-only ReviewGPT Round 4 retry.

## Evidence

- The focused hosted reconciliation suite passed 42 tests.
- Agent-doc drift and diff hygiene checks passed.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff ...` passed the
  affected Web tests, lint, typecheck, development smoke, and production build
  in a clean Blacksmith Testbox in 4m31s.
- The correction changes no production source, runtime behavior, schema,
  dependency, or deploy surface.
Completed: 2026-07-23
