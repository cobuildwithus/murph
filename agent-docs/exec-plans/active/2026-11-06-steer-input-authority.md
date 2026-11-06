# Derive hosted tool authority from accepted turn inputs

Status: active
Created: 2026-11-06
Updated: 2026-11-06

## Goal

A message that arrives while Murph is working must never silently break a later
tool in that turn, and the fix must leave the container runtime thinner than it
found it. The owner's standing target: the Murph runtime in the container is as
thin an adapter over native Codex as possible. Default to deletion. Add
machinery back only when a failing test, measured bottleneck, security
requirement, or concrete product need proves the simpler design insufficient.

## The bug

In production, a member asked Murph to change reasoning effort in a private chat
and sent a second message while the turn was running. Codex accepted it through
native `turn/steer`. `assistant_configuration` then returned `assistant
configuration updates require user-sourced input`, nothing reached Web, nothing
was saved, and Murph told the member so. Proven on real code: the id is valid
until the steer is acknowledged, then `null` while the provider keeps running.

Cause: the runtime keeps two records of "which user inputs this turn accepted".

- `acceptedInputItemsForProviderRequest` in `local-service.ts`, exposed as
  `currentUserActionScope()`. Built per turn. Survives steers. Drained by
  `beforeToolExecution` before every dynamic tool call, so at a tool call it
  holds exactly the inputs the model has seen.
- `currentAssistantInputId`, a mutable closure variable in `hosted-runtime.ts`,
  threaded through `workspace-assistant-phase.ts`, `execution-context.ts` and
  `hosted-tool-context.ts`. Set by `beforeProviderAcceptedInputs`, cleared by the
  release that hook returns. `tryStartLiveSteers` runs that release at steer ack,
  so a steer wipes it for the rest of the live provider turn.

The second record is the shadow turn state that
`docs/contracts/00-invariants.md` ("Trust Codex Native Capabilities") forbids.
`readCurrentInvocationScope` already derives the same answer as
`acceptedInputIds.at(-1)`. A rejected first attempt added a scope counter so the
variable survived steers. That patches the shadow state instead of removing it.

## Proposal

Delete `currentAssistantInputId` and derive from the accepted list.

1. Remove the variable, its three writes, and its accessor from
   `hosted-runtime.ts`, the phase input field and pass-through, the
   execution-context field and normalizer, and the hosted-tool-context accessor
   plus `readRawCurrentAssistantInputId`.
2. Remove `currentInputId` from `resolveHostedCurrentInputIdForAcceptedInputs`,
   with the batch-selection branch that exists only to compute it, and rename the
   function for what is left.
3. Point every consumer at one derivation, `acceptedInputIds.at(-1)`:
   - `assistant_configuration` update
   - subscription and iMessage contact claims
     (`readCurrentUserActionAssistantInputId`)
   - the hosted image completion restriction
     (`readCurrentHostedImageCompletionEffectScope`)
   - the image origin fallback and physical-note completion lookup
4. Delete the legacy personalization branch that reads the raw id, if no context
   still lacks `currentUserActionScope`.
5. Once the id is gone, the release returned by `beforeProviderAcceptedInputs`
   has one job left: re-arming device-import admission at provider return (#4490,
   a measured stall). Every other hook returns void. If that re-arm can move or
   go, delete `AssistantProviderAcceptedInputsRelease`, the `try/finally` in
   `tryStartLiveSteers` and `codex-turn-runner.ts`, and
   `releaseAssistantProviderAcceptedInputsAfterClaimFailure`.

No Web, schema, wire-format, or deploy-order change: `assistantInputId` stays in
the tool request and Web keeps validating the live mailbox row. This only changes
how the runner chooses the id it already sends.

### Behavior changes

| Situation | Today | After |
| --- | --- | --- |
| Tool call after a steer ack | `null`, tool rejected | latest accepted input, tool runs |
| Steer in flight at a tool call | variable ahead of list, claims return `null` | `beforeToolExecution` drains first, one answer |
| Accepted batch mixes assistant and system inputs | `null` | assistant input, matching `currentUserActionScope` today |
| Cron or notification turn | `null` | empty list through the trigger filter |
| Between provider turns in one phase | cleared by release | per-turn list, cannot go stale |
| Image completion restriction after a user steer | stays restricted once the id is `null` | lifts when a newer user input is accepted |

## Scope

