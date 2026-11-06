# Conversation batching without background sequence barriers

## Outcome and invariant

Batch adjacent messages in the same conversation even when background mailbox
events were accepted between them. Preserve missing-message, conversation,
actor, reply-anchor, projection, capacity, and current-input authority checks.

## Evidence and design

The existing selector treats adjacency in the shared causal sequence as message
adjacency. System events advance that sequence independently of the conversation
lane. The existing conversation lane sequence already proves message adjacency;
reuse it, retaining positive and increasing causal sequences for effect ordering.
Use the same predicate for initial selection, live admission, and accepted-input
revalidation. No new state, queries, scheduler, schema, or device-specific bypass.
System fact application and Web's field-level causal mutation checks retain their
current owners. The terminal accepted message remains the effect anchor.

## Work and proof

- Update the existing successor predicate and owner contract.
- Prove same-chat batching and live admission across system-sequence gaps;
  preserve gaps in the conversation lane and invalid/legacy chronology rejection.
- Cover direct/group, reply-anchor and room boundaries, projection waits, the
  existing 50-input cap, pending recovery, and terminal accepted-input authority.
- Run the focused runtime tests and relevant typecheck, then a synthetic real
  Codex compound-message journey through production builders.
- Review complexity and privacy, record member-facing release notes, and commit.

## Product UX

Patch: people with queued same-chat messages should get one coherent answer
without waiting for a separate earlier turn merely because device sync ran.
Separate conversations and reply anchors remain separate; unavailable attachment
evidence remains a barrier. No timing guarantee or change to sync scheduling.

## Compatibility and completion

Existing stored lane/causal fields suffice. Older runtimes keep splitting batches;
new runtimes use conversation adjacency. No wire or schema migration is needed.
## Validation

- Runtime turn-input suite: 49 tests passed, covering foreground/recovered/live
  batching, conversation and reply boundaries, projection readiness, capacity,
  invalid sequences, terminal accepted-input authority, and direct/group
  selection-to-input-source handoff.
- Assistant Runtime and Assistant Engine typechecks passed.
- Complexity guard passed: one production file, zero debt and no hotspots;
  maximum cyclomatic complexity remains 18. No awaited operation was added.
- Release-note tests: 10 passed. Documentation drift and diff whitespace checks
  passed. The optional full Web typecheck was stopped under local resource
  contention; no Web code or configuration changed.
- Focused real-Codex direct and group journeys both passed on gpt-5.6-terra via
  the local subscription lane. Each used one provider request, answered both
  synthetic messages correctly, and made no capability action, media, or card.
  Reply review: Ready. Earlier profiles failed before provider action; retries
  stopped on the first working profile, which ran both scenarios.
- Commands: `pnpm test:assistant:live -- --test 'answers both resumed bottle messages in one turn \\(group=false\\)'`
  and the corresponding `group=true` pattern, using the supported alternate-home
  option. Authentication material and profile paths are omitted.
- Parent review finds no new state, I/O, dependency, schema, or product boundary
  owner. Scope is a local fix and scoped commit; no PR or production rollout is
  part of this task. Existing older runtimes retain their prior batching behavior.
Status: completed
Updated: 2026-09-15
Completed: 2026-09-15
