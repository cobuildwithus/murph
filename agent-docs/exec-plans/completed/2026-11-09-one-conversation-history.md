# One conversation history

Status: completed
Branch: `claude/one-conversation-history`

## Problem

A member chat has one native Codex thread that ordinary reply turns resume, which gives us 90%+ prompt caching. The session transcript is the record of the chat. Many writers append to it without advancing that thread:

- isolated notification turns (`notification-turn.ts:147-194`): game private kickoff, game recap and missed check-ins, manual meal, onboarding goal check-in, usage optimizer, operator message, system notification, context handoff;
- exact-text notifications (`persistAssistantExactTextNotificationSession`);
- ask continuations;
- private-completion imports;
- turns with a turn-scoped model override;
- reaction-routing "quiet" turns (`codex-turn-runner.ts:404-417`). The member message reaches the transcript but not the thread.
- the deterministic audience-safety reply (`local-service.ts:540-580`);
- imported self-authored Linq replies (`pending-input-index.ts:683-742`). These append outside the turn lock.

A resumed turn receives no transcript history (`providers/codex-cli.ts:389-395` drops `conversationHistoryMessages` on resume). The writers above therefore each need a workaround, and they disagree:

- **Throw the thread away**, so the next turn cold-starts from the transcript. This costs the cache:
  - `private-completion-continuity.ts:209`;
  - the context-handoff `clear` (`notification-turn.ts:1828`);
  - ask continuation (`ask-continuation.ts:398`);
  - `resolveAssistantTurnScopedOverrideResumeState`.
- **Keep the stale thread.** The next turn never sees what they wrote: everyone else.

The outbox prior-delivery context cannot cover the gap. It nulls same-session messages (`automation/reply.ts:5389-5416`).

**Incident, 2026-11-07.** The game private kickoff asked "Want me to help you keep it going?" and the member replied "Sure". The resumed thread had never seen the offer.

**Reproduced on main:**
- **Deterministic:** `assistant-codex-turn-planning.test.ts`, "shows a resumed thread the message an isolated notification sent after it".
- **Real Codex**, gpt-6.1-sol, local subscription: "game private kickoff then bare Sure continues the offer on the resumed thread".
  - The turn resumed the same thread.
  - The reply was "Please send a clear photo of the Supplement Facts panel…", an answer to the earlier fish-oil exchange.

## Rule

The transcript is the conversation record. The native thread caches it, with a bookmark saying how far the thread has seen. Each turn gives the model the transcript entries after the bookmark, using the history format and selection a cold start already uses.

## Design

1. **Bookmark value.** Add `codexResume.transcriptSeenThrough?: 'start' | { createdAt; kind; textSha256 }`.
   - `'start'` means an empty transcript.
   - The value is a position in the transcript file's order, not a time, so backdated imports still count as "after".
2. **Planning boundary.** `resolveAssistantRouteTurnPlan` reads the transcript once and records `transcriptBoundary`, the fingerprint of the last entry it saw (or `'start'`). The boundary flows with the provider result, next to `assistantContractFingerprint`.
3. **History on resume.** When a session-thread turn would resume:
   - Locate the bookmark by scanning backward.
   - **Found:** history is the entries after the bookmark, selected in slice mode.
     - Incompleteness is computed from the slice only. The whole-transcript ≥100 rule does not apply.
     - Leading assistant entries are kept, because they are exactly the unseen proactive messages.
     - Otherwise selection is identical to today: markers, retired text, dropping the current prompt, and byte and count bounds with the incomplete marker.
   - **Missing** (legacy binding, pruned, redacted or restored): do not resume. Use the new rotation reason `transcript_bookmark_missing`. The turn cold-starts from the transcript tail, as today.
4. **Advancing the bookmark.** Every saved binding goes through one pure rule, `resolveAssistantSessionResumeState` in `turn-finalizer.ts`. Both the finalizer save and the failed-provider save call it.
   - **Finalizer save** (`persistAssistantTurnAndSession`): walk forward from `transcriptBoundary`.
     - Step over entries this finalizer appended in this call, and over non-conversation kinds (audit).
     - Stop at the first foreign entry, for example an imported Linq reply that landed mid-turn.
     - The bookmark becomes the last entry stepped over.
     - Result: a foreign entry, and anything after it, stays unseen. The worst case is that the thread sees its own reply once more.
     - The generated-image and no-reply markers the finalizer writes describe what the thread itself did (it called the tool or finished without a reply), so they count as seen.
   - **Failed-provider persists** (`applyAssistantSessionCodexResumeStateAction`, called from `local-service.ts` and `notification-turn.ts`): never advance. A thread id proves which thread opened, not that Codex accepted this turn's history (`thread/resume` can succeed and `turn/start` then fail). Failed outcomes carry no `transcriptBoundary`.
     - Same thread: keep its existing bookmark. Unseen entries are replayed next turn.
     - New thread: no bookmark, so the next turn rotates and rebuilds from the transcript.
     - The cost is a possible duplicate; nothing unseen is ever marked seen.
   - **In-memory group reconsideration binding** (`applyAssistantProviderTurnResumeInMemory`): the bookmark is the first request's `transcriptBoundary`. The second request then still resumes the draft thread.
   - **Bindings that are kept** (`preserve-existing`, isolated turns, an override whose thread does not match the durable route): keep their existing binding and bookmark unchanged, on success and on failure alike.
   - **No planning boundary** (the planner could not read the transcript): the same-thread bookmark stays where it was, and a new thread gets none. An unread transcript is never treated as empty.
