# Release unclaimed typing preparations

Status: active

## Outcome and invariant

Skipped inputs and completed runtimes release typing preparations they never handed to a turn. A later message can start typing without inheriting an orphaned claim. Active turn ownership, provider authority, and existing full-session limits remain intact.

## Existing owners and evidence

The importer prepares typing; channel-activity owns the per-chat claim and handoff; the automation terminal callback and invocation finally already expose completion. Successful imports currently leave preparations behind when no turn takes them. A synthetic reproduction confirms a stale claim suppresses subsequent typing through the cooldown window.

## Smallest correction

Extend the existing preparation with exact input and runtime identity plus cancellation. Reuse its stop operation at terminal and invocation completion. Serialize successor typing behind an in-flight stop in the same claim. No new registry, durable state, scheduler, dependency, retry policy, or alert change.

## Product UX

- Outcome: Typing remains available for later messages after a silent input.
- Reaches: Private and authorized group Linq chats; handed-off turns keep their existing lifecycle.
- Proof: Synthetic terminal-skip and runtime-exit journeys, pending acceptance and delayed-stop races, plus existing handoff and cooldown coverage.

## Failure and deployment

Cancellation is best effort and does not gate model admission. Provider cleanup settles before successor typing so an old DELETE cannot clear a new indicator. Match the exact runtime and input; never cancel another runtime or a taken handle. No persisted or wire shape changes. Existing warm containers need normal replacement to receive the fix.

## Verification

- Regression failed before the fix: a terminal skip left only POST typing with no DELETE.
- Typing, handoff, composed import, maintenance and conversation-import suites: 287 distinct tests passed across six files.
- Assistant-runtime and Web typechecks passed; changelog rendering: 10 tests passed.
- Complexity guard passed with unchanged source debt and maxima. Parent review keeps the correction within the existing preparation owner.
- Product UX: Ready for deterministic indicator lifecycle; model prompts, reply choices and alert policy are unchanged. No live model proof is needed for this effect-only correction.
- Pending: final PR head, exact-head CI and ReviewGPT. No deployment is authorized or performed.
