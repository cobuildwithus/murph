# Durable follow-ups through existing automations

Status: active
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Provide one durable, contextual follow-up to an original private outgoing message, for action reminders and important unanswered conversational questions. Reuse canonical automations, the outbox, cron, and hosted wake publication.

## Success criteria

- An original message can attach a bounded follow-up with explicit delay and self-contained instructions. Confirmed dispatch registers exactly one canonical one-shot; restart/retry cannot duplicate or resurrect it.
- Pending follow-ups appear in normal private conversation context. Relevant answers/cancellation archive them, explicit deferral patches them, and unrelated messages do not automatically resolve them.
- Due work reads current context and sends or skips once. No follow-up chains or general automation mutation authority in scheduled follow-up turns.
- Source evidence is retained while pending. Parent recurring revision changes invalidate children, while ordinary one-shot consumption does not. Input arriving before provider entry invalidates stale queued text without duplicate transport.
- Focused deterministic tests, relevant typechecks, real-Codex journeys, parent review, changelog and docs pass; open a PR on the task branch and complete required CI and ReviewGPT for the final candidate.

## Scope and ownership

Canonical automation owns pending work and existing status/expiry. Source outbox intent owns the immutable registration request and delivery evidence; follow-up outbox intent owns its evaluation frontier. Runtime projections remain derived. No new service, scheduler, table, record kind, general condition language, or classifier call per input.

Automations add immutable source and optional parent references. Source intents add the request (delay plus instructions); follow-up intents add the existing input cursor. Canonical registration looks up the source under the existing registry lock and uses normal automation IDs. The scheduler passes a narrow completion flag to distinguish ordinary one-shot consumption from parent edits.

## Product UX

Effort: feature. Cover private direct reminder occurrences and important private conversation questions, delayed/failed delivery, unrelated and resolving replies, user deferral/cancellation, incomplete history, quiet skip and expiry. Groups and output-only system notifications keep existing behavior. Ordinary original replies must survive rejected follow-up admission. Permit at most one child per source and two pending per conversation. The model chooses useful timing within a finite bound and respects existing cadence/decline policy; code enforces lifecycle, audience, and non-recursion.

## Tasks

1. Extend contracts and canonical serialization/query round trips; preserve immutable source binding and bounded registration under canonical locking.
2. Add one attachment action to the existing automation tool and carry the request through final-response/outbox composition.
3. Compose registration into durable terminal confirmation, source retention, and ordinary cron wake publication.
4. Add foreground pending projection, scheduled authority/parent checks, and queued-message freshness with replay-safe invalidation.
5. Amend assistant policy and owning architecture docs; add deterministic and real-Codex proof; review complexity and privacy.
6. Commit, push, open draft PR, mark ready when the candidate is stable, start ReviewGPT concurrently with CI, resolve review findings and required checks, and retain the open-PR worktree.

## Risks and mitigations

- Registration must not live in a best-effort post-send callback: use required terminal confirmation and existing retry ownership.
- A provider-entered intent cannot be rewritten: only replace a provably unsent candidate under the existing owner fence.
- Outbox count retention can remove recent source evidence: protect only sources of live finite children.
- Archived one-shot parents are normal consumption: explicit cancellation retires linked pending children, while recurring parent revision revalidation governs stale work.
- New persisted fields require serializer/mirror and snapshot proof, plus a documented rollback floor for runtimes that understand follow-up authority.

## Decisions

- Initial source: current main at 72d27c2d54d7134d90237000728126002b773383.
- Architecture consultation supports a narrow extension of existing automations; explicit delay is included so ordinary conversation is not forced onto one reminder interval.
- The task authorizes the requested PR and completion of its ReviewGPT loop, including in-scope remediation. No merge or production deployment is presumed.

## Verification

- Core follow-up ownership: five deterministic tests pass (registration replay, concurrent capacity, finite deferral, parent consumption/cancellation, stale parent revision).
- Engine outbox/planning/cron: 326 tests pass, including dispatch-before-registration, interrupted confirmation recovery without duplicate send, capacity rejection, queued-input invalidation, protected source retention, group exclusion, and scheduled retry without consuming the child.
- Actual pinned Codex App Server with scripted provider: two attachment-authority cases pass.
- Live Terra subscription journeys pass for reminder/question attachment, unanswered reminder, answered reminder, older unanswered question, and older answered question. The initial unanswered-reminder failure exposed missing host-supplied canonical context; the source context now includes the actual canonical follow-up and distinguishes no linked completion record from missing history.
- Relevant core/query/contracts/operator-config/engine/runtime typechecks pass; final affected checks will run after remaining evidence edits. Contracts generation succeeds.
- Complete initial Responses API captures use identical synthetic direct/group fixtures at base and candidate, the real pinned Codex runtime, production system-prompt builder and tool catalog, and gpt-tokenizer 3.4.0 o200k_base. After normalizing volatile IDs, timestamp, fixture paths and object ordering: direct 31,076 tokens / 142,794 UTF-8 bytes; group 26,925 / 124,150, identical at base/head (0, +0.00%). Both fixtures have no pending follow-ups. Deferred automation schemas and lazily read behavioral skill bodies are not loaded in the first request; the measurement excludes subsequent requests, not fields from the first request.
- Foreground adds one serial local canonical-list read, with 16 file reads at a time and at most two projected results; no database, network, model call, retry, or persistent index. Optional read failure yields empty projection, while due evaluation still validates evidence. Local synthetic lookup benchmark: empty 0.88 ms; 128 archived records median 10.62 ms; 4,096 records median 493.08 ms (five samples, warm filesystem). Base has no added lookup. Cost scales with retained canonical history; no second index is introduced. The existing outbox excludes failed intents from deduplication, so fresh evaluation can retain the occurrence token and create a new intent without changing cron identity.
- Product UX: Ready after the focused final checks. PR CI and final exact-head ReviewGPT remain required; no merge or deploy is authorized.
