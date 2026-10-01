# Bound release CLI manifest packaging wait

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Let release packaging finish the real schema-bearing CLI manifest on a
  contended supported host while preserving the ordinary manifest reader's
  bounded 60-second default.

## Success criteria

- The release-only generator supplies an explicit bounded wait longer than the
  observed valid packaging duration.
- The shared CLI-manifest reader honors an explicit timeout without changing
  callers that omit it.
- Focused regression tests prove both the release override and unchanged
  default timer, and assistant-engine typecheck passes.
- The exact pushed PR head completes required ReviewGPT and CI gates, or is
  preserved as a clean Draft handoff when shared review capacity is unavailable.

## Scope

- In scope: assistant CLI-manifest process timeout ownership, the release-time
  generated contract caller, focused assistant-engine regression coverage, and
  durable release verification documentation if the owner contract changes.
- Out of scope: environment-driven timeout escape hatches, unbounded waits,
  changes to ordinary runtime defaults, release workflow restructuring, and
  adjacent runner-bundle Frog issues.

## Constraints

- Technical constraints: keep the subprocess wait bounded, preserve sanitized
  child-process environment and termination semantics, and avoid production
  credentials or provider calls.
- Product/process constraints: Frog authority is the committed entry for issue
  #2438; publish only public-safe evidence; keep the PR Draft until focused proof
  and exact-head review admission are complete.

## Risks and mitigations

1. Risk: a broad timeout increase masks a hung runtime command.
   Mitigation: retain the existing 60-second default and opt in only from the
   release artifact generator.
2. Risk: the new timeout option is diagnostic-only and not honored by the
   spawned process.
   Mitigation: spy on the real timer boundary to prove the configured value
   drives the scheduled subprocess termination deadline.

## Tasks

1. [complete] Add a failing regression that requires a bounded release-only timeout.
2. [complete] Add the smallest optional reader input and pass it from the generated
   release artifact owner.
3. [complete] Run focused unit proof, package typecheck, and the affected release checks.
4. [in progress] Inspect the final diff, finish the scoped commit, push, and open a Draft PR.
5. [pending] Run or hand off the exact-head ReviewGPT and CI gates according to available
   shared capacity.

## Decisions

- The current defect is not obsolete: `pack-publishables.mjs` regenerates the
  assistant-engine artifact, whose only full-manifest reader still enforces the
  same fixed 60-second process timeout.
- A test-only environment override is rejected because the failing path is the
  real release pack job. The existing typed reader input is the narrow owner for
  a bounded caller-specific budget, and the packer passes it through one
  validated internal generator argument.

## Verification

- Commands to run: focused Vitest for
  `assistant-cli-surface-bootstrap.test.ts`, assistant-engine typecheck, and the
  affected release packaging/workflow guard tests selected from the CI map.
- Expected outcomes: the release generator requests the explicit longer bound,
  the shared reader schedules that bound while its default stays 60 seconds,
  and all focused owner checks pass.
- Results: assistant CLI surface bootstrap 23/23 passed; assistant-engine
  typecheck passed; CLI release-script coverage audit 48/48 passed with its one
  explicitly gated real-tarball test skipped; docs drift/gardening, Node syntax,
  and `git diff --check` passed.
Completed: 2026-08-29
