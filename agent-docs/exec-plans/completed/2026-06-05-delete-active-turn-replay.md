# Delete Active-Turn Provider Replay Plan

Created: 2026-06-05

## Goal

Delete Murph-side active-turn continuation/replay while preserving live Codex
turn steering.

Success criteria:

- While a Codex provider turn is live, same-conversation input is accepted,
  journaled, transcripted, checkpointed, and steered into that live provider
  turn.
- After the live provider turn closes, later input starts the normal next Murph
  turn. Stale turn id mismatches remain errors only while a matching active
  turn is still live.
- `sendAssistantMessageLocal` issues at most one provider request for one Murph
  assistant turn.
- Murph no longer builds artificial same-turn provider history to replay late
  input through additional provider requests.
- Hosted mailbox active-turn notification still imports foreground mailbox rows
  and uses the existing active-turn controller to steer prompt-ready same-
  conversation input.

## Design Principle

Murph should remain a thin Codex server/runtime owner, not a second provider
turn lifecycle.

Keep the existing live primitive:

```text
same-conversation input while provider turn is live
  -> accept and persist input
  -> checkpoint accepted input
  -> turn/steer into Codex
  -> return the existing Murph turn completion promise
```

Delete the replay primitive:

```text
provider request completes
  -> inspect boundary input
  -> synthesize provider exchange
  -> start another provider request in the same Murph turn
```

## Non-Goals

- Do not add a replacement continuation loop.
- Do not loosen manual active-turn targeting rules.
- Do not change mailbox import, Temporal, Cloudflare wake ownership, or provider
  egress authority.
- Do not remove accepted-input journaling or transcript persistence for input
  that is actually accepted into a live turn.
- Do not remove `providerRequestOrdinal` from hosted/web usage schemas in this
  change; collapse runtime-produced same-turn ordinals to `0` and leave schema
  cleanup as a separate compatibility decision if it is still wanted later.

## Implementation Plan

1. Simplify `packages/assistant-engine/src/assistant/local-service.ts`.
   - Delete `MAX_ACTIVE_TURN_INPUT_CONTINUATIONS`.
   - Replace the `providerLoop` with one call to
     `executeCodexTurnWithRecovery`.
   - Keep pre-provider `admitAvailable({ probeIfIdle: true })` so input already
     queued before provider start is folded into the initial provider request.
   - Keep `acceptActiveTurnInput` for journal/transcript/checkpoint behavior.
   - Remove `request_boundary` and `commit_barrier` admission after provider
     completion.
   - Close the active-turn controller immediately after the provider turn result
     is known and before commit-state finalization.
   - Stop passing `activeTurnHistory`; always pass `null`/omit replay history.
   - Use `providerRequestOrdinal: 0` for the single provider request.

2. Simplify provider planning surfaces.
   - Remove `activeTurnHistory` from execution/attempt planning if it is only
     used for replay prompt construction.
   - Delete `active-turn-history.ts` if no remaining production code needs it.
   - Remove active-turn history prompt-size diagnostics that existed only to
     observe replay prompts.
   - Preserve committed transcript fallback for normal fresh thread starts.

3. Preserve live steering.
   - Keep `createAssistantActiveTurnInputController`.
   - Keep `registerLiveProviderTurn`, `turn.steer`, and `turn.interrupt`.
   - Keep `providerAlreadySteered` as the signal that accepted input was already
     delivered to the live provider turn.
   - Ensure unacknowledged input does not trigger Murph-side replay after the
     provider closes; it should remain durable input for the next normal scanner
     pass/turn.

4. Update tests.
   - Rewrite local-service tests that currently expect a second provider
     request after boundary admission.
   - Keep and strengthen the live-steer test: slow provider turn, late same-
     conversation input, `steer` called, both callers resolve with the final
     provider reply, and `executeCodexTurnWithRecovery` called once.
   - Add/adjust a regression proving late input after the provider live turn is
     closed does not create a same-turn provider replay.
   - Keep hosted mailbox active-turn tests focused on foreground import plus
     notification/steering, not provider replay.

5. Update durable docs if the code change alters documented current behavior.
   - `ARCHITECTURE.md`
   - `agent-docs/references/hosted-runtime-protocol.md`
   - `packages/assistant-runtime/README.md`

## Verification Plan

- Run a focused assistant-engine test target around active-turn local service
  behavior.
- Run `pnpm test:diff` for the touched files, or the package-local coverage
  lane if the diff-aware lane is not truthful enough.
- Run `pnpm typecheck`.
- Run required completion audits:
  - `security-privacy-review` because this touches hosted/runtime input
    authority and persisted assistant runtime state.
  - `coverage-write` because the verification lane includes owner coverage.
  - `deep-review` because this changes ordering/concurrency semantics.
  - `task-finish-review`.

## Open Questions

- Whether hosted latency dashboards should continue accepting nonzero
  `providerRequestOrdinal` only as legacy/deploy-skew data. Default answer for
  this PR: yes, keep web schema compatibility and stop producing nonzero
  ordinals from this runtime path.

## Progress

- Deleted provider replay/history plumbing and collapsed active-turn phases to
  `input_available`.
- Preserved live steering and added provider-turn-key scoped acknowledgement so
  recovered provider attempts re-steer pending input before it is journaled.
- Added regression coverage for manual live steering, event-backed live
  steering, provider replacement, provider failure after live steering, and
  post-provider-close next-turn behavior.
- Verification run:
  - `pnpm --dir packages/assistant-engine test -- test/assistant-local-service-runtime.test.ts test/assistant-automation-runtime.test.ts test/assistant-protocol-index-planning.test.ts test/codex-runtime-helpers.test.ts test/assistant-codex-final-coverage.test.ts`
  - `pnpm --dir packages/assistant-runtime test -- test/hosted-runtime-events.test.ts test/hosted-runtime-turn-input.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `git diff --check`
  - Removed-symbol `rg` sweep for replay/boundary terms
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
