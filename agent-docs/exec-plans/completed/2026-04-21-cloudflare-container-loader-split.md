Status: completed
Created: 2026-04-21
Updated: 2026-04-21

## Goal

- Reduce unnecessary cold-run startup work in the Cloudflare hosted runner container by splitting request parsing imports from executor imports and preloading only the executor path after listen.

## Success criteria

- The container entrypoint parses hosted runner requests through the narrow `@murphai/assistant-runtime/hosted-runtime-contracts` public subpath instead of waiting on the full runtime loader.
- The full executor path still loads before real job execution and preserves existing behavior.
- Container startup keeps the lightweight `/health` contract while beginning executor preload in the background after the HTTP server is listening.
- Directly coupled container-entrypoint tests cover the split loader behavior without widening into unrelated hosted runtime changes.

## Scope

- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- directly coupled Cloudflare docs only if the external contract changes materially

## Constraints

- Keep the change narrow to container startup and loader boundaries only.
- Preserve the existing lightweight `/health` behavior and current auth/run request contract.
- Use only public workspace package entrypoints; do not reach into sibling package internals.

## Verification

- passed: `pnpm typecheck`
- passed: `pnpm test:diff apps/cloudflare/src/container-entrypoint.ts apps/cloudflare/test/container-entrypoint.test.ts`
- passed: `git diff --check`

## Notes

- This is a hosted runtime-entrypoint change, so verification should call out the cold-start/readiness tradeoff explicitly in handoff.
- The preload stays best-effort and starts only when the runner control token is configured, preserving the lightweight health contract used before secrets are ready.
Completed: 2026-04-21
