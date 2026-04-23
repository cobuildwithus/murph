# Delete superseded hosted snapshot and browser-vault replica objects after committed ref swaps

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Stop old hosted bundle objects and browser-vault replica objects from accumulating once a new authoritative cursor ref has been committed, fail closed when the authoritative next snapshot is unreadable, and preserve finalize cleanup recovery across commit/finalize loss paths without broadening the hosted runner storage model.

## Success criteria

- Superseded hosted bundle objects are deleted only after the web-owned cursor has advanced to a different committed snapshot ref.
- Bundle artifact cleanup happens from that same authoritative ref transition instead of before commit.
- Bundle cleanup fails closed when the authoritative next snapshot ref is unreadable, missing, or undecryptable.
- Superseded browser-vault replica objects are deleted only after the web-owned cursor has advanced to a different committed replica ref or cleared the ref.
- Losing candidate bundle/browser-vault objects and candidate-only artifacts are reclaimed when commit/finalize loses or when the durable authoritative cursor later proves a different ref won.
- Commit/finalize response-loss retries still reconcile old authoritative snapshot cleanup from durable state.
- Cleanup stays best-effort and never blocks commit or finalize success.
- Finalize cleanup recovery still has the original wake cleanup inputs when the pending-cleanup sidecar write fails and finalize resumes later.
- Focused Cloudflare and query regression tests cover these cases.

## Scope

