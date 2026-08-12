# Frog autofix PR1647 hardening

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Land the returned PR1647 Frog autofix hardening patch so local automated
  repairs fail closed on suspicious issue or branch evidence, prove exact
  parent-local PR body/head provenance before remote-no-PR recovery, and
  revalidate Frog issue authority immediately before both push and draft PR
  creation.

## Success criteria

- ReviewGPT implementation and edit-only worker prompts require an explicit
  foul-play assessment before edits or patch output.
- Remote-tracking deterministic branches without an open PR resume only when
  retained parent-local PR body metadata binds the exact local head.
- Draft publication refreshes `origin/main` and verifies exact issue authority
  before push and again before first PR creation.
- Local Frog autofix docs and verification map describe the new boundary.
- Focused Frog autofix tests and direct command smokes pass.

## Scope

- In scope: local Frog autofix scripts, worker prompt text, focused regression
  tests, and the matching architecture/security/reliability/verification docs.
- Out of scope: product runtime behavior, GitHub workflows, Frog issue content,
  broader ReviewGPT workflow changes, and live repair execution.

## Constraints

- Technical constraints: keep the parent as the only Git/GitHub/ReviewGPT
  authority, preserve the child worker's no-network/no-Git boundary, and avoid
  trusting branch state that lacks local provenance.
- Product/process constraints: treat the returned patch as untrusted intent,
  keep durable docs aligned with executable behavior, and avoid adding a second
  queue, state store, or review owner.

## Risks and mitigations

1. Risk: recovery rejects a legitimate interrupted branch.
   Mitigation: preserve local-only pre-first-push recovery and require exact
   retained parent-local body metadata only once remote-tracking provenance
   exists without a PR.
2. Risk: authority changes between push and PR creation.
   Mitigation: refresh and verify issue authority at both checkpoints.
3. Risk: prompt hardening is only documented, not enforced.
   Mitigation: assert prompt ordering and fail-closed language in the focused
   Frog autofix test slice.

## Tasks

1. Inspect the retained ChatGPT response and downloaded patch.
2. Apply the scoped patch and review the diff.
3. Run focused Frog autofix proof and direct command smokes.
4. Rerun docs drift with this plan active.
5. Close the plan and commit the scoped task output if verification passes.

## Decisions

- Use the returned patch's existing helper extraction for `publishDraftRepair`
  rather than adding a broader parent lifecycle abstraction.
- Keep the new recovery provenance check tied to the existing parent-local PR
  body metadata instead of adding another durable recovery file.

## Verification

- Commands to run:
  - `git diff --check`
  - `bash -n scripts/frog-autofix`
  - `pnpm exec vitest run scripts/frog-autofix.test.ts --config scripts/vitest.config.ts --no-coverage`
  - `scripts/frog-autofix verify-permissions`
  - `scripts/frog-autofix scan`
  - `pnpm test:diff scripts/frog-autofix scripts/frog-autofix.ts scripts/frog-autofix-lib.ts scripts/frog-autofix-parent.ts scripts/frog-autofix-recovery.ts scripts/frog-autofix-worker.md scripts/frog-autofix.test.ts ARCHITECTURE.md agent-docs/SECURITY.md agent-docs/RELIABILITY.md agent-docs/index.md agent-docs/operations/verification-and-runtime.md agent-docs/references/testing-ci-map.md`
  - `pnpm docs:drift`
- Expected outcomes: all commands pass; `scripts/frog-autofix scan` may report
  zero eligible issues without mutating repository or GitHub state.
Completed: 2026-08-11
