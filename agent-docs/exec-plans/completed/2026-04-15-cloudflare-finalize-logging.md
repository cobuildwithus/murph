# Improve hosted finalize and worker error logging

Status: completed
Created: 2026-04-15
Updated: 2026-04-15

## Goal

- Make hosted Cloudflare logs and persisted runner timeline entries carry richer redacted inline error detail so finalize-stage bugs remain debuggable even when Cloudflare CSV export drops nested structured fields.

## Success criteria

- Hosted structured logs append the safe summary plus redacted original detail to the human-readable message when an error is present.
- Runner retry timeline entries for committed-finalize failures persist that same actionable message.
- The remaining app-local error logging paths pass original errors through the shared redaction helper instead of wrapping them ad hoc.
- Focused `apps/cloudflare` and `packages/hosted-execution` tests cover the new logging behavior.

## Scope

- In scope:
- `packages/hosted-execution` observability helpers
- `apps/cloudflare` runner retry logging and worker error logging
- Focused tests covering the logging output
- Out of scope:
- Broader observability schema redesign
- Cloudflare dashboard/export tooling changes outside this repo

## Constraints

- Technical constraints:
- Keep error text redacted and operator-safe.
- Preserve existing error codes and response bodies.
- Product/process constraints:
- Do not touch unrelated `apps/web` work already in the tree.

## Risks and mitigations

1. Risk: Logging changes could accidentally expose raw secret-bearing error text.
   Mitigation: Reuse the existing hosted-execution summarization and operator-message normalization helpers instead of emitting raw errors.
2. Risk: Timeline-message changes could break status-oriented tests.
   Mitigation: Update only the focused assertions that depend on retry message content.

## Tasks

1. Update the shared hosted-execution observability helper to inline safe error summaries into operator-facing messages.
2. Persist the formatted message through runner phase recording so finalize retries keep actionable context.
3. Replace the remaining raw multi-argument audit-log `console.error` path with structured hosted logging.
4. Add focused regression tests for the observability helper, finalize retry timeline messaging, and worker-route error logging.

## Decisions

- Keep the structured `errorCode` / `errorMessage` fields unchanged and improve debuggability by enriching the top-level `message` string through one shared formatter.
- Increase the operator-facing message budget so redacted inline detail can survive Cloudflare log export without forcing call-site-specific hacks.

## Verification

- Commands to run:
- `pnpm --dir packages/hosted-execution test -- --run test/hosted-execution-observability-side-effects.test.ts`
- `pnpm --dir apps/cloudflare test -- --run test/user-runner.test.ts test/index.test.ts`
- `pnpm typecheck`
- `pnpm test:smoke`
- `pnpm test:diff packages/hosted-execution apps/cloudflare`
- Expected outcomes:
- Focused tests pass with the new safe inline messages.
- Repo typecheck remains green.
- Smoke verification remains green.
- Note unrelated diff-scope failures if reverse dependents are already broken outside the touched logging paths.

## Outcome

- Implemented a centralized inline-error formatter in `packages/hosted-execution` that appends redacted detail and cause/code/status fragments without duplicating the stable summary.
- Removed the `user-key-store` sanitized-`Error` wrapper and passed original caught errors into shared redaction.
- Updated the Cloudflare route and runner tests plus hosted-execution observability coverage for the richer inline messages.
- Verification results:
- `pnpm --dir packages/hosted-execution test -- --run test/hosted-execution-observability-side-effects.test.ts` ✅
- `pnpm --dir apps/cloudflare test -- --run test/user-runner.test.ts test/index.test.ts` ✅
- `pnpm typecheck` ✅
- `pnpm test:smoke` ✅
- `pnpm test:diff packages/hosted-execution apps/cloudflare` ❌ unrelated reverse-dependent failure in `packages/cli` during typecheck (`TS6305` contracts build-output mismatch plus pre-existing `HealthEntityDescriptor`/`HealthQueryDescriptorEntry` shape errors).
Completed: 2026-04-15
