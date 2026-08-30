# Bound and surface CLI artifact generation

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Make CLI artifact generation report its active stage and terminate with an
  actionable error if the Incur generator child stops making bounded progress.

## Success criteria

- The exact `pnpm --dir packages/cli gen:config-schema` command reports the
  build, Incur-generation, finalization, and write stages.
- The Incur child has a generous production bound and a deterministic focused
  regression proves that a wedged child is terminated with a public-safe error.
- The command regenerates all three committed artifacts without drift.

## Scope

- In scope: the repository-owned CLI artifact generator, its Incur child
  lifecycle, stage output, and focused regression coverage.
- Out of scope: release packaging timeouts, changes to generated artifact
  contents, production CLI runtime behavior, and ReviewGPT infrastructure.

## Constraints

- Technical constraints: preserve the existing Incur invocation and generated
  outputs; bound only the reported slow child rather than unrelated build work.
- Product/process constraints: keep the correction repository-local and
  low-risk; do not consume the related unmerged release-manifest patch.

## Risks and mitigations

1. Risk: a bound that is too short can reject legitimate contended-host work.
   Mitigation: use a five-minute production bound, while tests inject a short
   bound into the same child-process owner.
2. Risk: logging from a shared helper can pollute programmatic callers.
   Mitigation: make stage reporting opt-in and enable it only in the generator
   entrypoint.

## Tasks

1. [x] Reproduce and time the exact generator and isolated Incur phase.
2. [x] Add a process-level failing timeout regression.
3. [x] Add opt-in stage reporting and a bounded Incur child.
4. [x] Verify focused behavior, type safety, exact generation, and artifact drift.
5. [x] Commit and push Draft PR #2556. Preserve it for the required preliminary
   coverage review because no healthy managed ReviewGPT profile was available.

## Decisions

- The current host completes the exact command in 30.51 seconds and the
  isolated no-rebuild phase in 13.77 seconds. This proves real slow work rather
  than a reproduced deadlock, while the unbounded silent child remains unable
  to distinguish that work from a hang.
- Bound only `incur gen`; the preceding package build is separately owned and
  the reported friction begins after that build.

## Verification

- `pnpm --dir packages/cli exec vitest run test/incur-config-schema.test.ts`
  passed with one process-level timeout regression.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/cli gen:config-schema` passed in 27.67 seconds and
  printed every intended stage.
- `git diff --exit-code -- packages/cli/config.schema.json
  packages/cli/src/incur.generated.ts
  packages/cli/src/vault-cli-skill-hash.generated.ts` passed: generated files
  remained byte-for-byte clean.
- Changelog: not applicable because this changes only repository-local
  developer tooling and its regression coverage; members cannot experience it.
- Review: preliminary completion-specialists remains required but not run or
  credited; final ReviewGPT is policy-exempt for this developer-tooling-only
  diff. The Draft PR remains the exact resumable handoff.
Completed: 2026-08-29
