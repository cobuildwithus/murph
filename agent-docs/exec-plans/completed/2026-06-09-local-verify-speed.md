# local-verify-speed

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Cut local `pnpm typecheck` and `pnpm test` wall-clock time by 10%+ without
  weakening coverage, adding configuration knobs, or introducing fragile
  scheduling behavior.

## Success criteria

- `pnpm typecheck` and `pnpm test` stay green with identical check coverage.
- Measured wall-clock improvement of at least 10% on each touched lane,
  recorded with before/after numbers from interleaved runs on one machine.
- No new env knobs, no new abstractions; only removal of unnecessary
  serialization and duplicated work.

## Scope

- In scope: `scripts/workspace-verify.sh` (typecheck fanout ordering, test
  prerequisites), root `vitest.config.ts` (project group scheduling), and the
  matching durable doc rows in `agent-docs/references/testing-ci-map.md` and
  `agent-docs/operations/verification-and-runtime.md`.
- Out of scope: hosted-local E2E harness changes (runner bundle build
  serialization is deliberate per 53577e961), CLI bucket ordering, coverage
  lanes, app verify lanes.

## Constraints

- Technical constraints: the contracts build must still complete before the
  package/app typecheck fanout; the contracts artifact verification must still
  complete before the root Vitest lane (built-runtime consumers import the
  rebuilt contracts dist); CLI workspace buckets must stay serialized relative
  to each other (shared prepared runtime-artifact lock and persistent command
  harness).
- Product/process constraints: keep doc rows truthful in the same change.

## Risks and mitigations

1. Risk: concurrent root Vitest package projects surface a latent cross-project
   resource conflict.
   Mitigation: audited projects for fixed ports/shared mutable dirs (real
   listens use port 0); ran the concurrent lane repeatedly green before landing.
2. Risk: unsorted typecheck fanout hides a real inter-package dependency.
   Mitigation: the no-emit typecheck scripts produce no outputs another
   package's typecheck consumes; verified cold and warm green runs.

## Tasks

1. Drop topological ordering from the package/app typecheck fanout.
2. Reduce `pnpm test` prerequisites to the contracts artifact verification.
3. Run root Vitest package projects as one concurrent group; keep CLI buckets
   serialized after them.
4. Sync the testing/verification doc rows.
5. Re-measure and record before/after timings.

## Decisions

- Do not touch hosted-local E2E: the runner-bundle workspace build was
  deliberately serialized (53577e961) after a parallel attempt broke shared
  project-reference outputs, and scenario stacks are architecturally serial.

## Verification

- Commands run (16-core macOS, isolated worktree from `main`):
  - `pnpm typecheck` cold (no `typecheck.tsbuildinfo`): 67.8s before → 20.2s
    after; warm: 20.2s before → 13.3s after. Direct fanout A/B on the same
    cache state: sorted 45.3s/16.5s vs no-sort 14.5s/10.3s (cold/warm).
  - `pnpm test`: 170.0s before → 114.8s after, identical surface
    (609 test files, 5994 passed / 9 skipped). Interleaved root-Vitest A/B:
    baseline 206.5s/172.9s vs concurrent groups 119.9s/117.5s; four
    concurrent-config runs total, all green.
  - `pnpm docs:drift`: passed. `bash -n scripts/workspace-verify.sh`: passed.
- Hosted-local E2E intentionally unmeasured/unchanged in this lane: another
  active e2e run was in progress on this machine, and the candidate knob
  (runner-bundle build concurrency) was deliberately serialized in 53577e961.
Completed: 2026-06-09
