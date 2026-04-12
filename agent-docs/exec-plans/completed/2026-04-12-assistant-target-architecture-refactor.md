# Land assistant target architecture refactor patch cleanly

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Land the supplied assistant target architecture refactor cleanly so assistant target persistence, runtime resolution, and provider resume/execution behavior use one explicit resolved target contract instead of hostname heuristics.

## Success criteria

- The supplied patch intent is integrated across `operator-config`, `assistant-engine`, and `setup-cli` without regressing current assistant target behavior.
- OpenAI-compatible targets persist preset-backed intent and resolve explicit runtime capabilities including execution driver, resume kind, continuity fingerprint, web-search mode, and zero-data-retention support.
- Assistant session persistence writes the intended `v5` shape while continuing to parse the required compatibility shapes.
- Required verification for the touched owners passes, or any unrelated blocker is identified concretely.
- Required audit passes complete and the task is finished with a scoped commit.

## Scope

- In scope:
- Land the supplied patch intent in the owned assistant target/runtime surfaces and their tests.
- Make any minimal durable doc updates required by the landed architecture or verification policy.
- Out of scope:
- Broader assistant refactors unrelated to this target-runtime seam.
- Unrelated scheduler, iMessage-decommission, or hosted runtime work already active in neighboring files.

## Constraints

- Technical constraints:
- Preserve overlapping dirty-tree edits and do not revert unrelated work.
- Keep secrets and operator identifiers out of diffs, logs, fixtures, and commit text.
- Use the current repo-owned completion workflow, including required audit passes.
- Product/process constraints:
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Keep the landing bounded to one turn if feasible.

## Risks and mitigations

1. Risk: The patch touches persisted assistant session/runtime contracts and could break session parsing or resume compatibility.
   Mitigation: Inspect the schema and binding changes directly, add or keep focused compatibility coverage, and capture direct proof for session shape handling.
2. Risk: The patch overlaps active assistant/setup lanes and may conflict with nearby dirty edits.
   Mitigation: Keep the owned write set narrow, read current file context before applying, and avoid reverting or broadening beyond verification-driven fixes.
3. Risk: The runtime-target seam may require matching durable-doc updates if it changes repo-level architecture expectations.
   Mitigation: Compare the landed seam against `ARCHITECTURE.md` and update durable docs only if the current text becomes inaccurate.

## Tasks

1. Inspect the supplied patch and current tree to confirm the exact write set and behavior changes.
2. Land the patch cleanly on top of the current repo state, adjusting only for current-file drift.
3. Run required verification for the touched owners and capture one direct scenario proof for the new target-runtime/session contract.
4. Run the required `coverage-write` and `task-finish-review` audit passes, address findings, and re-run affected checks.
5. Finish the task with a scoped commit via `scripts/finish-task`.

## Decisions

- Use a dedicated execution plan because the patch is cross-cutting, high-risk, and changes persisted assistant/runtime contracts.
- Keep the landing bounded to the supplied patch intent plus minimal compatibility, test, and doc adjustments required by current-tree drift.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/operator-config packages/assistant-engine packages/setup-cli`
- Focused owner coverage commands if `test:diff` is not truthful or is blocked by unrelated pre-existing failures.
- One direct scenario proof for the new session/runtime-target contract.
- Expected outcomes:
- Required touched-owner checks pass, or any unrelated blocker is called out explicitly with failing target and reason.

## Outcome

- Landed the supplied refactor intent with a new `operator-config` target-runtime seam, explicit execution/resume contract threading, and setup/runtime updates across `operator-config`, `setup-cli`, and `assistant-engine`.
- Preserved v5 `resumeState.continuityFingerprint` and `resumeState.resumeKind` when rebuilding runtime provider bindings, so persisted resume compatibility remains the enforced contract after reload.
- Recomputed inferred OpenAI-compatible `presetId` after prompt-driven endpoint edits unless the preset was explicitly provided, preventing stale runtime classification from setup flows.

## Audit follow-up

- `coverage-write` audit pass found no additional gaps beyond the existing verification lane.
- `task-finish-review` found two issues and both are fixed:
1. v5 parsing previously discarded persisted resume contract metadata while rebuilding provider bindings.
2. Prompt-driven setup could previously persist a stale `presetId` after the user changed the endpoint.

## Verification results

- Passed:
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/setup-cli typecheck`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/operator-config test:coverage`
- `pnpm --dir packages/setup-cli test:coverage`
- `pnpm --dir packages/assistant-engine test:coverage`
- Direct proof captured with `pnpm --dir packages/operator-config exec tsx --eval ...` for gateway/runtime resolution and v5 session parsing.
- Not used for signoff:
- Repo-root `pnpm typecheck` was previously blocked by unrelated pre-existing `apps/web/test/hosted-onboarding-*` failures outside this task lane, so signoff used truthful owner verification instead.
Completed: 2026-04-12