5. **Transport.** `codex-cli.ts` stops dropping `conversationHistoryMessages` on resume, which deletes the `primaryInput` special case. The existing flat section carries the history on fresh and resumed turns alike: one format.
6. **Deletions.**
   - Private-completion continuity no longer nulls `codexResume`.
   - Context handoff no longer returns `clear`.
   - Ask continuation no longer clears after persisting.
   - `resolveAssistantTurnScopedOverrideResumeState` and `resolveAssistantNextResumeState` collapse into the one rule above: an override's candidate is adopted only if it matches the durable route, else the session's binding is kept. `turnCommittedConversationHistory` goes away.
   - `clearAssistantSessionCodexResumeState` stays, because group reconsideration still uses it.
7. **Diagnostics.** Add `transcript_bookmark_missing` to every closed set that holds rotation reasons:
   - `codex-turn/planning.ts` (`threadRotationReason`);
   - `assistant-runtime/.../events/provider-trace-log.ts`;
   - `hosted-execution/src/parsers/runtime-log.ts`.

   The Web parser (`hosted-execution/src/parsers/runtime-log.ts`) used to reject an unknown reason, and one rejected entry dropped its whole log batch. It now keeps known reasons, turns an unknown string into `null` and still rejects non-strings. Ship Web first so the new reason is kept; a runner that gets ahead of Web then loses only that one label.

## Not in this change

- **Native `thread/inject_items`.** The pinned 0.166 binary exposes it, but it would change the format of every cold start. It would also turn quoted, untrusted group and handoff history into native user items (`codex-turn/planning.ts:256-263`). This is a later one-switch change with its own journeys.
- **Phase 2: cross-session deliveries.** Cron automation sessions, ask continuation pinned to its origin session, approved vault files, private completions, and deliveries made before a session rotation can land in a chat under another session. The prior-delivery context and `cross-session-route-state.ts` (≈3k LOC with tests) exist for these. Next step: every runner delivery appends to the route's current reply-session transcript. The generic prior-delivery text, the watermark and the claims then delete. Kept: the exact native-reply and tapback lookups, automation context references and attachment facts.

## Failure modes

- **Bookmark entry gone** (retention rewrite past the count limit, user text redacted after 14 days, session restore): rotate. One cache miss, nothing lost.
- **Fingerprint collision:** it would need the same kind, the same millisecond `createdAt` and the same text. Time order does not rule it out (writers set `createdAt`, and imports backdate), but no practical case was found. The backward scan finds the latest match, so a collision can only skip entries between two identical messages.
- **Crash after the provider turn but before the session save:** the bookmark stays at the old value, and the next turn re-sees a few entries. Benign duplicate.
- **Unawaited failed-provider audit appends** (`codex-turn-runner.ts:680-690`): audit kind, never conversation history. They are transparent to the walk.
- **Deploy skew.**
  - An old runner keeps only the fields it knows and can save a binding without the bookmark. A new runner then rotates once. While both run, rotations can repeat; this is bounded by the rollout drain.
  - Rollback restores the old forced clears, which is today's behavior.
  - Hosted restore already clears bindings whose rollout is missing (`workspace-restore.ts:658-691`); this change leaves that alone.

## Review outcomes (Codex c7 adversarial review)

