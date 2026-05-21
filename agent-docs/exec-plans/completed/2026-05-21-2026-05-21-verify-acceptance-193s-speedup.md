# Verify acceptance 193s speedup

Status: completed
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
- Asked `review:gpt` for an external static review. It identified CLI coverage
  contention, late web `next build` startup, prepared-artifact mutation risk,
  and late package-boundary rebuilds as the highest-value follow-ups.
- Added prepared contracts and package-boundary variants so acceptance can reuse
  already-built artifacts without rebuilding shared `dist` outputs in the
  package-coverage tail.
- Made package coverage CLI-aware: local fanout drops to 4 while CLI coverage is
  active, non-prepared contracts waits until CLI exits, and child coverage jobs
  write status from an `EXIT` trap.
- Started hosted-web `next build` immediately in the local parallel app verify
  branch, with dev smoke/test/lint as sibling background jobs.
- Focused checks passed: shell syntax, hosted Temporal package coverage, CLI
  release-script coverage audit, CLI export-pack runtime test, and standalone
  CLI coverage at 80s.
- Full timing proof is still pending. A captured full run reached 166s and was
  not acceptable because it missed the 144s target and masked a package failure.
  A follow-up measurement was stopped to avoid competing with other local
  verification already running in the shared checkout.
- Latest full acceptance run after the CLI-aware and web-build-overlap changes
  reached 206s but failed before a valid timing proof: hosted-web `next build`
  hit a workflow-status parser type error, and the CLI workout help assertion
  timed out under the heavy overlap. Focused fixes now pass: direct hosted-web
  `tsc`, the hosted-orchestration status route test, the workout coverage test,
  and diff whitespace checks for the touched files.
- A second full acceptance retry is blocked before timing by the separate active
  hosted runtime processing/observability row: package typecheck currently fails
  in `packages/hosted-orchestrator-temporal` and shared hosted-execution
  contract changes. This is outside the speedup lane and overlaps an active
  coordination-ledger row, so do not take over those files from this plan.
- After the hosted runtime row advanced, full acceptance reached app verification
  at 146s with app checks passing, missing the target by 2s, then failed on a
  CLI inbox root-help smoke timeout under package coverage contention. Retuned
  the local app-verification delay to 50s and moved that root-help assertion to
  the in-process CLI helper. Focused CLI checks pass; full proof is pending.
- A clean full acceptance retry then got app verification to the target window
  but failed Cloudflare app verify on a stale helper test that still expected the
  legacy ensure-execution response. The same run showed CLI coverage remained
  the package tail at 148s, so the CLI-active fanout default is back to 4 after splitting the long CLI smoke bucket.
- The next full retry reached app verification at 149s and then failed because
  `cli-incur-smoke` timed out on a schema-only projection-status assertion under
  package coverage contention. That assertion now uses the in-process schema
  helper, and the local app-verification delay is 45s for another full proof.
- Final local proof passed. A full `pnpm verify:acceptance` run reported app
  verification done at 130s since verifier command start and package coverage
  suite done at 134s, meeting the <=144s target while retaining package
  coverage, fixture smoke, built package-boundary checks, and both app verifiers.
Completed: 2026-05-21
