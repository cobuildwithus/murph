# Defer device cron history deletion and thin session cleanup

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and boundaries

Both deletion proposals are deferred. The candidate device-file policy did not
prove that an eligible file has no remaining writer. All code and test changes
from the retention candidate are removed, including the cron pruning lock,
abort/yield plumbing, contention catch, deferred note, and maintenance timestamp
change. Runtime behavior is identical to the parent commit: existing generic
cron history retention and response redaction continue without the cron lock.
No new deletion policy, flag, queue, state owner, or model behavior ships.

## Device history: safety check failed, change omitted

The proposed rule accepted a device occurrence when all rows were settled, every
completion was at least fourteen days old, and the job had no pending delivery,
running claim, or enabled next run. A disabled job with an old failed run meets
that predicate but is still manually runnable:

- `cron.ts:setAssistantCronJobEnabled` accepts local device jobs and can pause a
  failed retry without clearing its history or changing its id.
- `cron.ts:runAssistantCronJobNow` resolves raw local jobs. The local branch of
  `cron/execution.ts:claimResolvedAssistantCronJob` rejects running and pending
  jobs, but accepts disabled jobs with old completions.
- `executeClaimedAssistantCronJob` appends a run before removing or updating the
  local owner. Even stale device parent authority appends a `skipped_gate` row.
  Thus a claim after pruning's job-store read can append after the history read
  and before unlink. Atomic job-store replacement does not fence that sequence.

Synthetic proof used a one-shot device job with genuine device metadata, one
nineteen-day-old failed row, and the public disable operation. The assertion
that pruning preserves this manually runnable history failed (exit 1); a
second case passed by calling the public manual-run operation and observing two
rows under the same id, including `device_activity_authority_stale`. No provider
or delivery was invoked. After restoring parent behavior, both cases passed
(exit 0). The temporary probe was removed so this commit only documents deferral.

Other paths checked:

- Occurrence ids hash automation id, activity entity id, triggered time, and
  occurrence time in `device-activity-automations.ts`. Different occurrence
  tuples have different hash inputs; same-id manual execution remains possible.
  The scheduler also has an existing-job replacement branch, so deterministic
  identity alone is not an immutable-history proof.
- Execution finalization has the production append sites. Local reconciliation
  rewrites a pending run before clearing/removing its pending job owner; a
  pending owner or row blocks the candidate deletion at that instant.
- `writeAssistantCronStore` uses the shared assistant-state JSON writer and
  `runtime-state/src/atomic-write.ts`: write a sibling temporary file, then
  rename. An unlocked read sees a complete old or new file, not a torn write.
- History redaction/retention also rewrites run files. Missing-history reads
  return an empty list, while output-history scope excludes device occurrences.
  Neither reader behavior nor atomic writes closes the manual-revival race.

Per the lane's stop condition, do not add another lock strategy or broaden the
predicate here. A future policy needs a separate proof covering revival and all
writers. The candidate's generic-limit exemption for device rows is also
removed: this is a deferral, not a partial retention-policy change.

## Thin sessions: safety check failed, change omitted

The approved candidate policy was zero or one turn, idle at least ninety days,
no native resume, and no references, with bounded deletion and routing cleanup.
No session/transcript deletion or routing change is implemented. A reference
inventory alone is not an absence proof at deletion time:

- `runtime-budgets.ts` holds `withAssistantRuntimeWriteLock`.
- `cron/authoring.ts:addAssistantCronJob` publishes a new canonical-runtime
  session pin under the independent cron lock, without the runtime lock.
  `cron.ts:setAssistantCronJobTarget` also maintains continuity under that lock.
- `core/src/automation.ts:upsertAutomation` uses the canonical automation-registry
  lock. Canonical route writes are not fenced by the assistant runtime lock either.
- Consequently a maintenance reader can observe no pin, a writer can publish a
  pin, and maintenance can unlink the now-referenced session. A final reread
  merely moves this race. The idle wake guard does not fence these writers.

A synthetic lock probe confirmed the counterexample (exit 1 for the intended
safety assertion): hold runtime maintenance's lock after reading an empty cron
store; from an independent async context acquire the cron lock, publish a
session pin, and read it back before releasing runtime maintenance's lock.
The new pin was visible while the maintenance lock remained held. No session
was deleted by the probe. This is evidence about existing lock coverage, not a
claim that every possible coordinated retention design is unsafe.

Closing this requires coordinated reference publication/deletion across owners,
not just a bounded file loop. Stop at this safety failure rather than expand the
lane into reference-writer changes. No claim is made that session thinning or
its fresh-conversation, unknown-id, routing-rebuild, or repeated-pass proofs ran.

## Session reader and reference decisions

Paths below are relative to `packages/assistant-engine/src/assistant` unless
qualified. The review's line numbers were checked against current source.

