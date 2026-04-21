# Land supplied hosted-run messaging-activity primitive patch

Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Land the supplied hosted-run messaging-activity primitive so hosted messaging activity is shared between runtime and executor, with Cloudflare owning start/stop timing around prepare, commit, and finalize.

## Success criteria

- The supplied five-file patch intent is integrated without widening into unrelated hosted-run or hosted-email work.
- Hosted runtime exports a shared messaging-activity primitive and suppresses its fallback path when the executor claims ownership.
- Cloudflare starts and stops messaging activity around the run-drain lifecycle using the shared primitive.
- Required scoped verification, mandatory audit passes, and a scoped commit complete successfully, or any unrelated red lane is documented with concrete evidence.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/typing.ts`
- `packages/assistant-runtime/src/hosted-runtime-contracts.ts`
- Out of scope:
- Tests outside the directly coupled hosted runtime / Cloudflare verification surface unless required by completion review.
- Unrelated hosted-email retention work, hosted-run finalize fencing, or broader hosted conversation ingestion refactors already tracked by other active rows.

## Constraints

- Technical constraints:
- Preserve the run-centric hosted protocol and existing assistant channel adapter model.
- Do not introduce a new durable lease or provider-specific executor transport abstraction beyond the supplied primitive.
- Product/process constraints:
- Treat this as a narrow supplied patch landing even if current files have drifted since the patch was generated.
- Preserve unrelated worktree edits and coordinate with overlapping active rows touching `runner-run-processor.ts` and hosted runtime files.

## Risks and mitigations

1. Risk: The patch overlaps active hosted-run work and could regress finalize ownership or retention fixes.
   Mitigation: Keep the write scope to the supplied files, inspect current file state before applying, and verify the affected hosted runtime and Cloudflare owners after integration.
2. Risk: Messaging activity could be left running after outbound delivery drains.
   Mitigation: Verify the Cloudflare stop path runs immediately after finalization delivery completion and retains only an idempotent cleanup fallback in `finally`.

## Tasks

1. Register the active plan and coordination-ledger row for the supplied patch landing.
2. Apply the supplied patch intent into the current file state and resolve any integration drift without widening scope.
3. Run required verification for the touched hosted runtime and Cloudflare owners.
4. Complete mandatory `coverage-write` and `task-finish-review` passes, rerun affected checks, then finish with a scoped commit.

## Decisions

- Treat the task as a high-risk supplied patch landing with its own active plan because it crosses runtime and executor ownership boundaries.
- Keep the patch scoped to the supplied five files unless verification or required review exposes a directly coupled proof gap.
- Preserve the prior non-blocking typing-startup behavior inside the new shared messaging-activity primitive so runtime execution does not wait on provider typing startup, while still letting Cloudflare own start/stop timing when it claims executor ownership.
- Update only directly coupled tests when the shared primitive changes their observation seam from provider-specific helpers to the assistant channel adapter surface or the new Cloudflare lifecycle callbacks.
- Short-circuit `RunnerRunProcessor.startRunMessagingActivity()` before any runner env/secret read when the run batch has no supported Linq/Telegram target, matching the intended no-op behavior for timer-only or email-only batches.
- Add focused Cloudflare proof for both the executor-owned activity lifecycle through finalize and the executor-ownership env flag wiring in `RunnerRunProcessor`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/src/hosted-runtime-contracts.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --no-coverage`
- Expected outcomes:
- Typecheck and the truthful diff-aware lane pass for the touched owners, or any unrelated pre-existing blocker is captured with exact failing evidence before handoff.
- Outcome:
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime.ts packages/assistant-runtime/src/hosted-runtime/typing.ts packages/assistant-runtime/src/hosted-runtime-contracts.ts packages/assistant-runtime/test/hosted-runtime-typing.test.ts packages/assistant-runtime/test/hosted-runtime-runner.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts` passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --no-coverage` passed.
- Required audit passes completed:
- `coverage-write` added focused Cloudflare proof in `apps/cloudflare/test/user-runner-resume-finalize.test.ts`.
- Final review found one real production issue and one proof gap in the current slice; both were fixed locally.
- Post-review verification:
- `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts --no-coverage` passed.
- A final repo-wide `pnpm typecheck` rerun after the post-review Cloudflare-only fixes is currently blocked by an unrelated long-running shared workspace lock held by `apps/web verify`; the earlier full `pnpm typecheck` pass succeeded before those Cloudflare-only review fixes, and the focused Cloudflare reruns above cover the post-review diff.
Completed: 2026-04-21
