# Hosted Device-Sync Failure Diagnostics

## Goal

Make hosted WHOOP/device-sync retry failures diagnosable from the web-owned
control plane when a runtime retry advances failure state.

## Scope

- `apps/web/src/lib/device-sync/hosted-runtime-authority.ts`
- focused hosted device-sync runtime-authority tests
- shared hosted runtime contract/types only if needed to carry sanitized
  diagnostic metadata

## Constraints

- No new tables, scheduler state, retry queues, or provider-specific web logic.
- Log only redacted metadata: provider, status, error code, sanitized error
  summary, retry timing, and sanitized provider/OAuth diagnostic fields when
  the runtime already supplies them.
- Do not log user ids, connection ids, account ids, raw tokens, provider
  payloads, prompts, messages, mailbox payloads, local paths, or secrets.
- Preserve the existing web-owned device-sync authority boundary.

## Plan

1. Confirm the runtime apply mutation is the right authority seam. Done.
2. Add the smallest metadata-only failure diagnostic write on successful apply
   of a newer failure timestamp. Done.
3. Carry sanitized provider/OAuth diagnostic fields through the hosted runtime
   apply contract. Done.
4. Add focused tests for parser, runtime reconciliation, and web apply logging.
   Done.
5. Run focused verification, diff-scoped verification, typecheck, and required
   reviews. Done.

## Evidence

- Forced hosted WHOOP retry was consumed by cron/runtime; connection failure
  state advanced and the next retry was scheduled, so the remaining issue is a
  real provider token request failure plus missing durable failure diagnostics.
- Focused tests passed:
  - `apps/web/test/device-sync-hosted-runtime-authority.test.ts`
  - `apps/web/test/hosted-workspace-store.test.ts`
  - `packages/device-syncd/test/hosted-runtime.test.ts`
  - `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
  - `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `pnpm typecheck` passed.
- `pnpm test:diff ...` passed for the scoped files after running affected
  package/app checks.
- Review findings were fixed:
  - `providerHttpStatusText` is accepted by both hosted log ingestion paths.
  - disconnected failure updates now carry `lastSyncErrorAt` and
    `failureDiagnostic`.
  - final read-only follow-up reported no findings.
Status: completed
Updated: 2026-05-19
Completed: 2026-05-19
