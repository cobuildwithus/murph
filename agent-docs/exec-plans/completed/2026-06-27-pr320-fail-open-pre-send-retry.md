# PR 320 fail-open pre-send retry

## Goal

Fix the Linq first-contact fail-open retry path so a classifier-unavailable
attempt that creates pending member/invite state but fails before signup-link
delivery cannot become a durable implicit admission allow on retry.

## Constraints

- Preserve intended classifier-unavailable fail-open behavior for actual
  signup-link delivery.
- Do not persist synthetic unavailable admission decisions.
- Keep duplicate post-delivery webhook retries collapsed by delivered proof.
- Keep the fix scoped to hosted Linq webhook planning/dispatch and focused
  tests.

## Plan

1. Verify the provider planner and transport cleanup path.
2. Patch admission gating for pending members without delivered proof.
3. Add regression coverage for fail-open create plus pre-send failure followed
   by a terminal block retry.
4. Run focused hosted onboarding tests plus required verification.
5. Commit, push, and continue the Eragon ReviewGPT loop.
Status: completed
Updated: 2026-06-26
Completed: 2026-06-26
