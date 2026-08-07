# Linq fallback observability

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Make hosted Linq policy denials and app-card-to-text error recovery visible
  through existing operator-queryable log surfaces: Worker structured logs for
  policy denials, and the durable hosted runtime log for in-container app-card
  recovery (container stdout/stderr never reaches a queryable sink).
- Keep every diagnostic metadata-only and preserve the delivery behavior already
  shipped in the narrow egress-conformance fix.

## Success criteria

- A rejected Linq route or missing credential sentinel emits one sanitized
  Worker warning naming only the bounded policy reason and safe request facts.
- A capability-check exception or definitive app-card rejection writes one
  bounded, allowlist-projected warn entry to the durable hosted runtime log
  before the existing text recovery continues; a failed or stalled log write
  never changes delivery.
- Expected `available: false` capability results remain ordinary fallback and do
  not warn.
- Aborted, provider-skipped, ambiguous, timeout, rate-limit, and server-failure
  delivery paths keep their existing propagation and retry semantics.
- Focused tests prove that recipients, chat/thread ids, delivery keys,
  credentials, provider bodies, request paths, and provider prose do not enter
  the new log records.

## Scope

- Existing Cloudflare Linq egress interception and its focused tests.
- Existing Assistant Engine Linq delivery callback seam.
- Existing hosted provider-effects structured logging and focused tests.
- Current reliability and iMessage deliverability contracts.

## Constraints

- No routing, retry, timeout, idempotency, fallback, persistence, schema,
  migration, provider-request, or user-visible behavior changes.
- No new state owner, queue, service, dependency, or logging abstraction.
- Reuse the shared hosted structured logger and its redaction boundary.
- Keep PR #1354 open until the replacement PR exists, then close it with the
  replacement link.

## Tasks

1. [x] Add the two bounded warning boundaries and focused privacy regressions.
2. [x] Update the current owner contracts and run focused verification.
3. [x] Push the exact candidate and open replacement PR #1428; close superseded
   PR #1354 with the replacement link.
4. [ ] Run the preliminary coverage pass, final ReviewGPT gate, and exact-head
   CI concurrently; resolve accepted findings without widening scope.
5. [ ] Complete parent review, close this plan, and close PR #1354 with the
   replacement link.

## Verification log

- `apps/cloudflare/test/runner-egress-intercept.test.ts`: 237 tests passed.
- `packages/assistant-runtime/test/hosted-provider-effects.test.ts`: 23 tests
  passed.
- `packages/assistant-runtime/test/hosted-runtime-callbacks.test.ts`: 232 tests
  passed, including the five durable fallback-log entry proofs.
- `packages/assistant-engine/test/assistant-channels-runtime.test.ts`: 60 tests
  passed.
- Assistant Engine, Assistant Runtime, and Cloudflare package typechecks passed.
- `pnpm logs:guard`, `pnpm docs:drift`, `git diff --check`, and the scoped direct
  identifier scan passed.
- A direct Prettier check was unavailable because this repository does not
  install a `prettier` executable; the repository-owned checks above remain the
  applicable formatting and drift proof.
