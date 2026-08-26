# Murph Age public error paths

Status: completed
Owner: Codex
Started: 2026-08-24

## Goal

Keep reachable Murph Age submitted-payload validation errors value-free and
repairable by projecting only finite public field paths, including collapsing
dynamic qualifier keys to their static `qualifiers` parent.

## Scope

- Replace the three submitted preview/calculation schema parses with one
  owner-safe parse boundary in `packages/cli/src/commands/murph-age.ts`.
- Normalize the three owner-authored Experiment `option_validation` stages in
  this PR to the shared public `validation` vocabulary.
- Add focused built full-envelope and no-write coverage in the existing Murph
  Age command tests.
- Do not change the shared operator-config projector or perform the broader
  public-path migration in this task.

## Invariants

- Raw Zod paths, dynamic object keys, submitted values, artifact contents, and
  local paths never reach the final CLI envelope.
- Public paths are limited to supported top-level fields; submitted metric
  indexes may remain, while qualifier descendants collapse to
  `submittedMetrics.<index>.context.qualifiers`.
- Valid submitted payloads, Habitat recovery, and progress-card behavior remain
  unchanged.

## Tasks

1. [x] Inspect the three reachable parse paths and existing error mapping/tests.
2. [x] Implement the owner-safe finite path projection and stage normalization.
3. [x] Add built full-envelope/no-write proof with private qualifier data.
4. [x] Run focused tests, typecheck, package shape, bundle parity, privacy, and
       diff checks.
5. [x] Archive this plan with the scoped commit, push the Draft PR head, and
       refresh the concise PR evidence body without launching ReviewGPT.

## Verification

- Murph Age focused Vitest suite and built CLI full-envelope scenario.
- CLI typecheck and package-shape verification.
- Cloudflare runner bundle contract/full parity as needed for changed packaged
  CLI behavior.
- Diff, privacy, unsafe-cast, and shared-projector no-touch checks.

## Verification results

- Murph Age command suite passed 25/25, including the isolated built-CLI
  full-envelope/no-write qualifier regression; the focused Experiment option
  validation case passed 1/1.
- CLI typecheck, prepared runtime build, and package-shape verification passed.
- Cloudflare runner-bundle contract tests passed 14/14; full runner assembly,
  bundle budgets, and all eight bundled/unbundled parity probes passed.
- Frog inventory was checked; the existing focused-package-test entry covers
  the known filtered-test-script friction and no new qualifying friction arose.
- Whitespace, privacy, unsafe-cast, legacy-stage, raw-parse, shared-projector,
  and deferred-`publicPath` diff checks passed.

Completed: 2026-08-24
Updated: 2026-08-24
Completed: 2026-08-24
