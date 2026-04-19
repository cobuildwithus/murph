# Stabilize current dirty-tree verification failures

Status: active
Created: 2026-04-19
Updated: 2026-04-19

## Goal

- Restore truthful green verification for the current dirty tree by identifying and fixing the remaining typecheck, package/app test, and targeted local e2e regressions without undoing adjacent in-flight work.

## Success criteria

- `pnpm test:diff` passes for the current dirty tree or any remaining red lane is isolated to a credibly unrelated pre-existing failure with evidence.
- Targeted local hosted e2e lanes relevant to the dirty-tree Cloudflare changes pass after fixes.
- Any newly added or updated tests cover the regressions that caused the failures.

## Scope

- In scope:
- Verification triage across the currently touched `apps/cloudflare`, `apps/web`, `packages/assistant-runtime`, and `packages/hosted-execution` owners plus reverse-dependent checks.
- Minimal production and test fixes needed to make the failing lanes pass.
- Focused regression-test updates when behavior changed and current assertions no longer match intent.
- Out of scope:
- Unrelated refactors or feature work outside the failing verification surface.
- Reverting or reshaping adjacent in-flight changes that are not required to restore green verification.

## Constraints

- Technical constraints:
- Preserve overlapping dirty-tree edits and coordinate with active ledger rows before touching shared files.
- Keep package boundaries and existing hosted wake/runtime ownership rules intact.
- Product/process constraints:
- Use subagents for bounded fix work as requested.
- Run required verification and completion audits before handoff.

## Risks and mitigations

1. Risk: The dirty tree overlaps several active rows in the same files.
   Mitigation: Prefer narrowly scoped fixes, read the relevant context first, and avoid reverting or broadening adjacent edits.
2. Risk: App-local verify and local e2e lanes are heavier and may surface multiple independent failures.
   Mitigation: Clock failures first, then split by owner so fixes can proceed in parallel.

## Tasks

1. Capture the current failing verification set for the dirty tree.
2. Group failures by owner and delegate bounded fixes to subagents where scopes are disjoint.
3. Integrate fixes, rerun affected verification and targeted local e2e lanes, and close remaining regressions locally.
4. Run required completion audits, close the plan, and commit the stabilization changes.

## Decisions

- Use `pnpm test:diff` as the truthful first-pass inventory because the worktree already spans multiple affected owners.
- Treat focused Cloudflare local e2e checks as part of the stabilization proof because the dirty tree includes hosted local/e2e-facing changes.

## Verification

- Commands to run:
- `pnpm test:diff`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir apps/web verify`
- `pnpm --dir apps/cloudflare verify`
- Targeted local e2e under `apps/cloudflare` for the affected hosted-local flows
- Expected outcomes:
- Current dirty-tree verification surfaces pass without new regressions.
