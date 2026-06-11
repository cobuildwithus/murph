# Codex thread-aware event correlation and subagent usage accounting

## Goal

Make Murph's codex app-server client thread-aware so that events from codex
subagent threads (native `spawn_agent` children) neither fail the parent turn
nor escape usage accounting. This lands the two primitives required before the
codex collab/multi-agent feature can ever be enabled; it does NOT enable that
feature.

Success criteria:

- An event stream containing interleaved child-thread events (own
  `thread_id`/`turn_id`) completes the parent turn successfully; today the
  first such event rejects the turn with
  `ASSISTANT_CODEX_APP_SERVER_STALE_TURN_EVENT`.
- Per-child-thread token usage is recorded into `hosted_ai_usage` as
  additional usage rows on the parent turn (existing
  `providerRequestOrdinal >= 1` seam), with child thread id carried in the
  row's `rawUsageJson` (decision: `gateway_tags_json` is populated from
  per-turn usage attribution, not per-draft; `rawUsageJson` is the existing
  per-draft JSON column and needs no recording-path change) and the child
  model attributed from parent-thread spawn items.
- Parent-thread correlation strictness is byte-for-byte unchanged: events on
  the parent thread with a mismatched/missing turn id still reject exactly as
  before.
- No codex feature flags flipped; no behavior change for today's
  single-thread production turns other than tolerating foreign-thread events.

## Why (evidence)

Verified 2026-06-10 against the `../codex` checkout (2026-05-29, `27e256bc40`):

- App-server auto-attaches every initialized connection as a listener for
  every newly created thread, including spawned subagent threads
  (`codex-rs/app-server/src/lib.rs:1024`, `in_process.rs:489`;
  `thread_processor.rs:2378` has no source filtering). Child events WILL
  arrive on Murph's connection.
- Token usage notifications are thread-scoped and carry `thread_id` +
  `turn_id` (`bespoke_event_handling.rs:1574`). Codex ships no aggregate
  usage primitive: no usage RPC, no usage field on the protocol `Turn`
  (`app-server-protocol/src/protocol/v2/thread_data.rs:153`), no parent-side
  aggregation of child usage, and collab wait/close results carry no usage.
  Consuming per-thread `thread/tokenUsage/updated` events is the canonical
  upstream pattern.
- Murph's client correlates every incoming event against a single
  `expectedTurnId` and ignores `thread_id` entirely
  (`packages/assistant-engine/src/assistant-codex.ts` —
  `validateWarmTurnEventCorrelation`, `bindExpectedTurnId`,
  `codexEventMethodRequiresTurnCorrelation`); mismatches call
  `rejectOnce(...)`, failing the turn. The "one thread per connection"
  assumption was never codex's contract.
- Usage extraction resolves tokenUsage events for the parent turn id only
  (`packages/assistant-engine/src/assistant/providers/helpers.ts` —
  `extractCodexAssistantProviderUsage`,
  `resolveAssistantCodexThreadTokenUsageTotalDelta`), so child usage would be
  silently dropped from `hosted_ai_usage`.
- The recording seam for extra per-turn provider requests already exists and
  is proven by image generation: `recordAdditionalAssistantUsageEvents`
  (`packages/assistant-engine/src/assistant/service-usage.ts`) writing rows
  with `provider_request_ordinal >= 1`. `hosted_ai_usage` needs no schema
  change (`requested_model`/`served_model` per row, `gateway_tags_json` for
  the child thread id).

## Constraints

- Utmost priority: clean, simple, long-term maintainable, composable, minimal
  complexity. The change is "make the existing client honor the protocol's
  thread dimension", not new orchestration machinery.
- Do not enable `Feature::Collab` / `multi_agent_v2` in hosted codex config;
  that is a separate follow-up task (config + prompt guidance + e2e).
- Do not weaken parent-thread correlation or any production runtime/auth/env
  invariant for tests.
- No schema changes to `hosted_ai_usage`.
- Secret-safe: no raw event payloads with user content in logs/usage JSON;
  reuse existing sanitization (`sanitizeAssistantProviderRawUsageJson`).
- Preserve unrelated dirty work; implement in a `murph-*` worktree on a task
  branch with a PR.

## Approach

1. **Thread identity extraction** (`assistant-codex.ts`): add a
   `extractCodexThreadIdFromMessage` sibling to the existing
   `extractCodexTurnIdFromMessage` (notifications carry
   `params.threadId`/`thread_id`). The parent thread id is already known
   (`codexThreadId` from thread/start response or resume binding).
2. **Routing gate ahead of turn correlation**: in the single message-accept
   path, if a message carries a thread id that differs from the parent's,
   append it to a per-thread `childThreadEvents` buffer and return — it never
   reaches `validateWarmTurnEventCorrelation`, so parent strictness is
   untouched. Messages without a thread id keep today's exact behavior.
   Bound the buffer (count/bytes) with a diagnostic counter so a runaway
   child cannot balloon memory; overflow drops oldest events and marks the
   child usage draft `truncated`.
3. **Per-child usage extraction** (`providers/helpers.ts`): a small exported
   `extractCodexChildThreadUsages(childEventsByThread, spawnEvents)` that
   reuses the existing pure `resolveAssistantCodexThreadTokenUsageTotalDelta`
   per bucket. Model attribution comes from `CollabAgentSpawnEnd`
   notifications, which arrive on the PARENT thread and carry
   `new_thread_id` + effective `model` after inheritance/role overrides
   (`../codex/codex-rs/protocol/src/protocol.rs:3703`, forwarded to clients
   at `app-server/src/bespoke_event_handling.rs:831`) — build the
   threadId→model map from the parent stream and stamp each child usage
   draft's `requestedModel`/`servedModel`. This makes multi-model billing
   work with the existing per-row model columns and downstream meters;
   per-model spend queries over `hosted_ai_usage` need no change.
