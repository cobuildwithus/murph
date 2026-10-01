# Personal Pattern message clarity

## Outcome and cause

Scheduled Pattern messages should describe findings and uncertainty plainly and
provide a usable link. The managed prompt explicitly required letter grades and
a bare route; the existing live test also required a letter grade in the reply.

## Scope and invariants

Correct the managed automation's presentation instructions and existing tests.
Keep the query, eligibility, import gate, mutes, identity ledger, and one-message
limit with their existing owners. No new state or dependencies. Existing managed
automation reconciliation adopts changed seed instructions after runtime rollout;
old runtimes retain old copy until updated. No schema migration is needed.

## Product UX and proof

Patch effort: first complete digest and subsequent new-result digest, with mixed
evidence and more findings than the three-highlight limit. Require plain-language
uncertainty, faithful timing/counts, no letter grades, and an absolute final link.
Retain the existing vocabulary/rename quiet-path proof. Use synthetic fixtures.

- [x] Update prompt, deterministic assertions, live journeys, and product owner.
- [x] Run focused tests, typecheck, and live reply review on the automation model.
- [x] Review diff/privacy, add changelog, and prepare the scoped completion commit.

## Verification and review

- Automation regression tests: 58 passed, including refresh of existing managed
  instructions while preserving route, schedule, and status.
- Assistant Engine and Web typechecks: passed.
- Changelog production archive rendering: 9 tests passed.
- Complexity guard: passed, no production complexity added; existing unrelated
  reconciler hotspots are unchanged.
- Public changelog: `clearer-pattern-notifications`; local change has no PR yet.
- Live fixture now supplies scheduled occurrence context and parses the real
  delivery decision before inspecting member-facing text. It starts with valid
  vocabulary; the existing separate normalization journey remains unchanged. Read
  counts come from actual CLI fixture invocations, with a conditional second
  report read only when vocabulary changes.
- Frog: `20260905193814-personal-patterns-live` records the corrected fixture gap.
- Parent review: focused prompt-only correction, no new data owner, query changes,
  delivery side effects, or schema migration. Final ReviewGPT is not required
  under the prompt-primary exemption. No push or deployment performed.

## Live result

Ready: first complete digest and subsequent new-result digest both passed on
`gpt-5.6-luna`, medium reasoning, local subscription auth. Commands:

- `pnpm test:assistant:live -- --test 'clear bounded digest with a full link.*false' --model gpt-5.6-luna`
- `pnpm test:assistant:live -- --test 'clear bounded digest with a full link.*true' --model gpt-5.6-luna`

The production decision parser accepted one send decision for each run. Replies
used no letter grades or bare route, retained evidence counts and uncertainty,
and ended with the absolute Patterns URL. Each run wrote the notification ledger
once, recorded all four identities, and highlighted at most three outcomes.
The first-digest check now records actual CLI invocations, excluding unexecuted
commands after shell short-circuiting. No member message was sent during testing.
Final diff and all seven task files passed privacy review. No production
validation or deployment is claimed by this local completion.
Status: completed
Updated: 2026-09-05
Completed: 2026-09-05
