# Typing recovery

## Outcome and invariants

Keep iMessage typing active for up to ten minutes while a turn works. Recover
from transient refresh failures, delayed progress delivery, and client-side
indicator clearing. Stop must cancel queued recovery and never revive a finished
turn or release another session's target claim.

## Owners and evidence

The assistant-engine channel activity session owns timers and serialized provider
calls. Assistant-runtime owns per-target admission and cooldown. Synthetic
reproduction demonstrated that a single failed refresh disables all later work
and delivery after the one-second restart clears the indicator until the next
45-second tick. Linq documents stop/start recovery after reopening unread chats.
No private conversation data belongs in this plan or its tests.

## Product UX (Patch)

- Outcome: longer, recoverable typing while work continues.
- Reaches: existing direct/group iMessage typing sessions; preserve other channels.
- Proof: fake-clock provider simulations for long turns, late sends, refresh
  failures, chat reopen, final delivery, cap cleanup, and old-session cleanup.

## Implementation and verification

- [x] Extend both existing cap owners to ten minutes.
- [x] Keep one serialized timer loop; add one bounded post-message follow-up,
  recover failed refreshes, and use Linq stop/start refreshes.
- [x] Bind hosted claim release to its exact state identity.
- [x] Run focused engine/runtime tests and typechecks, inspect complexity/diff.
- [x] Add public-safe release note and complete review; archive with the scoped commit.

## Boundaries

No new durable state, queue, database call, prompt change, or reply-path wait.
Typing remains best-effort provider UI. Each refresh makes two serial provider
calls; progress schedules an extra bounded refresh before normal cadence resumes.
No web/runtime wire change; runner rollout activates the behavior.

## Candidate review and evidence

- Engine channel runtime and delivery-service suites: 114 tests passed.
- Hosted channel activity suite: 22 tests passed.
- Engine and assistant-runtime typechecks passed.
- Complexity diff passed: existing unrelated send functions retain their prior
  debt; typing changes add no over-threshold function.
- Reviewed changed source, tests, timer sequencing, cooldown identity, cap
  cancellation, and privacy. No unrelated code or generated files are included.
- Product UX: Ready at the provider-call boundary for the selected patch paths.
  Synthetic provider state proves delayed-send recovery, unread-chat reset,
  transient failure recovery, terminal cleanup, and cap enforcement. There are
  no changes to route authority, message content, prompt input, or billing.
- Runtime effects: regular refresh becomes a serialized DELETE/POST pair every
  45 seconds; each progress schedules up to two such pairs at one and five
  seconds. Existing provider timeouts and abort signals remain in force. No
  foreground message/model operation awaits these scheduled refreshes.
- Limit: stop/start may briefly clear a visible indicator; this is required by
  Linq to recover indicators hidden by reopening unread chats. Message delivery
  beyond the bounded follow-up waits for the next regular refresh. Provider
  acceptance cannot prove actual device rendering; live device proof follows
  an authorized rollout.
- Delivery path: local scoped commit; no PR, push, merge, or deploy requested.
  The PR-only external review/CI gates apply when a PR is opened.

## Final validation

The changelog archive suite passed all nine tests (145 focused tests total).
Web typecheck initially could not resolve an unbuilt device-syncd service export;
`pnpm --filter @murphai/device-syncd build` produced the required declarations,
and `pnpm --dir apps/web typecheck:prepared` then passed. Engine and runtime
checks used `pnpm --filter @murphai/assistant-engine --filter
@murphai/assistant-runtime typecheck`. The checkout contains only the seven
intended source, test, contract, plan, and release-note files. No generated
artifacts are committed. The release note has no PR references because this is
a local commit; add the actual PR reference when opening the release PR.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
