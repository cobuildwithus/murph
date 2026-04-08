# Land follow-up review seam extractions

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the next bounded giant-file composability follow-ups from the 2026-04-08 review without widening behavior or disturbing unrelated active lanes.

## Success criteria

- `packages/operator-config/src/operator-config.ts` delegates self-delivery target logic to a dedicated sibling module while keeping the public facade stable.
- `packages/setup-cli/src/setup-wizard.ts` delegates runtime-status formatting helpers and the stateful Ink app to dedicated sibling modules while keeping `runSetupWizard` as the public wrapper.
- `packages/inboxd/src/kernel/sqlite.ts` delegates row decode and hydration helpers to a dedicated sibling module while remaining the assembly root.
- Focused package verification is green for the touched owners, or any unrelated pre-existing blocker is explicitly recorded.

## Scope

- In scope:
- `packages/operator-config/src/{operator-config.ts,operator-config/self-delivery-targets.ts}`
- `packages/setup-cli/src/{setup-wizard.ts,setup-wizard-runtime-status.ts,setup-wizard-app.ts}`
- `packages/inboxd/src/kernel/{sqlite.ts,sqlite/rows.ts}`
- matching focused tests only where needed
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Out of scope:
- broader assistant-engine or hosted-web review follow-ups
- inboxd search or parse-job extraction beyond the row/hydration seam
- behavior changes to operator config resolution, setup-wizard UX, or inbox runtime behavior

## Constraints

- Preserve unrelated dirty-worktree edits.
- Keep existing public facades stable.
- Prefer review-aligned helper/module extraction over broader rewrites.
- Treat repo-root `pnpm typecheck` as potentially blocked by unrelated workspace build/typecheck drift outside the touched seams.

## Risks and mitigations

1. Risk: The `setup-wizard` app extraction could change event handling or completion behavior.
   Mitigation: Keep `runSetupWizard` as the wrapper, move the nested app with minimal structural change, and extend focused TTY tests only where needed.
2. Risk: The inboxd row split could tangle with broader workspace typecheck or build drift outside the touched seam.
   Mitigation: Limit the move to pure decode/hydration helpers and use package-local verification rather than assuming repo-root typecheck is green.
3. Risk: Dirty-worktree overlap could cause accidental staging beyond this task.
   Mitigation: Keep the lane narrow and use path-scoped commit tooling at the end.

## Tasks

1. Extract self-delivery target normalization/read-write helpers from `operator-config.ts`.
2. Extract setup-wizard runtime-status formatting helpers.
3. Extract the nested setup-wizard Ink app into its own module while preserving the outer wrapper.
4. Extract inboxd row decode and hydration helpers into `rows.ts`.
5. Run focused verification, the required final review pass, and create a scoped commit.

## Decisions

- The two setup-wizard follow-ups will be handled together because they share the same facade file and are not safely parallelizable at the write-set level.

## Verification

- Commands to run:
- `pnpm --dir packages/operator-config typecheck`
- `pnpm --dir packages/operator-config test`
- `pnpm --dir packages/setup-cli typecheck`
- `pnpm --dir packages/setup-cli test:coverage`
- `pnpm --dir packages/inboxd typecheck`
- `pnpm --dir packages/inboxd test`
- `pnpm typecheck`
- Expected outcomes:
- The touched owner packages stay green under focused verification, or any failure is explicitly tied to a credible pre-existing blocker outside the landed diff.

## Outcomes

- Landed `packages/operator-config/src/operator-config/self-delivery-targets.ts` and delegated the public self-delivery target facade from `operator-config.ts`.
- Landed `packages/setup-cli/src/setup-wizard-runtime-status.ts` and `packages/setup-cli/src/setup-wizard-app.ts`, with `setup-wizard.ts` reduced to the public wrapper.
- Landed `packages/inboxd/src/kernel/sqlite/rows.ts` and delegated row decode / hydration helpers from `sqlite.ts`.
- Focused verification results:
- `pnpm --dir packages/operator-config typecheck` ✅
- `pnpm --dir packages/operator-config test` ✅
- `pnpm --dir packages/setup-cli test:coverage` ✅
- `pnpm --dir packages/inboxd typecheck` ✅
- `pnpm --dir packages/inboxd test` ✅
- Recorded blockers:
- `pnpm --dir packages/setup-cli typecheck` fails in untouched `assistant-engine` entrypoint imports and downstream implicit-`any` fallout.
- `pnpm typecheck` fails in untouched `packages/hosted-execution` with `TS6305` against `packages/contracts/dist/index.d.ts`.
Completed: 2026-04-09
