# 2026-03-30 Inbox Capture Ledger

## Goal

- Land the supplied inbox-capture ledger patch so inbox ingestion persists a first-class canonical capture ledger alongside raw evidence, compatibility note events, and import audits.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-inbox-capture-ledger.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `packages/core/src/index.ts`
- `packages/contracts/src/{constants.ts,zod.ts,schemas.ts,examples.ts}`
- `packages/contracts/scripts/verify.ts`
- `packages/contracts/generated/inbox-capture-record.schema.json`
- `packages/inboxd/src/{index.ts,indexing/persist.ts,kernel/pipeline.ts}`
- `packages/inboxd/test/{inboxd.test.ts,idempotency-rebuild.test.ts}`
- `packages/inboxd/README.md`
- `README.md`
- `ARCHITECTURE.md`
- `docs/{architecture.md,contracts/01-vault-layout.md}`

## Findings

- The current worktree is dirty with many unrelated active lanes; this patch overlaps live edits only in `packages/contracts/src/zod.ts`.
- The supplied patch applies cleanly against the current tree, so the main integration risk is preserving adjacent local contract changes while landing the new inbox-capture ledger behavior.
- The first full `pnpm test` attempt exposed a real regression from this patch: hosted email thread targets can exceed the new `inbox-capture-record.thread.id` 255-character bound. Widening that field to 4000 and regenerating the schema artifact fixed the failing hosted email ingestion tests.
- Repo-wide `pnpm test` remained noisy after the fix because unrelated workspace build/test retries hit existing WIP instability in untouched areas such as `packages/core/src/{ids.ts,operations/canonical-write-lock.ts}` and `packages/assistant-runtime/src/hosted-runtime/*`. The user explicitly said not to worry about the broader WIP blocking this patch.

## Constraints

- Preserve unrelated in-flight edits already present in the worktree and any overlapping active lanes recorded in the coordination ledger.
- Treat the supplied patch as intent, not overwrite authority: read current file state first and keep the implementation scoped to the canonical inbox-capture ledger change plus direct regressions.
- Run the required repo verification commands after implementation unless blocked by unrelated pre-existing failures.
- Because this touches repo code and tests, run the required `simplify` then `task-finish-review` audit passes before handoff.

## Plan

1. Register the inbox-capture ledger lane in the coordination ledger and inspect the patch scope against the live tree.
2. Land the contract, core export, inbox persistence, pipeline, and docs changes while preserving the existing dirty worktree.
3. Run focused inbox/contracts verification to catch direct regressions quickly.
4. Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`, then classify and fix any failures caused by this patch.
5. Run the required audit subagents, address findings, close the lane, and commit only the touched files.

## Verification

- Passed:
  - `pnpm --dir packages/contracts generate`
  - `pnpm --dir packages/contracts typecheck`
  - `pnpm --dir packages/core typecheck`
  - `pnpm --dir packages/inboxd typecheck`
  - `pnpm --dir packages/inboxd test`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/node-runner.test.ts -t 'fetches raw hosted email through the email worker bridge when processing inbound email events|persists hosted stable-alias email captures with Reply-To-based thread targets'`
  - `pnpm typecheck`
- Blocked / non-blocking WIP:
  - `pnpm test`
    - initial deterministic failure fixed by widening `inbox-capture-record.thread.id`
    - later retries still encountered unrelated intermittent workspace build failures in untouched packages during wrapper retries
  - `pnpm test:coverage`
    - started, then interrupted while the broader WIP-heavy workspace was still unstable and the user said not to worry about blocking issues
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
