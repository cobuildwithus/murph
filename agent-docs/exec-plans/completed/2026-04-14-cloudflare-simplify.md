## Goal

Review the hosted-local Cloudflare E2E harness and the recent runner/container fixes, then cut back any unnecessary abstraction or compatibility surface while preserving the same end-to-end guarantees.

## Why

- The current fix set spans local dev tooling, the container boundary, and Durable Object run coordination.
- That scope is correct only if each piece is necessary; any redundant seam now becomes long-term maintenance cost.
- The hosted-local E2E lane should stay truthful without carrying extra harness-specific complexity.

## Scope

- `scripts/dev-hosted-local/**`
- `apps/cloudflare/scripts/**`
- `apps/cloudflare/src/**`
- `apps/cloudflare/test/**`
- Cloudflare/runtime docs only if they materially inform simplification choices

## Verification target

- `pnpm --dir apps/cloudflare exec tsc -p tsconfig.typecheck.json --pretty false`
- `pnpm --dir apps/cloudflare test:node`
- `pnpm --dir apps/cloudflare test:workers`
- `pnpm --dir apps/cloudflare test:e2e:local`
- direct simplification review findings from GPT-5.4 High sub-agents

## Outcome

- Keep the hosted-local proof path and runtime fixes intact.
- Remove or collapse any vestigial seams that are not earning their keep.
- Leave the architecture more minimal and composable without reintroducing the Cloudflare bug or weakening proof.
Status: completed
Updated: 2026-04-14
Completed: 2026-04-14
Completed: 2026-04-14
