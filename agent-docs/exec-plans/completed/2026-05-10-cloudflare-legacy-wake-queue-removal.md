# Remove legacy Cloudflare wake Queue consumer

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Remove the retained Cloudflare runner wake Queue compatibility path so hosted execution has one runner trigger surface again: direct Durable Object nudge plus Durable Object alarm recovery.

## Success criteria

- The live `murph-hosted-runner-wake` Queue has no Worker consumer attached before code removal.
- The Worker has no legacy Queue handler, module, or Queue-specific tests.
- The repo still declares no Cloudflare Queue producer/consumer config.
- Focused Cloudflare verification, required audits, and direct live-consumer proof pass.

## Scope

- In scope:
  - Detach the live retained `murph-hosted-runner-wake` consumer from `murph-hosted`.
  - Remove `apps/cloudflare` legacy Queue drain code and tests.
  - Keep deploy/config guards that prove no `queues` config is reintroduced.
- Out of scope:
  - Changing direct runner nudge behavior.
  - Changing Durable Object alarm/retry behavior.
  - Adding any replacement queue, mailbox, or dispatch surface.

## Constraints

- Technical constraints:
  - Remove the remote consumer before deleting the Worker `queue()` handler so the next deploy is not rejected by Cloudflare.
  - Preserve direct Durable Object nudge and alarm recovery as the only runner trigger surfaces.
  - Do not print account ids, tokens, secrets, private JWKs, `.env`, `.env.local`, or `.dev.vars` contents.
- Product/process constraints:
  - Preserve unrelated active ledger rows and dirty worktree edits.
  - Historical completed plan snapshots are immutable.

## Risks and mitigations

1. Risk: deleting the Worker `queue()` handler while Cloudflare still has a remote consumer can break deploys.
   Mitigation: remove the live consumer first and re-query consumer count before code deletion.
2. Risk: removing the shim could strand old queued wake messages.
   Mitigation: treat the Queue as legacy-only; confirm there is no active producer in repo config/code and remove the remote consumer only after explicit user approval in this task.

## Tasks

1. Confirm current live Queue consumer state.
2. Remove the live retained Queue consumer.
3. Confirm consumer count is zero.
4. Delete legacy Queue handler/module/tests and stale imports/types.
5. Run focused Cloudflare verification and required audits.
6. Finish with a scoped commit.

## Decisions

- The greenfield hosted runner path does not use Cloudflare Queues; the retained Queue consumer is operational compatibility residue only.
- Do not delete the Worker `queue()` handler while the remote consumer still exists.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare exec wrangler queues consumer list murph-hosted-runner-wake --json`
  - `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/index.test.ts apps/cloudflare/test/deploy-automation.test.ts`
  - `pnpm --dir apps/cloudflare verify`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - `pnpm typecheck`
- Expected outcomes:
  - Live Queue consumer count is zero after removal.
  - Cloudflare tests/typecheck/verify pass, or any unrelated blocker is named precisely.

## Status notes

- Confirmed live `murph-hosted-runner-wake` still has one Worker consumer attached to `murph-hosted`.
- `wrangler queues consumer remove murph-hosted-runner-wake murph-hosted` is blocked by the current token before deletion.
- Direct Cloudflare API deletion of the exact Queue consumer is also blocked with HTTP 403.
- The user removed the consumer and then deleted the empty Queue from the Cloudflare UI.
- Follow-up Wrangler checks now report `murph-hosted-runner-wake` does not exist, so repo code removal can proceed.
- Removed the Worker `queue()` export, legacy Queue drain module, Queue-only contract types, and Queue-specific tests.
- Passed direct focused Vitest after coverage audit changes: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts apps/cloudflare/test/deploy-automation.test.ts`.
- Passed residue scan over `apps/cloudflare/src`, `apps/cloudflare/scripts`, and `apps/cloudflare/wrangler.jsonc` for legacy Queue identifiers.
- Passed `git diff --check` on touched files.
- Passed direct live proof after user deletion: `wrangler queues info murph-hosted-runner-wake` reports the Queue does not exist.
- Blocked unrelated: `pnpm --dir apps/cloudflare typecheck`, `pnpm --dir apps/cloudflare verify`, scoped `test:diff`, and root `pnpm typecheck` fail in unrelated active dirty `apps/cloudflare/src/user-runner.ts` typing work.
- Required security/privacy review: no findings.
- Required coverage-write pass added guard assertions in `apps/cloudflare/test/index.test.ts`; focused tests re-passed after the edit.
- Required task-finish review: no findings.
Completed: 2026-05-10
