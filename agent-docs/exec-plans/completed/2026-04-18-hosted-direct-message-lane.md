## Goal

Stop routing hosted message turns through the generic hosted dispatch/event-adapter stack. Message wakes should execute through one explicit conversation lane, while non-message wakes stay on explicit system handlers under the HostedWake contract.

## Scope

- `packages/hosted-execution/src/**`
- `packages/hosted-execution/test/**`
- `apps/web/src/lib/hosted-wake/{dispatch,payload,store}.ts`
- `apps/web/app/api/internal/hosted-wake/append/route.ts`
- `apps/web/test/hosted-wake*.test.ts`
- `apps/cloudflare/src/{web-control-plane,user-runner}.ts`
- `apps/cloudflare/test/{user-runner-hosted-wake,web-control-plane}.test.ts`
- `packages/assistant-runtime/src/hosted-runtime/{events,execution,models}.ts`
- `packages/assistant-runtime/src/hosted-runtime/events/**`
- `packages/assistant-runtime/test/hosted-runtime-*.test.ts`

## Constraints

- Preserve the HostedWake/Cursor ownership model already landed in web.
- Keep one shared wake contract; do not reintroduce the old dispatch-payload control surface.
- Allow the direct webhook wake cutover to merge only the shared payload-contract and runner-decoding pieces needed for Linq/Telegram direct wake payloads.
- Avoid unrelated overlap with the active hosted-wake follow-up cleanup lane.
- Reduce provider-specific event modules to pure message parsing/ingest helpers rather than lifecycle entrypoints.

## Verification

- `pnpm typecheck`
- Truthful coverage-bearing verification for touched owners via `pnpm test:diff <paths...>` if it covers the slice; otherwise owner-level coverage commands per repo policy
- Required completion-workflow audits before handoff and commit

## Outcome

- Hosted message wakes now resolve through one explicit conversation lane in `packages/assistant-runtime/src/hosted-runtime/events.ts`.
- System wakes stay on explicit system handlers; provider-specific Linq/Telegram/Email modules now only build normalized captures instead of acting as lifecycle entrypoints.
- Focused verification passed for `packages/hosted-execution`, `packages/assistant-runtime`, `apps/cloudflare`, and targeted `apps/web` wake/webhook tests.
- `apps/web` `typecheck:prepared` still fails on pre-existing `src/components/ui/input-otp.tsx` issues unrelated to this lane.
- Parallel overlap exists in `apps/cloudflare/src/user-runner.ts`; leave that file to the active Cloudflare thin-shim lane instead of sweeping it into this commit.
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