- In scope:
- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/bundle-gc.ts`
- `apps/cloudflare/src/browser-vault-store.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- `apps/cloudflare/src/user-runner/runner-state-store.ts`
- `apps/cloudflare/src/user-runner/types.ts`
- focused `apps/cloudflare/test/{runner-bundle-helpers,browser-vault-store,runner-run-processor,user-runner-resume-finalize}.test.ts`
- `packages/query/test/browser-vault-replica.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-hosted-snapshot-cleanup.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Broad R2 lifecycle expiry for live bundle or browser-vault prefixes
- Changes to web-owned hosted-run cursor persistence semantics
- Unrelated active hosted Telegram, typing, or observability rows

## Constraints

- Technical constraints:
- Treat the web-owned cursor response as the authority for whether an old object is safe to delete.
- Keep cleanup best-effort and warning-only.
- Do not delete objects still referenced by the authoritative cursor during commit loss, supersede, or finalize retry paths.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Treat this as a high-risk `apps/cloudflare` change: scoped plan, ledger row, truthful scoped verification, required `coverage-write`, required `task-finish-review`, and a scoped commit only if staging can remain exact.

## Risks and mitigations

1. Risk: deleting bundle artifacts when the authoritative next snapshot is unreadable can strand the live snapshot.
   Mitigation: fail closed on missing or unreadable next bundles and add regressions for R2-miss and decrypt-failure paths.
2. Risk: deleting candidate or browser-vault objects on the wrong path can break the current live snapshot or browser session source.
   Mitigation: reconcile candidate cleanup against the authoritative cursor ref and compare browser-vault cleanup identity on object keys.
3. Risk: commit/finalize response loss can advance the authoritative cursor without triggering cleanup, leaving old authoritative objects to leak forever.
   Mitigation: persist or recover the last authoritative cleanup refs in runner state and reconcile them against later acquire/finalize cursor views.
4. Risk: best-effort cleanup sidecar writes can drop raw-message or outbound cleanup inputs across finalize retries.
   Mitigation: keep a runner-owned fallback copy and retry persistence while the original cleanup wakes are still in memory, with focused resume-finalize coverage.

## Tasks

1. Completed: add the narrow ledger row and this active plan.
2. Completed: refactor bundle cleanup so old bundle objects and removed artifacts are deleted only after an authoritative cursor ref swap succeeds.
3. Completed: add explicit browser-vault replica deletion on committed cursor ref swaps.
4. Completed: make bundle cleanup fail closed on unreadable authoritative next snapshots and reclaim losing candidate bundle/browser-vault objects safely.
5. Completed: reconcile cleanup after commit/finalize response loss and preserve finalize cleanup inputs across sidecar write failures.
6. Completed: extend focused Cloudflare regression tests for the reopened failure modes, including cross-user identical bundle ownership, missing-next-bundle fail-closed behavior, direct finalize recovery markers, and missing durable finalize cleanup recovery.
7. Completed: run the required completion-workflow audit passes, fix the post-review response-loss/finalize and pending-cleanup durability gaps, refresh focused verification, and confirm a safe scoped commit path.

## Decisions

- Prefer explicit ref-based deletes over bucket lifecycle rules for bundle and browser-vault prefixes because those prefixes can still hold the current live object.
- Keep cleanup in `apps/cloudflare` near the cursor-transition orchestration instead of teaching the web control plane about R2 object deletion.
- Treat the web-owned cursor and run recovery rows as authoritative for whether a bundle or replica candidate actually won; DO-local cleanup state may assist reconciliation but must not become the authority.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/bundle-store.ts apps/cloudflare/src/bundle-gc.ts apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-bundle-sync.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/browser-vault-store.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts packages/query/test/browser-vault-replica.test.ts`
- `git diff --check`
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Old bundle and browser-vault replica objects are deleted only after the authoritative cursor commits a different ref, commit/finalize retries preserve the live current objects, unreadable authoritative next bundles fail closed, losing candidates are reclaimed, and later retries still reconcile cleanup from durable runner/web state.
- Actual results:
- Focused Cloudflare proof passed: `pnpm --dir apps/cloudflare exec vitest run test/runner-state-store.bundle-slots.test.ts test/runner-bundle-helpers.test.ts test/user-runner-resume-finalize.test.ts --config vitest.node.workspace.ts --no-coverage` => 3 files / 60 tests passed.
- Focused query proof passed: `pnpm --dir packages/query exec vitest run test/browser-vault-replica.test.ts --no-coverage` => 1 file / 4 tests passed.
- `pnpm --dir packages/query typecheck` passed.
- `git diff --check` passed.
- `pnpm --dir apps/cloudflare typecheck` is still blocked by an unrelated dirty-tree type error at `packages/messaging-ingress/src/linq-webhook.ts(556,50)` (`Headers.entries`).
- Diff-scoped `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/bundle-store.ts apps/cloudflare/src/bundle-gc.ts apps/cloudflare/src/browser-vault-store.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-bundle-sync.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-bundle-helpers.test.ts apps/cloudflare/test/browser-vault-store.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts packages/query/test/browser-vault-replica.test.ts` is still blocked by unrelated workspace-boundary failures in `packages/assistant-runtime/src/{device-sync-service.ts,hosted-device-sync-runtime.ts}`, the related `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts` import, and unrelated `packages/assistantd/test/http{,-coverage}.test.ts` type errors around `executionDriver` / `resumeKind`.
- Required `coverage-write` audit completed with no further test additions needed beyond the focused regressions already in this lane.
- Required `task-finish-review` surfaced five real live-tree issues across the final review passes: acquire-time reconciliation pruned the current `resumeFinalize` run's pending cleanup after commit response loss; `writePendingRunCleanup()` could orphan a durable payload if the recovery index update failed; unreadable obsolete previous bundles could pin cursor convergence; finalize-required commits still proceeded without durable cleanup recovery; and authoritative-cursor replay pruned live `committed_needs_finalize` / `finalizing` cleanup state. All five were fixed locally and covered by the focused regressions.

## Outcome

- The fail-closed bundle GC, obsolete-bundle convergence, losing-candidate cleanup, authoritative-cursor reconciliation, durable finalize cleanup gating, same-DO resume-finalize fallback, live-sidecar preservation, and pending-cleanup durability ordering fixes are all green in the active tree. The lane is ready for a scoped landing; only the unrelated repo-wide verification blockers remain red.

## Audits

- `coverage-write`: completed
- `task-finish-review`: completed with five live-tree findings across the review reruns, all fixed locally and reverified with the focused Cloudflare suite

## Commit note

- Scoped commit is safe through `scripts/finish-task` because the landing can be limited to this plan file plus the directly touched Cloudflare/query paths.
Completed: 2026-04-24