4. **Recording**: pass child usage drafts through the existing
   `recordAdditionalAssistantUsageEvents` seam with continuing
   `providerRequestOrdinal`, child thread id in `gateway_tags_json`, and a
   distinct usage source label (e.g. `codex-subagent-thread`).
5. **Tests** (scripted runtime + helpers unit tests):
   - parent turn completes when child-thread events (tokenUsage, item/*,
     turn/*) interleave mid-turn;
   - child usage rows recorded with correct first/final delta per child,
     multi-child interleaving attributed correctly, including two children on
     DIFFERENT models (spawn-end → model stamping) and the null-model
     fallback when a spawn-end event is absent;
   - parent-thread strictness regression: same-thread foreign-turn event and
     thread-id-less foreign-turn event still reject exactly as today;
   - buffer overflow drops events without failing the turn.

## Out of scope (follow-ups, separate plans)

- Enabling collab tools in `hosted-runtime/codex-config.ts` + assistant
  prompt guidance for delegation (model-choice policy: mini for mechanical
  scans, same-tier for vault-writing work).
- Hosted-local e2e with a real spawned agent.
- Any upstream codex contribution for an aggregate usage RPC.

## Verification

- `pnpm test:diff packages/assistant-engine` (owner-scoped) plus the new
  focused tests.
- `pnpm --dir packages/assistant-engine typecheck`.
- Standard repo change audits per workflow routing: `coverage-write` and
  `task-finish-review`; add `security-privacy-review` only if review finds
  the change touches trust boundaries beyond event parsing (not expected:
  ingress events are already consumed by this client today).

## State

- Implemented, reviewed, and verified in worktree `murph-codex-thread-aware-usage`.

## Done

- Root-cause investigation of both repos (evidence above).
- Implemented thread-aware routing, bounded per-child token-usage buffering
  (32-thread cap, dropped-thread set), child server-request denial, and
  per-child usage drafts on both the success result and the failure context.
- PR-review hardening (2026-06-11): (a) subagent notifications arriving
  BETWEEN turns no longer poison the warm process — the process remembers its
  bound thread id and tolerates idle foreign-thread notifications (denying
  their server requests), while idle same-thread output still poisons;
  (b) evidenced subagent threads win buffer slots at the 32-thread cap by
  evicting an unattributed sample; (c) billing evidence broadened from
  spawn-only to ANY parent collab tool call naming receiverThreadIds
  (sendInput/wait/resume — covers reused children), model attribution still
  spawn-only. Between-turn child usage is tolerated but never billed — the
  supported delegation pattern is spawn+wait within a turn.
- Review hardening (task-finish-review finding): billing is gated on spawn
  evidence — only threads named in a parent-thread collab spawn item's
  `receiverThreadIds` produce drafts, because warm processes are reused
  across threads and a stale flush from a previous thread must never mint a
  usage row. Unattributed threads are counted via
  `unattributedSubagentUsageThreadCount` in draft rawUsageJson.
- Tests: unit (drafts builder incl. spawn-evidence gate, prompt non-leak,
  snake_case tolerance), integration on the MockChildProcess harness
  (tolerate+record multi-model, deny child server request, strictness
  regression, failure-context drafts, 33-thread cap with per-thread dropped
  count, ordinal continuity after generate_image), thread-id extractor unit
  coverage.
- Verification: `pnpm --dir packages/assistant-engine typecheck`;
  `pnpm test:diff packages/assistant-engine` green (incl. apps/cloudflare
  verify); focused vitest runs green.

## Now

- Final commit via `scripts/finish-task` and PR.

## Next

- Follow-up (separate plan): enable codex collab tools in hosted codex
  config + delegation prompt guidance + hosted-local e2e with a real spawn.

## Open questions (UNCONFIRMED if needed)

- RESOLVED (2026-06-10): child model attribution comes from parent-thread
  `CollabAgentSpawnEnd` notifications (`new_thread_id` + effective `model`);
  see Approach step 3. Fallback if a spawn-end event is missing for a child
  bucket: record rows with null model + child thread id tag (still visible
  spend).
- RESOLVED (2026-06-10): codex v2 notifications use camelCase
  (`params.threadId`, `tokenUsage.{total,last}`, item `type:
  'collabAgentToolCall'`); the extractor also tolerates snake_case and dotted
  method aliases, with unit coverage.

## Working set (files/ids/commands)

- `packages/assistant-engine/src/assistant-codex.ts`
- `packages/assistant-engine/src/assistant-codex/failures.ts`
- `packages/assistant-engine/src/assistant/providers/helpers.ts`
- `packages/assistant-engine/test/assistant-codex-subagent-usage.test.ts`
- `packages/assistant-engine/test/assistant-codex-runtime.test.ts`
- `packages/assistant-engine/test/assistant-codex-failures.test.ts`
  (`service-usage.ts` needed no change — the existing
  `recordAdditionalAssistantUsageEvents` seam already handles the drafts)
- Reference: `../codex/codex-rs/app-server/src/bespoke_event_handling.rs`,
  `../codex/codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
