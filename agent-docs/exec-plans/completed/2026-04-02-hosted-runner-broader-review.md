# Hosted Runner Broader Review

## Goal

Land the supplied hosted-runner hardening patch across the current tree so hosted bundle/artifact reads fail closed, runner outbound control-plane requests reuse one shared fetch policy helper, queue/meta recovery clears stale operator error state, and hosted bundle base64 decoding rejects invalid payloads.

## Why

- The current hosted runner still accepts malformed base64 in some trust-boundary decoders.
- Bundle and artifact reads can return bytes without re-checking the stored size/hash invariants on read.
- The runner proxy path and shared hosted requester still maintain separate web control-plane fetch policy logic.
- Queue/meta recovery currently leaves stale `last_error` text behind on some success or recovery paths.
- The supplied patch stays bounded, but it spans multiple hosted execution seams and needs a tracked high-risk landing.

## Constraints

- Preserve unrelated dirty-tree edits already present in the repo.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Keep the delta limited to the hosted-runner/base64/control-plane/queue files named in this plan.
- Run the repo-required verification baseline for `apps/cloudflare` plus direct scenario proof for the strict base64 and fail-closed bundle behavior.

## Target Shape For This Pass

1. Tighten `apps/cloudflare` and `packages/runtime-state` base64 decoding so invalid payloads throw instead of silently degrading.
2. Make hosted bundle/artifact reads verify the stored size/hash invariants before returning plaintext.
3. Route runner web control-plane fetches through one shared `packages/hosted-execution` helper with normalized URL/auth/header/timeout behavior.
4. Remove the redundant second wake recomputation after committed-finalize retry scheduling and centralize queue last-error clearing.
5. Keep the patch narrow and avoid broader protocol redesign beyond the supplied behavior.

## Expected Files

- `apps/cloudflare/src/base64.ts`
- `apps/cloudflare/src/bundle-store.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/user-runner/runner-bundle-sync.ts`
- `apps/cloudflare/src/user-runner/runner-queue-store.ts`
- `packages/hosted-execution/src/web-control-plane.ts`
- `packages/runtime-state/src/hosted-bundle.ts`

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct scenario proof for strict base64 decoding and fail-closed hosted bundle/artifact reads

## Completion Notes

- Use `scripts/finish-task` when the change is ready to commit.
- Audit subagent follow-up is still expected by repo policy when session policy permits delegation.

Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
