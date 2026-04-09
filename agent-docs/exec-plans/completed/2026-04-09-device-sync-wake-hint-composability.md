# Centralize device-sync wake-hint ownership

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the downloaded Pro patch intent that centralizes the nested device-sync wake-hint shape under the device-sync runtime owner.
- Remove duplicate hosted-execution copies/parsers for that nested payload while preserving hosted-execution ownership of the outer dispatch event.

## Success criteria

- `packages/device-syncd` owns the shared wake-hint types and boundary parser.
- `packages/hosted-execution` reuses that owner instead of carrying a parallel shape/parser.
- `apps/web` stops using an unsafe cast for signal payload wake hints.
- Focused tests cover the shared parser seam and the hosted-execution outer parser still accepting the same payloads.

## Scope

- In scope:
  - `packages/device-syncd/src/hosted-runtime.ts`
  - `packages/device-syncd/test/hosted-runtime.test.ts`
  - `packages/hosted-execution/src/contracts.ts`
  - `packages/hosted-execution/src/parsers.ts`
  - `packages/hosted-execution/test/device-sync-wake-parsers.test.ts`
  - `apps/web/src/lib/device-sync/hosted-dispatch.ts`
  - `agent-docs/references/data-model-seams.md`
- Out of scope:
  - broader transport-model dedupe outside this wake-hint seam
  - hosted dispatch contract redesign beyond the nested hint payload
  - unrelated dirty worktree files

## Current state

- `packages/device-syncd/src/hosted-runtime.ts` already owns the runtime snapshot and wake-context normalization types.
- `packages/hosted-execution/src/contracts.ts` and `packages/hosted-execution/src/parsers.ts` duplicate the same nested wake-hint shape and parsing logic.
- `apps/web/src/lib/device-sync/hosted-dispatch.ts` currently casts `signalPayload` directly to the hosted wake-hint type.

## Plan

1. Add the wake-hint parser to `packages/device-syncd/src/hosted-runtime.ts` next to the existing owned wake-hint types.
2. Convert `packages/hosted-execution/src/contracts.ts` to alias the device-sync-owned nested wake-hint types.
3. Delegate hosted-execution nested wake-hint parsing to the device-sync owner and remove the duplicate parser code.
4. Replace the hosted-web unsafe cast with the shared parser.
5. Add focused package tests and the matching seam note, then run truthful verification and required audits.

## Risks and mitigations

1. Risk: blurring package ownership by moving hosted-dispatch concerns into `device-syncd`.
   Mitigation: only centralize the nested hint payload and keep the outer hosted dispatch event/parser in `packages/hosted-execution`.
2. Risk: changing validation behavior for numeric or payload fields.
   Mitigation: mirror the existing hosted-execution validation rules in the new owner parser and lock them with focused tests.
3. Risk: overlapping dirty worktree edits.
   Mitigation: stay scoped to the files listed above and preserve all unrelated changes.

## Verification

- Expected truthful lane:
  - `pnpm test:diff packages/device-syncd/src/hosted-runtime.ts packages/device-syncd/test/hosted-runtime.test.ts packages/hosted-execution/src/contracts.ts packages/hosted-execution/src/parsers.ts packages/hosted-execution/test/device-sync-wake-parsers.test.ts apps/web/src/lib/device-sync/hosted-dispatch.ts agent-docs/references/data-model-seams.md`
Completed: 2026-04-09
