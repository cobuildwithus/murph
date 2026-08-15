# Preserve frontend worktree startup overrides

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Let a frontend-only sanctioned worktree start with its explicitly disabled
  Temporal mode, while keeping managed Temporal as the worktree helper default.
- Put the required Vercel project-link setup before the documented app-local
  frontend startup command.

## Success criteria

- `buildHostedLocalWorktreeConfig` and the derived dev config preserve an
  explicit `MURPH_DEV_TEMPORAL=disabled` value.
- Worktree config still selects managed Temporal when no override is supplied.
- The frontend-only guide states the Vercel-link prerequisite before startup.
- Focused tests, package typecheck and boundary proof, documentation checks,
  diff hygiene, and a privacy scan pass. Any unrelated scoped-lane failure is
  isolated and reported with base-comparison evidence.

## Scope

- In scope: hosted-local worktree environment construction, its focused tests,
  and the hosted-local worktree guide.
- Out of scope: other Temporal modes, a new frontend runner, Vercel credential
  handling, runtime deployment, and GitHub publication.

## Constraints

- Technical constraints: preserve only the supported explicit disabled mode;
  retain current managed defaults and every existing isolation setting.
- Product/process constraints: use the supplied activation commit as the exact
  base, keep examples secret-safe, commit locally, and do not push or open a PR.

## Risks and mitigations

1. Risk: broad environment passthrough could unintentionally admit `auto` or
   `external` and weaken worktree isolation.
   Mitigation: derive a two-state worktree Temporal value that preserves only
   the explicit canonical `disabled` value and otherwise emits `managed`.
2. Risk: moving the Vercel guidance could duplicate or drift secret-handling
   instructions.
   Mitigation: place a short prerequisite beside startup and retain the
   detailed source-of-authority rules in the existing section.

## Tasks

1. Add a focused regression test that proves the explicit-disabled failure.
2. Correct worktree environment construction without adding a new owner.
3. Move or repeat the Vercel-link prerequisite before frontend-only startup.
4. Run focused verification, inspect the diff, privacy-scan, and commit.

## Decisions

- The worktree helper remains managed-by-default; only explicit disabled input
  survives its isolation overrides.
- Documentation remains the owner of the frontend-only app-local command; no
  new wrapper is added for a one-time project-link prerequisite.

## Verification

- Focused worktree Vitest: 39 tests passed, including the new disabled-mode
  regression; the same assertion failed against the activation head before the
  source fix.
- Hosted-local-harness typecheck: passed.
- Worktree environment smoke: emitted `disabled` for the explicit override and
  `managed` with no override.
- Package-boundary verification: 2 tests passed.
- Doc gardening: completed with zero issues. Agent-doc drift checks passed.
- Diff-scoped verification reached the affected harness suite but remained red
  on two pre-existing Web workspace-boundary violations and one unrelated
  process-integration ready-file timeout; those tests, sources, and guards are
  unchanged from the supplied base. The changed worktree test and package
  typecheck passed independently and inside the scoped lane.
- Final diff check and identifier/secret scan: passed.
Completed: 2026-08-13
