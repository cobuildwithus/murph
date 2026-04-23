## Title

Reject stale hosted wakes before Cloudflare invokes runtime execution.

## Goal

Prevent Cloudflare from decrypting or executing a fetched wake after web has already invalidated that fetched proof through cursor-fence or wake-identity changes.

## Scope

- `apps/web/src/lib/hosted-wake/store.ts`
- `apps/web/app/api/internal/hosted-wake/status/route.ts`
- `packages/hosted-execution/src/{contracts,parsers}.ts`
- `apps/cloudflare/src/{user-runner,web-control-plane}.ts`
- focused hosted-wake tests under `apps/web/test/**` and `apps/cloudflare/test/**`

## Constraints

- Keep the change narrow to pre-execution validation; do not broaden into finalize-proof or other hosted-wake trust-boundary work already in flight.
- Reuse the existing web-owned cursor-fence and wake-identity validation logic instead of introducing a second correctness model in Cloudflare.
- Preserve overlapping dirty-tree edits in hosted-wake files and integrate on top of them.
- Ensure stale fetched wakes fail before `wakeProcessor.executeWake(...)`, leaving no new DO-local pending commit behind.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts apps/web/src/lib/hosted-wake/store.ts apps/web/app/api/internal/hosted-wake/status/route.ts apps/web/test/hosted-wake-{store,routes}.test.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/web-control-plane.ts apps/cloudflare/test/{user-runner-hosted-wake,web-control-plane}.test.ts`
- Direct focused proof now green:
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-wake-store.test.ts -t "reports stale fetched wake proofs before runtime execution when the wake identity was rewritten"`
  - `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-wake-routes.test.ts -t "validates fetched wake proof currency when status includes the wake proof triple"`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/web-control-plane.test.ts -t "reads canonical hosted wake status from the web control plane"`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-hosted-wake.test.ts -t "rejects a stale fetched wake before runtime invocation and refetches the replacement"`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/user-runner-hosted-wake.test.ts -t "clears a stale pending commit and refetches when terminal receipt recording loses the fetch fence"`

## Current status

- Implementation complete: Cloudflare now revalidates fetched-wake proof currency with web before runtime invocation and rejects stale wakes before `wakeProcessor.executeWake(...)`.
- Web now exposes a proof-currency validation path through hosted wake status so Cloudflare can reuse web-owned fetch-fence and wake-identity truth.
- Seam-local cleanup landed inside this lane: hosted wake status request validation now lives in shared hosted-execution parsing instead of bespoke route-local parsing.
- Direct regression proof is green for both the new pre-execution stale-proof race and the existing stale-terminal cleanup path.
- Broader workspace verification remains blocked by unrelated dirty-tree failures already in flight:
  - `packages/hosted-execution` typecheck currently fails because `packages/hosted-execution/test/hosted-wake-parsers.test.ts` still expects the removed `parseHostedWakeAppendRequest` export from overlapping work.
  - `bash scripts/workspace-verify.sh test:diff ...` previously failed in unrelated workspace typecheck lanes outside this change.
  - Full `apps/cloudflare/test/user-runner-hosted-wake.test.ts` still contains unrelated finalize-proof lane failures beyond the two targeted regressions above.
- Explicitly left to other active lanes:
  - removing the `dispatchState` compatibility guard in hosted wake status parsing
  - cleaning up append-parser residue around the old hosted wake append surface

## Notes

- The direct regression proof is: fetch wake A, rewrite/coalesce to wake B before execution, then Cloudflare must reject A before runtime invocation and refetch without leaving a pending commit.
Status: completed
Updated: 2026-04-24
Completed: 2026-04-24
