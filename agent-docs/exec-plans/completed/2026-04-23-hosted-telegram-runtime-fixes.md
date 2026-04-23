# Land hosted Telegram cleanup, partial-send, business-delete, and pending-cleanup durability fixes

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the five reported hosted Telegram and pending-cleanup regressions without widening beyond the directly coupled Cloudflare runner, assistant outbox/channel runtime, Telegram runtime, and focused regression tests.

## Success criteria

- Hosted Telegram cleanup never retargets deletes across unrelated chats and only rewrites true migrate-to-chat-id cases through explicit delivery-carried alias mapping.
- Partial Telegram multi-chunk sends either roll back already-sent chunks or surface an ambiguous-success error with preserved provider ids/target so outbox retries do not duplicate blindly.
- Telegram business-account cleanup uses `deleteBusinessMessages` for business targets and preserves batching behavior.
- Pending-cleanup sidecar read/write/clear paths are fully best-effort and never fail a committed/finalized run or block same-request finalize from using in-memory cleanup wakes.
- Clearing pending cleanup deletes the storage key instead of leaving a tombstone.
- Focused regression tests cover each issue and the required verification/audit passes are completed.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- `apps/cloudflare/test/runner-run-processor.test.ts`
- `apps/cloudflare/test/user-runner-resume-finalize.test.ts`
- `packages/assistant-engine/src/assistant/channels/runtime.ts`
- `packages/assistant-engine/src/assistant/outbox.ts`
- `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`
- focused `packages/assistant-engine/test/**` coverage for Telegram runtime/outbox partial-send behavior
- `packages/operator-config/src/telegram-runtime.ts`
- `packages/operator-config/test/runtime-helpers.test.ts`
- directly coupled `packages/assistant-runtime/src/hosted-runtime/{message-cleanup,models,callbacks}.ts` only if needed for hosted delivery metadata plumbing
- Out of scope:
- Broader hosted typing/nudge/notification work already active in adjacent rows
- New provider channels or non-Telegram cleanup policy changes
- Unrelated assistant-engine transport idempotency redesign outside the Telegram partial-send lane

## Constraints

- Technical constraints:
- Preserve current channel/runtime contracts where possible; widen schemas only when explicit Telegram migration or partial-send metadata is required to make cleanup safe.
- Prefer leaking cleanup over deleting the wrong Telegram message.
- Keep sidecar storage failures warn-and-continue only; do not weaken commit/finalize invariants themselves.
- Product/process constraints:
- Preserve unrelated dirty-tree edits and active ledger rows.
- Treat this as a high-risk repo change: scoped plan, ledger row, truthful verification, required `coverage-write`, required `task-finish-review`, and scoped commit if staging can stay exact.

## Risks and mitigations

1. Risk: explicit Telegram migration mapping needs extra delivery metadata and can drift between assistant-runtime and Cloudflare cleanup consumers.
   Mitigation: add typed metadata only where the existing outcome shape already carries delivery facts, and cover migrate plus multi-chat cleanup with focused tests.
2. Risk: best-effort rollback of partially sent Telegram chunks can mask the original failure or leave outbox state inconsistent.
   Mitigation: preserve the original cause, final target, and sent ids on the thrown error when rollback is incomplete; test rollback-success and rollback-failure branches.
3. Risk: sidecar-storage changes overlap heavily with existing Cloudflare runner logic.
   Mitigation: keep overlap integration on the parent thread, use subagents on bounded lanes, and rerun focused Cloudflare proof after integration.

## Tasks

1. Register the task in the coordination ledger, then spawn five `gpt-5.4` `xhigh` issue workers with bounded ownership.
2. Land Telegram business-delete branching plus focused runtime-helper tests.
3. Land Telegram partial-send ambiguity/rollback handling plus focused assistant-engine tests and any required hosted-delivery metadata plumbing.
4. Land pending-cleanup sidecar deletion semantics and best-effort read/write/clear handling, plus Cloudflare resume/finalize regression coverage.
5. Land safe Telegram cleanup-target mapping for multi-chat and migration cases plus focused Cloudflare cleanup tests.
6. Integrate overlaps locally, run truthful verification and direct scenario proof, then complete required audit passes and a scoped commit.

## Decisions

- Use explicit per-delivery Telegram target migration provenance instead of the existing global singleton-target heuristic.
- Keep same-request finalize driven by in-memory `cleanupWakes` even when sidecar persistence fails, because post-commit sidecar storage is an optional recovery aid rather than a commit precondition.
- Add a real storage `delete` operation instead of tombstoning transient cleanup state with `null`.
- Carry Telegram `cleanupTargetAliases` through assistant delivery metadata so hosted cleanup can safely rewrite only exact proven old-target aliases, including `failed_ambiguous` partial-send outcomes that preserved provider ids.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts packages/assistant-engine/src/assistant/channels/runtime.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/src/assistant/outbox/dispatch-state.ts packages/assistant-engine/test/assistant-channels-runtime.test.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts packages/assistant-engine/test/assistant-outbox-thresholds.test.ts packages/operator-config/src/telegram-runtime.ts packages/operator-config/test/runtime-helpers.test.ts`
- Focused Vitest runs for the touched Cloudflare, assistant-engine, and operator-config tests during iteration
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- All five reported regressions have focused proof, with no remaining unsafe Telegram retargeting heuristic and no post-commit/finalize failure path from transient cleanup sidecar I/O.
- Actual results:
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-channels-runtime.test.ts test/assistant-outbox-runtime.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-callbacks.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-run-processor.test.ts test/user-runner-resume-finalize.test.ts test/runner-state-store.bundle-slots.test.ts test/index-backpressure.test.ts --no-coverage` passed.
- `pnpm typecheck` currently fails for the unrelated pre-existing `apps/cloudflare/test/runner-bundle-helpers.test.ts` mock type missing `deleteBundle` on `HostedBundleStore`.
- `git diff --check` passed.
- `bash scripts/workspace-verify.sh test:diff ...` still fails on the pre-existing unrelated `packages/assistant-engine/test/assistant-wrapper-exports.test.ts` expectation that `executeCodexPrompt` is exported.
Completed: 2026-04-23