- In scope: the deletions above, a regression test for tool-after-steer, and any
  deletion review proves safe in the same seam.
- Out of scope: a rewrite of the runtime. Larger simplifications become ranked,
  separately landable follow-ups.

## Constraints

- Murph still owns accepted-work durability, user and target authority,
  stale-output rejection, privacy, canonical writes, delivery authority and
  irreversible effects.
- Runner-only change. Cloudflare runtime deploys are manual from `main`, so Web
  and runner must stay compatible either way.
- Repository is public: no member identifiers or private data here.

## Risks and mitigations

1. Risk: `.at(-1)` picks a different input than the old sorted batch tail.
   Mitigation: the authority consumers only need a live accepted input of this
   member; Web revalidates it. Prove any consumer that needs ordering.
2. Risk: the image completion restriction lifts too early.
   Mitigation: keep its tests; add a steer case.
3. Risk: device-import stall returns if the re-arm moves.
   Mitigation: keep the #4490 tests green; do not remove the behavior without a
   replacement signal.

## Review questions

1. Is the slice correct and complete? Name anything that needs the old timing.
2. Is there a simpler design than `acceptedInputIds.at(-1)`? For example, should
   `assistant_configuration` keep any runner-side gate at all, given Web checks
   the mailbox row and planning already scopes the tool?
3. Can the release protocol go entirely? What is the smallest honest home for the
   device-import re-arm, or can a simpler signal replace the 30-second admission
   window?
4. How should this seam get to thin overall? Measured today: 215k source lines in
   `assistant-engine` and `assistant-runtime`; `hosted-runtime.ts` 9,676 lines
   with 117 `let` bindings; `workspace-assistant-phase.ts` 9,547;
   `assistant-codex/dynamic-tools.ts` 8,695; `assistant-codex.ts` 6,699;
   `automation/reply.ts` 5,877; `local-service.ts` 3,419;
   `active-turn-input-controller.ts` 1,295; `AssistantHostedExecutionContext` 65
   fields beside `AssistantHostedToolContext` 71. Codex itself is driven through
   few RPCs: `thread/start`, `thread/resume`, `turn/start`, `turn/steer`,
   `turn/interrupt`, `config/read`.
   Rank the largest safe deletions. Candidates to judge, not assumptions:
   - Does native `turn/steer` plus one durable accepted-input record remove the
     need for the provider-ack and local-admission two-phase in
     `active-turn-input-controller.ts`, including
     `drainLiveSteeredActiveTurnInputs`?
   - Can the execution-context and tool-context bags, and the normalizer between
     them, collapse into one?
   - Which `before*` hooks between `hosted-runtime.ts` and the engine are shadow
     lifecycle rather than a named Murph-owned boundary?
   For each, say delete, shrink or keep, with the invariant that decides it, and
   name the next PR-sized step. Do not propose a big-bang rewrite.

## Tasks

1. Get the ReviewGPT architecture review and record each finding below.
2. Add the composed tool-after-steer regression test.
3. Make the accepted deletions.
4. Run focused tests, typecheck, and the standing Codex deep review.

## Decisions

ReviewGPT architecture review, 2026-11-06. It approved deleting the ambient id
and corrected the plan's wording. Each finding was checked against the code.

Accepted:

- Delete the ambient id, its pass-throughs, the agreement check, and the
  `currentInputId` batch selection. Done.
- "Every consumer uses `.at(-1)`" was too broad. The tail stands for ordinary
  user authority only. Exact approving inputs (`messageRef`) and the exact
  completion identity stay as they are. Confirmed by
  `dynamic-tools-generate-image.test.ts` and `assistant-physical-notes.test.ts`.
- The completion restriction reads `getUserActionAcceptedInputIds` directly.
  `readCurrentUserActionScope` depends on that reader, so calling the scope would
  recurse.
- Keep a runner-side check on `assistant_configuration`. Runner and Web prove
  different facts: the runner proves the input is admitted to this tool call, Web
  proves the row is live and belongs to the member. Planning does not scope the
  private tool to user turns, so plan question 2 is answered: keep it.
- Keep `drainLiveSteeredActiveTurnInputs`. It is what makes the derivation safe:
  a tool only sees inputs admitted through its delivery ordinal. The proposal to
  question 4's first candidate is rejected on this evidence.
- Keep the 30-second device-import window and its provider-return re-arm. The
  re-arm protects foreground persistence after provider return and has integration
  coverage, so the release callback stays this slice with only that job.
