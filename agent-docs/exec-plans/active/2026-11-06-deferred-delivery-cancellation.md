# Preserve pending replies through existing runtime owners

Status: active

## Outcome

Keep an unanswered input eligible across delays and newer answered messages.
Carry its successive retry deadlines through the existing invocation timer.
Deferred background sends honor their current effect cancellation scope while
current-turn replies retain delivery priority.

## Architecture and constraints

Delete inferred-supersession and fifteen-minute age suppression, including their
scan, helper, result metadata and metrics. The user explicitly chose continued
retry over silent expiry. Keep the separate privacy content-retention policy,
historical terminal evidence, provider ambiguity protection and exact-token
claim cleanup. No new queue, timer, dependency, configuration or durable state.

The architecture review rejected a second admission set and a second retry
scheduler. The existing routed input batch and hot-wake owner are sufficient.
Keep dirty-window provenance, attempted wake-key protection and publication gates.
A timeout around quiescence merely encounters the same join during cleanup;
do not add it. Any separate process-liveness correction must prove its boundary
and reuse the existing container terminal owner.

The finished-watcher lifetime correction is independently owned in PR #4722.
This work does not mutate that worktree or the independently owned PR #4705.

## Product UX and verification

- Base regressions reproduced: cancelled deferred email/Telegram retries sent;
  background deadlines disappeared; a second scheduled retry never ran in the
  invocation; newer answered inputs suppressed earlier unanswered inputs.
- Input-selection proof keeps an hour-old unanswered message eligible and
  preserves historical suppression and privacy-retention behavior.
- Composed invocation proof runs retries at 30 and 60 seconds without another
  member message or an idle checkpoint. Aggregate reminder wakes do not acquire
  selected-input retry authority.
- Cancellation proof: no provider call before entry; exact prepared claim reset;
  later retry sends once; cancellation during provider entry remains ambiguous
  and cannot blindly resend; published current-turn delivery retains priority.
- 387 focused runtime tests passed across publication, maintenance, selection,
  phase, foreground entrypoint and wake gates. Nine priority tests passed.
  All 333 callback tests also passed (729 focused runtime tests total).
- Runtime, assistant-engine and Web typechecks passed. Changelog generation and
  four rendered changelog tests passed. Complexity guard passed with debt reduced.
- Focused real-Codex journey passed using gpt-6.1-sol and local subscription auth:
  one provider request, zero tool actions, one correct concise answer to a
  synthetic hour-old question. Reply reviewed: Ready. No production provider send.
- Package build passed for the isolated vault-share worker prerequisite.
- Final candidate review, exact-head CI and ReviewGPT remain pending.

## Deployment

Runner behavior only; no persisted or wire shape changes and no database migration.
Deploy after the finished-watcher correction. Old runners retain the old cutoff
and cancellation behavior until replaced. Existing terminal evidence is not
revived, including during rollback. Validate runner convergence and read-only
retry/delivery observations after deployment; local proof does not establish a
production rollout or real messaging-provider delivery.
