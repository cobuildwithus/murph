Goal (incl. success criteria):
- Stop silently dropping completed assistant answers when a steered (mid-turn) user message arrives after the model already finished answering the previous message in the same Codex turn.
- Match Codex CLI semantics: every completed final-phase agent message separated by an injected steered user message is delivered, in order; the last one remains the turn's final reply.
- Success means a steered turn with answer -> steered message -> answer delivers both answers (proven by unit tests), while unsteered turns, steer-during-tool-work turns, and multi-final-without-steer turns keep byte-identical behavior (last-wins single delivery).

Constraints/Assumptions:
- Root cause is proven (local repro 2026-06-11): Codex emitted two final agent messages in one steered turn; Murph's `finalMessage` extraction is last-wins, so the first answer was generated but never delivered.
- Steer boundaries must come from the in-stream `item.completed` user-message item (codex-rs emits `ItemCompleted(TurnItem::UserMessage)` when drained steered input is recorded), not from steer RPC ack timing, which races ahead of the in-flight final message.
- The progress-update delivery path is not a valid vehicle for full answers (whitespace-collapsing normalization, per-turn caps, dedupe).
- No provider/protocol changes; no new persisted state; reuse the existing reply delivery seam with segment-distinct idempotency keys.

Key decisions:
- Adapter (`assistant-codex.ts`) tracks completed final-phase agent messages and closes a "preceding segment" whenever a completed user-message item follows one; no steer-count gating is needed because the initial prompt's user item always precedes any final message.
- Turn result carries `precedingAgentMessages: readonly string[]` (empty in all unsteered cases); the existing reply delivery layer delivers them before the final reply with `:segment:<ordinal>`-suffixed idempotency keys.
- Deliver preceding segments at turn end rather than mid-turn to avoid new cross-layer delivery hooks; ordering is preserved and the diff stays at the existing delivery seam.

State:
- Complete; ready for finish-task commit and PR.

Done:
- Root cause investigation with DB/rollout evidence; Codex CLI behavior verified in ../codex (core regular-task loop, app-server user-message item emission, TUI/exec per-item rendering).
- Implementation + 13 focused unit tests; root `pnpm typecheck` and assistant-engine `test:coverage` green after every fix round.
- All five required audit passes done and resolved: simplify (single dedupe seam, preceding delivery loops `deliverAssistantReply`, best-effort diagnostics, tightened types), security-privacy-review (clean), coverage-write (+4 proof tests), deep-review (trailing-only duplicate filter, defensive result copy, camelCase v2 wire test; F2/F3/F4 accepted as documented limitations), task-finish-review (no blocking findings).

Now:
- finish-task commit, PR.

Next:
- Post-merge: hosted e2e re-repro of the original double-text scenario (only remaining proof gap).

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant-codex.ts
- packages/assistant-engine/src/assistant-codex-events.ts
- packages/assistant-engine/src/assistant/providers/codex-cli.ts
- packages/assistant-engine/src/assistant/providers/types.ts
- packages/assistant-engine/src/assistant/codex-turn-runner.ts
- packages/assistant-engine/src/assistant/delivery-service.ts
- packages/assistant-engine/src/assistant/local-service.ts
- packages/assistant-engine/test/ (focused new tests)
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