- Add a composed regression through the real steer path; the old local-service
  test only injected an id. Added, and that old test is deleted.

Adjusted after checking the code:

- Image origin needs no fallback at all. `readCurrentInvocationScope` derives its
  accepted origin from the same tail, so `explicit ?? userActionScope tail` covers
  every case and `invocationScope` leaves that function.
- The physical-note fallback is replaced, not removed. A batch can hold two
  completions, which leaves no restriction, and the tail is then the only route
  to that artwork. Removing it would start failing those turns.

Rejected:

- The first plan's step 5 (remove the release protocol now). Deferred, see below.

Codex deep review, 2026-11-06. Two passes, two findings, both accepted and
reproduced on a real App Server:

- A serialized `subscription` call can queue behind a slow tool while a newer
  message is admitted, then run under that newer input, which may have withdrawn
  approval. Binding the claim to the older input would fix the record but still run
  the billing change.
- A first fix refused calls whose ordinal had advanced. The second pass showed that
  misses a running cell: `await slowTool(); await subscription()` issues its RPC
  after the steer, so it is stamped with the new ordinal. Steering does not stop
  cells. Telling these apart would need cell-provenance tracking.
- Decision: a plan change only runs in a provider turn nobody has steered.
  Production already behaved this way by accident, so billing does not change in
  this PR. A confirmation that lands as a mid-turn message is refused and the model
  asks for it in a new message. Allowing steered confirmations is a separate
  product decision for the owner.
- Final ReviewGPT rounds 1 to 3 each found the signal too late or too fragile, all
  accepted and reproduced. Round 1: `turn/steer` only acknowledges transport, Codex
  holds a steer while a request awaits headers, and issued tools keep running, so
  the consumed ordinal can be 0 after a cancel is acknowledged. A `period_end` change
  schedules through Stripe with no further confirmation, so this was a billing
  regression. Round 2: an entry pushed after the async image write left that write
  unguarded. Round 3: rolling the entry back on a failed image re-enabled billing for
  a queued call during turn cleanup.
- All four holes came from deriving "was this turn steered" from state that moves or
  rolls back. The final rule asks a simpler question, whether a follow-up tried to
  join: `steerAttempted`, set on the first line of `steerLiveTurn` and never cleared.
  That also let `steerLiveTurn` return to its original order. Round 3 proposed having
  tool preflight observe the controller's fatal admission error; this is smaller and
  needs no controller change.
- Scope is deliberate. `assistant_configuration` still runs after a steer: it is a
  reversible preference, Web binds no semantics to the input, and refusing it is
  the reported bug.

Follow-ups from the review, each separately landable:

1. Done here: carry `groupTool` by reference. The `typeof request` check also went:
   the host builds this object in-process and it is typed, and
   `optionalHostedField` already drops null.
2. Declined for now: replace the release return value with a named provider-return
   notification. That adds a hook across about 12 files and may still need a
   `finally`, so it moves plumbing rather than deleting it. The callback is now one
   device-import line. Revisit if a design removes hops.
3. Open: stop re-normalizing the whole execution context in planning, session and
   diagnostics paths, and remove the remaining port wrappers one at a time after
   checking receiver semantics.

Judged and kept: admission drain, durable journal, exact-effect authorization,
scoped tool constructor, effect-boundary checks (cron, operator task, handoff
expiry, turn commit). Do not merge the two context objects wholesale.

## Verification

- Commands to run: focused `assistant-engine` and `assistant-runtime` vitest
  files, including device-import integration; package typecheck; `pnpm test:diff`.
- Expected outcomes: tool-after-steer test fails before the change and passes
  after; net deleted lines; no remaining `currentAssistantInputId` reference.
- Observed: the composed regression fails on the old source with the production
  error `assistant configuration updates require user-sourced input`, and passes
  after the change. All three steered-subscription sequences fail without the rule
  and pass with it: queued behind a slow tool, issued by an older cell, and issued
  after the steer is acknowledged but before Codex consumes it.
  `assistant-codex-steered-billing.test.ts` adds a call during a held image write and
  a call after a failed steer. Both are refused.
- Live model: `pnpm test:assistant:live -- --test "explicit Max upgrade"` passed.
  A confirmation with a mid-turn follow-up made no subscription request, and the
  reply said nothing was applied and asked for one more confirmation. Confirming
  in a new message then succeeded. UX verdict: Ready.
