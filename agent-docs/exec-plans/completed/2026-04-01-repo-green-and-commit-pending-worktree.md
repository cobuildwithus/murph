# Restore repo-green verification and commit the remaining hosted-web worktree

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Get the current remaining worktree back to repo-green verification and commit the pending hosted-web/doc-inventory state without discarding the intended UI/privacy changes already present on disk.

## Success criteria

- The pending `apps/web/**`, generated doc inventory, and any directly required support files pass the repo checks needed for this cross-cutting landing.
- Dependency/lockfile state is coherent and the hosted-web lane is green under its required checks.
- Any failing repo-wide verification is fixed or reduced to a credibly unrelated blocker with clear evidence.
- The remaining pending worktree state is committed with a scoped commit.

## Scope

- In scope:
- Pending hosted-web UI/settings/share/invite changes and any directly required support files.
- Generated doc inventory drift caused by the current worktree.
- Repo-green verification fixes directly caused by the remaining pending worktree.
- Out of scope:
- Unrelated already-committed assistant-core work from earlier tasks.
- New feature expansion beyond what is needed to land the current pending hosted-web state safely.

## Constraints

- Preserve the intended pending worktree behavior unless a change is required for correctness, verification, or policy compliance.
- Do not overwrite unrelated worktree edits outside the pending hosted-web/doc-inventory lane.
- Keep dependency policy satisfied: no manifest drift without the committed lockfile or a compensating removal of the unnecessary dependency.

## Risks and mitigations

1. Risk: The pending hosted-web diff may rely on an unfinished third-party dependency or partial shadcn adoption.
   Mitigation: inspect local UI component sources first, then either complete the dependency/lockfile change cleanly or remove unused dependency drift.
2. Risk: Repo-green failures may come from generated-doc drift or app verify surfaces rather than the React diff itself.
   Mitigation: run the real repo acceptance commands, then narrow fixes to the failing boundaries.
3. Risk: The staged UI changes affect public pages and settings flows that need direct proof beyond tests.
   Mitigation: add at least one direct package-level scenario or smoke proof and record it alongside scripted verification.

## Tasks

1. Register the stabilization lane and inspect the remaining pending worktree in `apps/web` plus generated docs.
2. Run repo acceptance commands to identify real blockers and fix them cleanly.
3. Re-run verification, perform the required final audit, and commit the remaining pending worktree state.

## Decisions

- Treat the remaining dirty tree as one hosted-web landing plus generated-doc drift, not as multiple separate code lanes.
- Prefer removing accidental dependency drift over introducing a fresh lockfile churn unless the new dependency is truly required by the landed code.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Any focused `apps/web` package checks or direct scenario checks needed to debug or prove the lane
- Expected outcomes:
- Repo-wide verification succeeds, or any residual failure is clearly unrelated and documented before commit.

## Outcome

- Result: repo-green restored without additional product-code fixes; the earlier failures were caused by overlapping verification runs, not a persistent regression in the pending hosted-web/doc-inventory lane.
- Direct scenario proof: `pnpm --dir apps/web verify` passed sequentially, including hosted-web lint, tests, smoke flow, and production build.
- Focused blocker isolation: `pnpm exec vitest run packages/cli/test/release-script-coverage-audit.test.ts -t "packages the selected vault and matching assistant-state without runtime or export-pack residue" --coverage.enabled false` passed in isolation.
- Final required checks: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all passed sequentially.
Completed: 2026-04-01