| # | Finding | Outcome |
| --- | --- | --- |
| 1 | The in-memory group reconsideration binding would rotate | Accepted: it gets the first request's boundary (design 4). |
| 2 | Tail-at-save marks a mid-turn foreign append as seen | Accepted: forward walk over this call's own entries only (design 4). Adding the turn lock to the mailbox import was rejected, because it would stall inbound import and steering behind long turns. |
| 3 | Writer list incomplete | Accepted: added the audience-safety reply and the imported Linq reply. Both are handled by construction. |
| 4 | The selector is wrong on a slice (whole-transcript incompleteness, leading-assistant drop) | Accepted: slice mode (design 3). |
| 5 | Failed persists, in-memory binding and override bookmarks | Accepted: explicit rule for each (design 4). |
| 6 | Flat framing unproven for "Sure" | Accepted: the real-Codex journey is the shipping gate. If the reply still under-weights the offer, adjust the framing at the shared builder. |
| 7 | Retention and append-only claims inaccurate; collisions | Accepted: wording corrected and collisions bounded. |
| 8 | Markers are not literally seen | Accepted with a rationale: they record the thread's own actions (design 4). |
| 9 | Deploy and restore rotations; diagnostics closed sets | Accepted (design 7, failure modes). |
| 10 | The four deletions are safe, keeping the old bookmark on override and keeping the clear helper | Accepted. |
| 11 | Phase 2 stays separate | Accepted. |

## Review outcomes (ReviewGPT, mountain lane, 2026-11-09)

ReviewGPT reviewed the plan and the candidate implementation. Response: `audit-packages/plan-one-conversation-history.md`.

| # | Finding | Outcome |
| --- | --- | --- |
| R1 | P1: a failed save marks history seen before Codex accepted it (`thread/resume` ok, then `turn/start` fails), recreating the incident | Accepted. Failed outcomes carry no boundary; the same thread keeps its old bookmark and a new thread gets none (design 4). Their table also allowed advancing on proof of acceptance (`providerTurnId`); rejected as extra input for a rare path, since replay is always safe. |
| R2 | P1: the failed save bypasses the override durable-route rule | Accepted. One pure decision (`resolveAssistantSessionResumeState`) serves both saves; the failure callers now pass `assistantTargetOverride`. This deletes the separate override and next-state helpers. |
| R3 | A planner transcript-read failure became `'start'` | Accepted. It is now `undefined`, with a planning test that makes the transcript unreadable. |
| R4 | Keep the in-memory group reconsideration binding separate | Agreed; unchanged. |
| R5 | P2: an unknown rotation reason rejects the whole Web log batch | Accepted, using their tolerant-reader option (design 7) plus a batch test. Their alternative of extending the deploy admission probe was rejected as unnecessary once the reader tolerates unknown labels. |
| R6 | "Time advances" does not prove fingerprints are unique | Accepted. The wording is corrected (failure modes). |
| R7 | Selector slice mode, foreign-entry walk, steering acceptance, the four deletions, retention and restore, and keeping Phase 2 separate | Confirmed by the review; no change. |

## Implementation notes (after the Codex c7 implementation, Opus review)

- **Own entries include member messages the turn saved mid-turn.** These are steered active-turn inputs and the initial prompt saved at a no-reply finish or a held group selection. All of them go through `appendUserTranscriptEntryForTurn` in `local-service.ts`, which now records them into a turn-scoped `turnOwnTranscriptEntries` list. The finalizer receives that list as `ownTranscriptEntries`. Without this, the walk stopped at the turn's own steered message, and the next turn re-read the whole exchange.
- **A missing planning boundary saves no bookmark**, so the next turn rotates. Codex's first draft defaulted it to `'start'`, which would have replayed the entire bounded transcript into every resumed turn.
- **Tests that pinned the deleted behavior were updated to the new rule, not deleted:**
  - model-override continuity (3 tests);
  - the service-runtime override test;
  - stale-resume prompt history;
  - the group private handoff flow.

## Verification

- **Deterministic:**
  - The repro planning test passes.
  - New planning tests:
    - a bookmark with nothing after it resumes with no history;
    - entries after the bookmark from an isolated notification, a private completion, a quiet-turn member message, an override turn and an imported Linq reply all appear on resume;
    - a kickoff followed by an unseen user entry keeps the kickoff;
    - a missing or legacy bookmark rotates with the new reason;
    - a backdated import is included.
  - Finalizer tests:
    - the walk stops at a foreign entry;
    - failed persists never advance the bookmark;
    - the override keeps the old binding and bookmark;
    - the deleted clears now preserve.
  - Group reconsideration: the second request still resumes.
  - Existing tests that pinned the deleted clears are updated to the new rule.
- **Real Codex journey** ("game private kickoff then bare Sure continues the offer on the resumed thread"): fails on main, as above, and must pass on the branch. Reply review: Ready or Hold.
- **Existing live journeys** must stay green: group private handoff flow, approved vault-file continuity, and private-completion continuity if one exists.
- **ReviewGPT regressions:** finalizer tests for a failed save on the same thread (bookmark kept), on a new thread (no bookmark) and on an override route (durable binding kept); a planner test for an unreadable transcript; a Web batch test with an unknown reason.
- **PR ReviewGPT:** round 1 PASS per `agent-docs/operations/pr-reviewgpt-loop.md`.
Updated: 2026-11-09
Completed: 2026-11-09
