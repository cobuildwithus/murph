## Goal

Collapse the remaining hosted runner commit/finalize callback seam so the container returns the committed and finalized execution data directly to the Durable Object, while keeping `results.worker` only for true outward effects such as hosted email and side-effect journal access.

## Success Criteria

- The runner/container contract returns enough data for the Durable Object to persist committed and finalized bundle state without calling `results.worker` commit/finalize routes.
- `results.worker` remains the internal seam for side-effect journal access and hosted email only.
- Hosted side-effect reliability still flows through the committed side-effect journal and resume path instead of introducing a second retry lane.
- Focused hosted runner/container/worker tests cover the direct-result persistence path and the retained side-effect journal behavior.
- Durable docs reflect the new boundary truthfully.

## Scope

- `apps/cloudflare/**`
- `packages/assistant-runtime/**`
- `packages/hosted-execution/**`
- `ARCHITECTURE.md`
- focused hosted runner docs/tests touched by the seam

## Constraints

- Preserve unrelated dirty worktree edits, especially the active hosted-member privacy lane under `apps/web/**`.
- Keep the one-shot container lifecycle; do not widen into pooling or warm reuse design.
- Keep outward mutations on the shared side-effect journal reliability lane.
- Treat the hosted Worker, Durable Object, and container trust boundary as high-risk.

## Verification

- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/cloudflare verify`
- Focused direct scenario proof for the runner/container path proving commit/finalize no longer use `results.worker` while side-effect journal access still does.

## Notes

- This is a plan-bearing high-risk hosted-runtime change because it touches the Worker/DO/container contract and recovery semantics.
- Update architecture/docs if the callback-boundary wording changes.
- Focused verification passed for the callback-collapse seam:
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-outbound.test.ts --no-coverage`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/container-entrypoint.test.ts --no-coverage`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/gateway-store.test.ts --no-coverage`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/index.test.ts --no-coverage -t 'hard-cuts the removed runner finalize route from the outbound results.worker handler|keeps malformed outbound callbacks from mutating journal state even when runner auth is unset'`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.workers.config.ts apps/cloudflare/test/workers/runtime.test.ts --no-coverage`
- `pnpm --dir apps/cloudflare verify` still fails outside this seam because `apps/cloudflare/test/user-runner.test.ts` has broader stale assumptions unrelated to the removed callback boundary:
  - many tests still assume managed hosted-user crypto is auto-provisioned during dispatch/bootstrap
  - several tests still pass legacy split-bundle objects into helpers that now expect the one-bundle contract
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
