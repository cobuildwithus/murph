# Use known context before automation questions

Status: completed
Created: 2026-09-06
Updated: 2026-09-06

## Outcome and scope

Scheduled questions should use information already available instead of asking
members to repeat themselves, even when saved instructions prescribe exact copy.
This applies to private and group scheduled turns, including one-shots and
managed jobs. Ordinary foreground and detached output-only turns stay unchanged.

## Owner and evidence

The shared scheduled execution context in Assistant Engine owns this policy.
The existing recurring-reminder policy covers only a subset of automations;
the shared execution context currently delegates directly to saved instructions.
Extend that existing prompt boundary. No new persistence, scheduler, mandatory
network call, delivery gate, or automation-record migration is needed.
Conversation and canonical records remain their existing authoritative owners.

## Product UX and proof

- Fully answered question: skip this occurrence despite exact-send wording.
- Partial answer: acknowledge known context and ask only a useful missing detail.
- Old occurrence or planned action: preserve the current useful question/cue.
- Group: use only the current authorized audience and attributable evidence.
- Unavailable evidence: do not fabricate completion or cancel future reminders.

Prove scheduled-only prompt composition deterministically, run focused synthetic
real-Codex journeys through production instructions, and review every visible
reply. Run relevant typechecks and inspect the complete diff for conflicts,
privacy, and unnecessary complexity. The change affects prompt policy only;
existing delivery, retry, and mixed-version state contracts remain unchanged.

## Tasks

1. Extend the shared scheduled prompt and durable architecture contract.
2. Add deterministic coverage and focused live scenarios.
3. Run focused checks, review UX and the diff, and create a scoped commit.

## Verification

- Shared scheduled prompt, architecture contract, and five synthetic live scenarios implemented.
- Focused prompt/routing proof: 186 tests passed through direct Vitest invocation.
  The route-plan snapshot changed only for scheduled email; direct, group,
  maintenance, and detached output-only hashes stayed unchanged.
- Assistant Engine typecheck passed, including opt-in live test compilation.
- Changelog generation and archive rendering proof passed (9 tests); Web typecheck passed.
- Complexity guard passed: no change to control-flow complexity. Existing
  hotspots are unrelated to the changed scheduled text.
- Diff whitespace and added-content identifier checks passed.
- An initial script invocation accidentally selected the entire package:
  4,526 tests passed and the expected scheduled snapshot needed updating.
  The corrected focused command passed afterward. The task includes a Frog
  entry documenting the argument-forwarding friction.
- Real-model proof passed with gpt-5.6-terra, low reasoning, local subscription:
  `pnpm test:assistant:live -- --test "uses known answers before exact automation questions without suppressing unresolved work"`
  used one already-authenticated alternate profile after pre-action failures.
  Five provider turns passed: two answered questions skipped; a partial answer
  asked only the missing detail; an old answer and a planned action preserved
  current useful outreach. There were no tool calls, follow-up creations, or
  other effects. Every synthetic reply was reviewed: Product UX Ready.
- Final parent review: the new policy is confined to scheduled dynamic turn
  context, overrides exact saved question wording, and preserves occurrence,
  privacy, independent-work, and future-schedule boundaries. No unrelated
  simplification or new state is warranted.

Deployment and production record changes are outside this task. The changelog
fragment accompanies the local change; its source PR list remains empty until
there is a PR. Final external review is not required for this prompt-only
behavior change under the completion workflow's prompt-primary exemption.
Completed: 2026-09-06
