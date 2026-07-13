# Accelerate onboarding follow-up E2E gate

Status: completed
Created: 2026-07-13
Updated: 2026-07-13

## Goal

- Reduce the routine pull-request wall clock for the Linq reminder/onboarding
  hosted-local E2E leg without weakening the production-like deployment gate.

## Success criteria

- Routine CI applies an explicit fast timing profile to onboarding follow-up
  recurrence and idle checkpointing.
- The default profile retains the existing 150-second recurrence and 30-second
  idle checkpoint used outside the routine CI gate.
- Focused timing proof and the repo-required scoped verification pass.

## Scope

- In scope: onboarding-follow-up E2E timing configuration, focused regression
  proof, and durable CI documentation.
- Out of scope: production automation cadence, Temporal/runtime behavior, job
  sharding, runner-image preparation, and unrelated hosted-local scenarios.

## Constraints

- Technical constraints: keep production-path waiters observational and preserve
  enough recurrence runway for the first notification turn plus the completion
  turn before the second occurrence.
- Product/process constraints: preserve unrelated working-tree work, use the
  existing fast-gate environment seam, and make no production behavior change.

## Risks and mitigations

1. Risk: An over-aggressive recurrence interval makes the E2E gate flaky.
   Mitigation: retain a two-minute fast recurrence and assert both timing
   profiles directly.
2. Risk: The routine fast profile leaks into the protected deployment gate.
   Mitigation: derive timing only from the existing opt-in fast-gate variable;
   keep default values unchanged and covered.

## Tasks

1. Capture exact job and per-scenario timings from the referenced Actions run.
2. Add and cover the onboarding-follow-up fast timing profile.
3. Update the durable CI timing description.
4. Run scoped verification, required coverage audit, final review, and commit.

## Decisions

- Use the existing `MURPH_HOSTED_LOCAL_E2E_FAST_GATE` seam rather than adding a
  workflow input or test-only scheduler mutation.
- Keep the two scenarios grouped; optimize the slow test itself instead of
  consuming another organization-level Actions slot.

## Verification

- Referenced run evidence: the job took 13m05s; the scenario step took 11m39s.
  The reminder scenario accounted for about 3m02s and onboarding follow-up for
  about 8m02s. The onboarding scenario still used two 150-second recurrence
  waits plus a 30-second checkpoint despite the workflow's fast-gate setting.
- Focused proof: `MURPH_HOSTED_LOCAL_E2E_FAST_GATE=1 pnpm exec vitest run
  --config apps/cloudflare/vitest.config.ts
  apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts -t 'timing
  helpers'` passed with one test passed and one skipped.
- Required scoped verification: `pnpm test:diff
  apps/cloudflare/test/hosted-local-onboarding-followup-e2e.test.ts
  agent-docs/references/testing-ci-map.md
  agent-docs/operations/verification-and-runtime.md` passed with 97 test files
  and 1,737 tests passing after the coverage-write assertion was added.
- Coverage-write audit added direct proof that explicit fast-gate value `"0"`
  retains the full profile; focused proof and `git diff --check` passed after
  that change.
Completed: 2026-07-13
