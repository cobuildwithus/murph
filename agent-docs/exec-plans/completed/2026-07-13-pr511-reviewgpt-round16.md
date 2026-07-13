# PR 511 ReviewGPT Round 16 Fix

## Goal

Resolve the accepted ReviewGPT round-sixteen finding for PR 511, prove the
restart path cannot repeat a provider effect, and rerun ReviewGPT on the exact
pushed head until it reports no further actionable findings.

## Finding To Prove

An exact conversation replay row with durable `consumedAt` authority can sit
below a restored import watermark. The mailbox importer currently drops that
row through the generic stale-row branch before returning the exact consumed
sequence, so the replay owner can select and resend its older local pending
input.

## Constraints

- Preserve the distinction between import progress and handling progress.
- Treat `consumedAt` as exact-row terminal authority before generic watermark
  filtering only when the requested replay authority matches that row.
- Retire only the matching pending input while preserving its stored event as
  conversation context.
- Keep pending-index retirement and consumed-floor advancement in the same
  workspace checkpoint outcome.
- Add no queue, ledger, scheduler, service, or new durable lifecycle owner.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- `packages/assistant-runtime/src/hosted-runtime/pending-input-index.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- Focused assistant-runtime mailbox and workspace-entrypoint tests.
- Protocol documentation only if the existing invariant description needs a
  precise clarification.

## Verification Plan

- Add importer coverage for an exact consumed replay below the restored
  watermark.
- Add workspace coverage proving the matching pending input is retired,
  unrelated pending input remains, no assistant/provider path runs, and the
  exact consumed floor checkpoints.
- Cover checkpoint conflict/retry if the existing test harness can express the
  restart path without speculative machinery.
- Run relevant typecheck and tests, required completion audits, repo-required
  verification, privacy/diff checks, scoped commit, push, CI, and another
  exact-head ReviewGPT pass.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
