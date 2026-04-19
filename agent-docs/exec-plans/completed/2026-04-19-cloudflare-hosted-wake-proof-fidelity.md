## Title

Bind Cloudflare hosted-wake test fetch proofs to the fetched cursor fence.

## Goal

Make the Cloudflare hosted-wake control helpers mint and validate fetch proofs that include the fetched cursor fence, so Cloudflare tests exercise the same stale-proof contract the web-owned wake store enforces.

## Scope

- `apps/cloudflare/test/workers/test-hosted-wake-control.ts`
- focused Cloudflare wake-drain tests in `apps/cloudflare/test/user-runner-hosted-wake.test.ts`
- `apps/cloudflare/test/workers/runtime.test.ts` only if a stale materialization/status expectation needs to move with the helper change

## Constraints

- Keep this slice test-only unless the helper gap exposes a real production mismatch.
- Do not import app internals across app boundaries just to reuse the web helper.
- Preserve unrelated in-flight Cloudflare wake/materialization edits in nearby files.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/workers/test-hosted-wake-control.ts apps/cloudflare/test/user-runner-hosted-wake.test.ts apps/cloudflare/test/workers/runtime.test.ts`

## Notes

- The target fidelity is the web-owned fetch proof contract: wake identity plus fetched cursor fence.
- If one Workers runtime assertion still drifts on `nextWakeAt` or status shape after alarm-driven materialization, treat that as test drift and keep it narrowly scoped.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
