# Hosted message zero-retention cleanup for Linq and Telegram

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Delete hosted inbound Linq and Telegram messages after a hosted run commits successfully.
- Delete hosted outbound assistant Linq and Telegram bot messages after successful post-commit delivery drain.
- Keep hosted-web ingress payload cleanup intact and avoid leaving extra provider message residue in the final hosted bundle.

## Success criteria

- Cloudflare best-effort cleanup deletes inbound Linq messages with the Linq Partner API and inbound Telegram messages with the Telegram Bot API after the run reaches `completed`.
- Successful outbound assistant deliveries expose enough provider ids to delete all sent Linq and Telegram messages, including multi-chunk Telegram replies.
- Cleanup failures do not fail the hosted run, but they are logged with enough context for manual follow-up.
- Focused verification and direct scenario proof cover Linq and Telegram cleanup behavior, or any unrelated pre-existing failure is called out explicitly.
- Required completion audits run before handoff, and the final scoped commit contains only this task's files plus plan/ledger closeout.

## Scope

- In scope:
  - `packages/operator-config/src/{linq-runtime.ts,telegram-runtime.ts}`
  - `packages/operator-config/test/**` directly coupled to the new delete helpers
  - `packages/operator-config/src/assistant-cli-contracts.ts`
  - `packages/assistant-engine/src/assistant/channels/{runtime.ts,types.ts,helpers.ts}`
  - `packages/assistant-runtime/src/hosted-runtime/{callbacks.ts,models.ts}`
  - `apps/cloudflare/src/{user-runner.ts,user-runner/runner-run-processor.ts}`
  - directly coupled Cloudflare tests and hosted-local Linq/Telegram e2e helpers/tests
  - plan/ledger bookkeeping for this task
- Out of scope:
  - broader hosted inbox/transcript retention redesigns beyond the exact Linq/Telegram post-commit cleanup lane
  - AgentMail or Cloudflare email retention changes
  - non-hosted local inbox/runtime behavior

## Constraints

- Preserve unrelated dirty-tree edits and overlapping active rows, especially the active hosted typing work in nearby Cloudflare files.
- Treat Telegram deletion as a deliberate zero-retention choice: Telegram Bot API deletion removes messages from the actual chat, unlike Linq's API-only delete.
- Keep cleanup best-effort and replay-safe. Successful commit/finalize must not be rolled back because a provider delete fails.

## Risks and mitigations

1. Risk: Telegram long replies can fan out into multiple `sendMessage` calls, and deleting only the last message id would leave residue.
   Mitigation: widen the persisted delivery receipt to carry all provider message ids and delete every recorded Telegram message id after finalize.

2. Risk: provider cleanup failures could mask the real run outcome or make finalize flaky.
   Mitigation: run cleanup after successful commit/finalize, swallow failures into structured warnings, and keep the cleanup path idempotent where possible.

3. Risk: overlapping edits in `apps/cloudflare/src/user-runner.ts` and related files could conflict with the active typing lane.
   Mitigation: keep the user-runner change narrowly focused on the post-completion cleanup handoff and merge carefully on top of current file state.

## Tasks

1. Register the active plan and ledger row.
2. Extend the assistant delivery receipt/outcome shape to retain all Telegram provider message ids needed for cleanup.
3. Add Linq and Telegram delete helpers in the shared vendor runtime helpers.
4. Wire Cloudflare post-completion cleanup for inbound and outbound Linq/Telegram messages.
5. Add focused unit coverage plus hosted-local Linq/Telegram e2e proof for the cleanup requests.
6. Run truthful scoped verification, required audits, and finish through the scoped commit flow.

## Decisions

- Reuse the existing Cloudflare post-completion cleanup seam rather than inventing a second finalize callback path for vendor message deletion.
- Treat provider delete 404/not-found style outcomes as benign cleanup races where the helper can prove the resource is already gone or unavailable, while still surfacing other failures as warnings.

## Current state

- Implemented the Linq and Telegram provider delete helpers and routed them through a new assistant-runtime-owned cleanup wrapper so Cloudflare can reuse them without a forbidden package-edge import.
- Extended hosted delivery outcomes to retain `providerMessageIds` so multi-chunk Telegram replies can be deleted completely after successful finalize.
- Wired the Cloudflare post-commit/post-finalize cleanup seam to:
  - keep deleting raw hosted email objects
  - delete inbound Linq/Telegram message ids from the consumed wakes
  - delete outbound Linq/Telegram message ids from successful assistant delivery outcomes
- Added a transient runner-side cleanup sidecar so finalize resumes can still delete wake-derived email/Linq/Telegram artifacts after `committed_needs_finalize`, then clear that sidecar once cleanup finishes.
- Canonicalized Telegram cleanup targets so migrated chats reuse the sent target when Telegram changes the chat id mid-delivery.
- Added focused unit coverage for the new runtime helpers and Cloudflare cleanup seam plus hosted-local Linq/Telegram test assertions covering provider delete requests at the test boundary.
- Required `simplify`, `coverage-write`, and `task-finish-review` audits all ran. Review findings were fixed locally and the affected focused checks were rerun successfully.

## Verification

- Completed:
  - `pnpm exec vitest run test/http-linq-device-runtime.test.ts test/runtime-helpers.test.ts --no-coverage` in `packages/operator-config`
  - `pnpm exec vitest run test/assistant-channels-runtime.test.ts test/channel-helpers.test.ts --config vitest.config.ts --no-coverage` in `packages/assistant-engine`
  - `pnpm exec vitest run --config vitest.node.workspace.ts test/runner-run-processor.test.ts test/user-runner-resume-finalize.test.ts --no-coverage` in `apps/cloudflare`
  - `pnpm --filter @murphai/operator-config typecheck && pnpm --filter @murphai/assistant-runtime typecheck && pnpm --filter @murphai/cloudflare-runner typecheck`
  - `git diff --check -- <task paths>`
  - required `simplify`, `coverage-write`, and `task-finish-review` audit passes
- Blocked by unrelated pre-existing failures:
  - the latest `bash scripts/workspace-verify.sh test:diff ...` run clears the task-local package/app checks and then fails in unrelated `packages/vault-usecases` typecheck work because that package cannot currently resolve `@murphai/contracts` and has several existing descriptor/type errors outside this diff.
  - `pnpm test:e2e:linq-delivery:local` is blocked during the runner bundle build by the existing `packages/assistant-engine/src/assistant/providers/codex-cli.ts` `AssistantApprovalPolicy` export error.
- Direct proof status:
  - Focused hosted-local Linq/Telegram first-contact test files now contain assertions that the local provider stubs receive the cleanup delete requests for inbound and outbound message ids.
  - A clean full hosted-local rerun still needs the unrelated assistant-engine bundle/build failure to be fixed elsewhere; a prior skip-bundle attempt also hung during setup and was manually terminated.
- Remaining before handoff:
  - scoped `scripts/finish-task` commit
Completed: 2026-04-23
