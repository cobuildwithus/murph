## Title

Reject missing hosted-run `finalizeRequired` at the Cloudflare web-control-plane boundary.

## Goal

Keep the hosted-run finalize intent explicit all the way through the Cloudflare caller boundary by failing closed if a commit request reaches `commitHostedRunToWeb` without `finalizeRequired`.

## Scope

- `apps/cloudflare/src/web-control-plane.ts`
- directly coupled Cloudflare tests proving the boundary rejects missing `finalizeRequired`
- touch `apps/cloudflare/src/user-runner/runner-run-processor.ts` only if a direct guard is still missing there

## Constraints

- Keep this as a narrow Cloudflare boundary hardening follow-up.
- Preserve unrelated dirty-tree Cloudflare work already in flight.
- The shared contract/parser/route are already explicit in the current tree; do not broaden into another shared-contract pass.

## Verification

- passed: `pnpm --dir apps/cloudflare test:node -- apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/user-runner-resume-finalize.test.ts`
- failed unrelated: `pnpm --dir apps/cloudflare typecheck`
- passed: `git diff --check`

## Notes

- `HostedRunCommitRequest.finalizeRequired` is already required in the shared contract and parser.
- This task is only to make the Cloudflare caller fail closed at runtime instead of trusting TypeScript alone.
- `apps/cloudflare/src/user-runner/runner-run-processor.ts` already keeps `finalizeRequired` explicit on its public run-drain result shape, so the only missing runtime guard was the web-control-plane caller.
- The app-local typecheck failure is the same pre-existing hosted-wake-to-run rename drift under `apps/cloudflare/test/workers/test-hosted-wake-control.ts`; the new boundary test and focused runner tests passed.
