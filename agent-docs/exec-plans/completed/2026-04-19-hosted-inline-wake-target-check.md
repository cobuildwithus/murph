## Goal

Fail closed when the hosted web inline wake handoff gets a 200 Cloudflare wake response that did not actually drain to the requested hosted wake sequence.

## Scope

- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`
- `apps/web/src/lib/hosted-wake/control.ts`
- shared hosted execution wake status/client surfaces needed to expose committed progress from Cloudflare
- focused hosted wake tests in `apps/web`, `apps/cloudflare`, `packages/hosted-execution`, and `packages/cloudflare-hosted-control` as needed

## Constraints

- Preserve adjacent in-flight hosted wake fetch-proof, lifecycle, and onboarding edits already present in the worktree.
- Keep the contract narrow: use a dedicated wake-drain result surface instead of overloading `HostedExecutionUserStatus`.
- Inline handoff may only return `true` when the requested `targetSeqHint` is known reached; otherwise the caller must schedule deferred drain.

## Verification

- `pnpm test:diff apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts apps/web/src/lib/hosted-wake/control.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/cloudflare-hosted-control/src/client.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/types.ts`
- Any smaller focused Vitest commands needed while iterating

## Notes

- Required proof: simulate a successful wake RPC that returns committed progress below `targetSeqHint`, then assert the inline path returns `false` and schedules deferred drain.
