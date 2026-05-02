# Cloudflare Greenfield Compatibility Removal

## Goal

Remove the temporary Cloudflare hosted deploy compatibility surfaces now that the hosted runtime is treated as greenfield.

Success criteria:

- The deploy workflow requires canonical hosted crypto Cloudflare automation names directly, with no legacy production fallback.
- The Worker has no legacy runner wake Queue handler, module, or Queue-specific test scaffolding.
- Focused Cloudflare tests, typecheck, required reviews, and scoped verification pass or any unrelated blocker is named precisely.
- The scoped change is committed without including unrelated dirty work.

## Constraints / Assumptions

- Preserve unrelated active work in the dirty tree.
- Do not print or commit secrets, private JWKs, `.env`, `.env.local`, or `.dev.vars` contents.
- The greenfield runner trigger remains direct Durable Object nudge plus Durable Object alarm recovery.
- Historical completed plan snapshots are immutable and should not be edited.

## Key Decisions

- Remove the deploy migration bridge instead of keeping alias compatibility.
- Delete the retained legacy Queue drain path entirely; Cloudflare account cleanup is treated as environment setup, not runtime behavior.

## State

completed

## Done

- Confirmed the exact compatibility files are clean in the worktree before edits.
- Confirmed current architecture docs already describe no Cloudflare Queue wake executor or fallback.
- Removed the deploy workflow fallback to legacy hosted execution automation recipient names.
- Deleted the legacy runner wake Queue module, Worker handler export, Queue contract types, and Queue tests.
- Added focused guard coverage for canonical deploy env names and absence of Worker Queue handler/contracts.
- Passed `pnpm --dir apps/cloudflare typecheck`.
- Passed full `apps/cloudflare` Node Vitest workspace through `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/index.test.ts apps/cloudflare/test/deploy-automation.test.ts`.
- Passed `pnpm --dir apps/cloudflare verify`.
- Passed targeted `bash scripts/workspace-verify.sh test:diff ...` for this working set; the command printed a transient unrelated `output-packages/research/tmp-*` scan race but exited successfully.
- Passed root `pnpm typecheck`.
- Required security/privacy review found no findings.
- Required coverage-write pass made no changes and found proof sufficient.
- `pnpm verify:acceptance` failed before coverage on pre-existing doc-gardening issues.
- Root `pnpm test` failed in unrelated CLI test buckets with subprocess timeouts and missing built CLI artifact symptoms.
- The scoped Cloudflare hard-cut was committed at `e2cc939ad` before plan archival.
- Required final completion review found no findings.
- Archived the active plan and removed the matching ledger row.

## Now

- Completed.

## Next

- None.

## Open Questions

- None.

## Working Set

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/legacy-runner-wake-queue.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
