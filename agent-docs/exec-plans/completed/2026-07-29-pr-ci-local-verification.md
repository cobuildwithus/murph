# Rely on pull request CI for full verification

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make pull-request delivery fast locally by requiring only focused proof before
  a PR while making exact-head GitHub Actions the full-suite gate.
- Preserve the full local acceptance requirement before any direct push to
  `main` or another shared default branch.

## Success criteria

- Agent guidance no longer requires `pnpm test:diff`, `pnpm test`, or
  `pnpm verify:acceptance` locally merely to open or update a PR.
- PR-bound work still runs the smallest focused local checks that prove the
  touched behavior and cannot be called complete until required CI is green on
  the exact head.
- CI failures route first to the narrowest local reproducer, with umbrella
  commands available when broader diagnosis is necessary.
- Direct default-branch pushes require `pnpm verify:acceptance` against the
  reconciled candidate.
- Completion, verification, ReviewGPT, testing-map, and index guidance agree.

## Scope

- In scope: agent workflow documentation, the preliminary specialist prompt,
  focused policy-oracle tests, and closing exact-head CI parity gaps in the
  existing host-support release gate.
- Out of scope: changing product behavior or product tests, required-check
  settings, release/deployment workflows, or deployment gates.

## Constraints

- Technical constraints: keep existing CI coverage and exact-head PR review
  gates intact.
- Product/process constraints: keep the rule concise, preserve focused local
  proof, and avoid adding a second verification owner or new tooling.

## Risks and mitigations

1. Risk: agents interpret lighter local verification as permission to ship
   untested work.
   Mitigation: require focused local proof before the PR and green required CI
   on the exact PR head before completion.
2. Risk: direct pushes bypass the CI feedback loop.
   Mitigation: require the canonical full acceptance suite before a direct
   default-branch push.
3. Risk: ReviewGPT still rejects a PR because no local coverage umbrella
   command ran.
   Mitigation: make coverage applicability depend on changed executable
   behavior and accept focused local proof plus current exact-head CI status.
4. Risk: broad local verification moves to CI while CI omits an acceptance
   owner.
   Mitigation: keep every acceptance package coverage owner and built
   package-boundary check in the required host-support release gate, with a
   focused workflow guard.

## Tasks

1. Update the routing and verification ownership rules.
2. Align completion and ReviewGPT specialist instructions.
3. Close and guard any exact-head CI parity gap revealed by specialist review.
4. Update the testing map, top-level agent rule, and docs index.
5. Run focused policy checks, inspect the final diff, and finish through the PR
   lane.

## Decisions

- GitHub Actions owns broad/full verification for PR-bound work.
- Local PR verification remains focused and behavior-specific.
- `pnpm verify:acceptance` remains mandatory for direct default-branch pushes.
- CI failure diagnosis starts narrow and expands only when evidence requires it.
- The preliminary specialist review identified two real CI-parity omissions and
  one subjective coverage-lens trigger. The final policy keeps the objective
  trigger and adds the missing existing acceptance owners to the existing
  required host-support gate instead of creating a second gate.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/release-script-coverage-audit.test.ts`
  passed with 40 tests and one intentional skip.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/host-support-workflow-guards.test.ts packages/cli/test/release-script-coverage-audit.test.ts`
  passed with 46 tests and one intentional skip after the preliminary
  specialist remediation.
- `pnpm docs:drift` passed.
- `git diff --check` passed.
- Secret-safe searches found no personal identifier in the changed files and no
  remaining live policy phrase that requires a local coverage-bearing umbrella
  command for PR-bound work.
- The preliminary specialist pass returned findings; every accepted finding was
  resolved in the final diff, and no patch artifact was applied.
- All 27 GitHub Actions checks passed on the first pushed head. Required
  exact-head CI remains pending for the final specialist-remediation head.
- Parent final review found no unresolved finding. The separate final ReviewGPT
  gate is not applicable to this repo-internal workflow, test, and documentation
  change with no production behavior.
Completed: 2026-07-29
