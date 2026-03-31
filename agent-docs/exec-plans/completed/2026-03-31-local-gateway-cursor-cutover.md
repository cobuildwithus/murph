# Finish local inbox-to-gateway cursor cutover

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Finish the local inbox-to-gateway refactor by making local capture sync fully cursor-backed, so `@murph/gateway-core` incrementally consumes inboxd's durable capture mutation cursor and keeps full rebuilds only for bootstrap or recovery.

## Success criteria

- `packages/inboxd` durably records a local capture mutation cursor that advances on capture inserts and capture-affecting updates.
- `packages/gateway-core` replaces the local capture-signature sync shim with cursor-driven incremental capture sync while keeping rebuild fallback behavior.
- Relevant docs describe the cursor-backed local gateway shape accurately.
- Required verification and audit passes complete, or any unrelated blocker is named precisely with supporting evidence.

## Scope

- In scope:
- Land the supplied implementation patch across inboxd and gateway-core.
- Land the supplied docs patch across architecture and package READMEs.
- Update or carry any focused tests needed for the new cursor behavior.
- Out of scope:
- Assistant session and outbox sync model changes.
- Hosted gateway behavior changes beyond durable-doc wording where the shared architecture summary needs updating.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree edits already present in the repo.
- Treat the supplied patches as intent; inspect the landed diff before verification.
- Keep full projection rebuild behavior as the bootstrap and recovery path.
- Product/process constraints:
- This is a high-risk cross-cutting repo change, so it uses the full audit path and repo baseline verification unless blocked for an unrelated reason.

## Risks and mitigations

1. Risk: Incremental cursor sync could miss capture-affecting mutations and serve stale gateway records.
   Mitigation: Land the inboxd cursor storage and mutation recording together with the gateway incremental-consumer logic, keep full rebuild fallback, and run focused coverage plus repo baseline checks.
2. Risk: The current dirty worktree could hide overlap with adjacent inboxd or gateway work.
   Mitigation: Keep the ledger row narrow but mark the cursor-cutover files exclusive, inspect landed diffs carefully, and avoid touching unrelated active lanes.

## Tasks

1. Register the active lane in the coordination ledger and keep this plan current.
2. Apply the supplied implementation and docs patches, then inspect the landed diffs for drift from current tree state.
3. Run required verification for the touched subsystems and capture direct evidence for the local cursor-backed sync path where practical.
4. Run the required `simplify` and `task-finish-review` audit passes, address findings, and re-run affected checks.
5. Close the plan with a scoped commit via the repo helper.

## Decisions

- Use a dedicated active plan despite the supplied patch origin because the change is multi-file and modifies local storage/sync behavior.
- Keep assistant session and outbox sync on their existing signature model; only local capture sync moves to the durable inboxd cursor in this landing.
- Drop the unrelated AgentMail HTTP-error parsing cleanup from the supplied patch and keep the cursor schema to `mutation_cursor` plus the counter table only.
- Keep the `./linq-webhook` and `./telegram-webhook` inboxd exports because the current `apps/web` worktree already imports those public subpaths; only the extra sqlite-warning test expansion was cut from this landing.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Repo baseline passes, or any unrelated blocker is documented with the exact failing command and target.
- Actual outcomes:
- `pnpm typecheck` passed.
- `pnpm test:coverage` passed.
- `pnpm test:packages:coverage` passed after the simplify trims and remained green after the final proof-gap test addition.
- `pnpm --dir packages/inboxd exec vitest run test/inboxd.test.ts test/idempotency-rebuild.test.ts --no-coverage` passed after fixing the legacy migration/index-order regression and the missing `DatabaseSync` value import in the new cursor test.
- `pnpm --dir packages/cli exec vitest run test/gateway-local-service.test.ts --no-coverage --maxWorkers 1` passed after adding an explicit legacy-store rebuild regression test for a missing `captures.cursor` meta row.
- `pnpm test` remains blocked by an unrelated docs-drift guard because concurrent dirty files under `agent-docs/operations/verification-and-runtime.md` and `agent-docs/references/testing-ci-map.md` require a matching `agent-docs/index.md` update outside this task.
- Direct scenario proof: a temp-vault `pnpm exec tsx` script showed gateway meta `captures.cursor` advancing from `1` to `2` after a direct inbox capture rewrite, while the projected title/text changed from `Old title` / `Original capture text` to `Rewritten title` / `Rewritten capture text`.
Completed: 2026-03-31
