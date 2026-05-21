# Verify acceptance 193s speedup

Status: active
Created: 2026-05-21
Updated: 2026-05-21

## Goal

- Reduce the current `pnpm verify:acceptance` verifier-reported runtime from the
  fresh 193s baseline to under 145s, preserving the same acceptance surfaces and
  avoiding brittle local-only shortcuts.

## Success criteria

- `pnpm verify:acceptance` exits successfully.
- The verifier log reports final app verification at <=144s since command start
  on a normal local run with no bypass flags.
- The command still covers workspace typecheck, doc gardening, prepared runtime
  artifacts, package coverage, fixture smoke coverage, package-boundary checks,
  and both app verifiers.
- Any overlap introduced has explicit prerequisites or tests proving it does not
  race shared generated artifacts.

## Scope

- In scope: `scripts/workspace-verify.sh`, focused verifier tests/docs if needed,
  and direct evidence from acceptance logs.
- Out of scope: reducing coverage, hidden skip flags, loosening tests/timeouts,
  changing app/package runtime behavior, or touching unrelated Temporal env parser
  work already dirty in this checkout.

## Constraints

- Technical constraints: preserve the workspace artifact lock, do not race
  artifact producers that mutate shared `dist`/generated outputs, and keep CI
  conservative when local-only parallelism would be risky.
- Product/process constraints: do not weaken acceptance semantics.

## Risks and mitigations

1. Risk: app verification and package coverage contend for generated artifacts.
   Mitigation: only overlap after shared prerequisites are prepared, inspect app
   verifier skip/prepared flags, and prove with a full acceptance run.

## Tasks

1. Inspect the current acceptance timing profile and verifier scripts.
2. Identify a safe overlap or caching point that preserves coverage.
3. Add focused tooling tests/readback when script behavior changes.
4. Run the full command and verify the <=144s target.

## Decisions

- The current baseline for this task is the user's requested 193s verifier time,
  so the target is <=144s.

## Verification

- Commands to run:
  - focused syntax/test checks for changed verification tooling
  - `pnpm verify:acceptance`
- Expected outcomes:
  - full command passes and reports final app verification at <=144s

## Progress

- Added dynamic package-coverage slot refill so completed package jobs open the
  next package immediately instead of waiting for a whole batch to drain.
- Split long CLI device and release/audit smoke tests into independent CLI
  workspace buckets.
- Added delayed local app-verification overlap for acceptance coverage runs.
- Fixed package-coverage failure propagation after finding a masked hosted
  Temporal package failure in the captured full acceptance log.
- Focused checks passed: shell syntax, hosted Temporal package coverage, CLI
  release-script coverage audit, CLI export-pack runtime test, and standalone
  CLI coverage at 80s.
- Full timing proof is still pending. A captured full run reached 166s and was
  not acceptable because it missed the 144s target and masked a package failure.
  A follow-up measurement was stopped to avoid competing with other local
  verification already running in the shared checkout.