| Reader or retained family | Decision for a future deletion pass |
| --- | --- |
| `store.ts` retention, resolution/migration, list/get/save; `store/persistence.ts` routing rebuild | Session files own binding, alias, target and history. Conversation lookup can create; explicit unknown ids throw. Delete routes/recent rows with the canonical session, and prove rebuild from survivors; cached/listed session snapshots must not race deletion. |
| `session-resolution.ts`, `service-turn-routes.ts`, `automation/reply.ts` | Conversation-based resolution can start fresh; explicit session ids keep unknown-id semantics. Input conversation locators can carry ids and aliases. Protect unresolved accepted inputs and their routes, not only explicit id fields. |
| `cron/store.ts`, `cron/runtime-state.ts`, `cron/authoring.ts`, `cron/mutations.ts`; canonical automations | Protect local target ids/aliases and canonical runtime continuity pins, including paused/archived reactivation. Independent reference writers are the blocking safety gap. |
| `outbox.ts`, `notification-turn.ts`, `connected-channel-greeting.ts` | Retain sessions referenced by all surviving intents, including terminal intents: notification/welcome replay dereferences their session and binding promotion needs it. Terminal status alone does not make the id disposable. |
| `private-completion-continuity.ts` | Protect both `privateCompletionContinuitySessionId` and the prepared/applied continuity object's session id; replay imports and repairs coupled transcript/turn-count state. Route-matching unbound intents also need assessment. |
| `ask-continuation.ts`; runtime `events/assistant-ask-completion.ts` | Pending completion carries an origin session and accepted-input id; absent origin session suppresses delivery. Protect live continuations and source inputs. Their remote owner must not be inferred absent from local outbox alone. |
| `turns.ts` receipts | Completed/deferred receipt ids are filtered and copied into terminal snapshots without loading the session; the historical receipt alone is not a pin. A nonterminal receipt or associated pending input, intent, or recovery journal must retain its session. Receipt terminality does not establish terminality of those other owners. |
| `automation/evidence.ts` terminal evidence | Historical session ids are copied during terminal backfill and used with handled-input deduplication; that path does not load the session. Evidence alone is not a pin, but its linked surviving outbox intent remains a pin under the outbox decision above. Neither an evidence file nor its absence proves all other references settled. |
| `active-turn-input-journal.ts` and `input-store.ts` | Additional readers omitted from the review inventory: accepted input journals hold session transcript references, and input conversations accept session ids/aliases. Protect these until the owning pending/recovery work is gone. |
| `automation/intent-provenance.ts`, `automation/cross-session-route-state.ts` | Provenance identifies turn/intent membership with receipt fallback; route state tracks exact input-route progress. Neither is an authoritative complete session-reference inventory. |
| `maintenance-evidence.ts`, `connected-channel-greeting.ts` context listing | Enumerate extant sessions and bounded transcript tails. Approved thinning deliberately loses this old context, but must not erase a recovery intent's session. |
| `game-chat-bootstrap.ts`, `outbound-channel.ts` | Bootstrap adopts the explicit current session and repairs accepted delivery from its transcript; outbound sends resolve and save binding state. Active work must be fenced, not protected by age alone. |
| Runtime `pending-input-index.ts` | Imported self-authored reply recovery resolves a conversation then deduplicates transcript entries. Preserve sessions for pending inputs; do not mistake id-free input routes for no dependency. |
| Runtime `hosted-runtime.ts` and `direct-assistant-session-route.ts` | Thread lookup delegates to `findAssistantSessionIdByCodexThreadId` and depends on resume state. Direct-route export enumerates sessions; no repository caller was found. No-resume gate protects rollout/thread requirements. |
| `runtime-state/src/hosted-bundles.ts`; `state-secrets.ts` | Snapshot rollout selection follows saved native resumes. Session secret sidecars and legacy serialization must be considered with the canonical session; deleting only JSON/transcript is not a complete storage audit. |

## Rollout and rollback

Documentation only; no runtime rollout order, schema migration, or version-skew
requirement is introduced. Do not ship the superseded deletion candidate.
Reverting this amended commit changes documentation only. Existing histories
are untouched by this lane; no recovery or data rollback is needed. Existing
unrelated persistence compatibility floors still apply.

## Verification

- `pnpm install --prefer-offline`: exit 0.
- Runtime/CLI dependency builds, restored engine/runtime/CLI builds, CLI surface
  artifact assembly, and Web Prisma generation: exit 0 for each command.
- The failing-first probe exited 1 (one expected failure, one passing writer
  case); restored parent behavior exited 0 (both cases passed).
- Full `pnpm --dir packages/assistant-engine test`, two workers: exit 0;
  310 files passed, ten skipped; 6,120 tests passed, 786 skipped.
- `pnpm complexity:diff`: exit 0; no authored JS/TS changes relative to the base.
- Exact parent source/test comparison, whitespace check, and privacy scan: exit 0.
- Full `pnpm --dir packages/assistant-runtime test`, one worker: exit 1;
  194 files passed, one failed, one skipped; 4,339 tests passed, one failed,
  seven skipped. The only failure was the ten-second real-time harness timeout
  in `hosted-runtime-interrupted-system-recording.integration.test.ts`,
  `fresh-foreground`. The complete nine-case file passed alone with unchanged
  timeouts, exit 0. This is load-related; the full-suite exit remains 1.
- Full `pnpm --dir packages/cli test`, one worker: exit 0; 131 files passed;
  1,264 tests passed, twenty-nine skipped.
- Root `pnpm typecheck`: exit 0, including package and app checks.

## Review and remaining evidence

The final source and test trees match the parent commit. This lane adds only
public-safe deferral evidence and the task-owned Frog notes. The scoped commit
wrapper has no amend mode; its temporary child is folded into the original
local commit with a soft reset and `git commit --amend --no-edit`.
No public changelog or real-model journey is needed because no runtime behavior
ships. Push, PR, ReviewGPT, CI, and deployment remain with the parent. No
production data, credentials, latency, or deployed file-count measurements were
used. Device-deletion outcome tests are withdrawn with the rejected policy;
the lane makes no claim that unlocked device deletion is safe.
Completed: 2026-11-06
