# Assistant input spine simplification hard cut

## Goal

Remove the old capture-gated Codex admission spine so hosted and local runtime
input both flow through one durable assistant input path:

```text
source adapter -> AssistantInputEvent -> AssistantInputSource -> scanner / active turn -> accepted-input journal -> Codex
```

Success means inbox capture is projection/enrichment only. Hosted execution must
remain a thin runner over the local runtime, with hosted mailbox decode acting
only as an ingress adapter into the same local input spine.

## Scope

- `packages/assistant-engine/src/assistant/**`
- `packages/assistant-runtime/src/hosted-runtime/**`
- focused assistant-engine and assistant-runtime tests
- durable docs only when behavior or ownership changes

## Non-Goals

- No new hosted-only assistant architecture.
- No second input journal beside `AssistantInputEvent`.
- No separate projection queue unless the input store proves insufficient.
- No Cloudflare runner/control-plane rewrite.
- No broad inboxd redesign beyond deleting hosted runtime-only admission
  residue when production callers are gone.

## Constraints

- Preserve unrelated dirty work in the shared checkout.
- Do not touch active hosted-web, Cloudflare runner, Health Commons, or
  unrelated runtime-state rows except for compile-required narrow adapters.
- Keep assistant input records minimized: no raw provider payloads, raw EML,
  signed URLs, auth headers, local paths, attachment bytes, or unsanitized
  filenames.
- Keep hosted and local scanner/active-turn behavior shared after input event
  staging.

## Batches

1. Engine primitive rebase:
   - put durable input-event identity in the store or neutral module
   - add store-backed `AssistantInputSource`
   - add accepted journal `assistant-input-event`
   - add terminal evidence by input id / input group id
2. Hosted ingest hard cut:
   - decode/match hosted mailbox item
   - upsert minimized `AssistantInputEvent` before inbox/raw-email/attachment
     projection
   - checkpoint mailbox staging separately from projection status
3. Engine hard switch:
   - scanner, prompt prep, receipts, terminal evidence, and active-turn
     admission consume `AssistantInputSource`
   - no direct scanner/active-turn dependency on inbox list
4. Cleanup:
   - delete `listNewConversationCaptures`, capture-only turn input plumbing,
     hosted runtime-only admission, and stale tests once replacements are green

## Verification Target

- focused assistant-engine input source/journal/evidence/automation tests
- focused assistant-runtime hosted mailbox/input tests
- `pnpm test:diff` over touched package paths when the diff stabilizes
- security/privacy review, coverage-write when required, simplify review when
  the diff size crosses the workflow threshold, and task-finish review

## Current State

- Implemented and focused-verified in the shared worktree.
- Hosted conversation mailbox decode now stages minimized `AssistantInputEvent`
  before inbox/raw-email/attachment projection.
- Scanner and active-turn admission consume `AssistantInputSource`.
- Accepted-input journal can record `assistant-input-event`.
- Runtime-only capture admission and the legacy capture turn-input port are
  removed from the Codex admission path.
- Direct hosted conversation wakes fail closed; conversation input must enter
  through mailbox staging.
- The stale CLI automation seam now uses `inputSource`, and the public
  `stageRuntimeOnlyCapture` helper was removed from `inboxd`.

## Verification Run

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-cli typecheck`
- `pnpm --dir packages/inboxd typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-input-store.test.ts test/assistant-input-source.test.ts test/assistant-active-turn-input-journal.test.ts test/assistant-automation-runtime.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-conversation-event.test.ts test/hosted-runtime-mailbox-import.test.ts test/hosted-runtime-mailbox-checkpoint.test.ts test/hosted-runtime-turn-input.test.ts test/hosted-runtime-maintenance.test.ts test/hosted-runtime-events.test.ts test/hosted-runtime-workspace-runner.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-cli exec vitest run test/assistant-runtime-service-seams.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/inboxd exec vitest run test/inboxd.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine build`
- `pnpm --dir packages/assistant-runtime build`
- `pnpm --dir packages/assistant-cli build`
- `pnpm --dir packages/inboxd build`
- `git diff --check` over the touched paths
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
