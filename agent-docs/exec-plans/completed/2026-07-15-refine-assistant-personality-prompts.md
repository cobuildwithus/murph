# Refine assistant personality prompts

## Goal

Make Humor, Push, and Detail settings produce perceptibly distinct, psychologically sound behavior across their five reviewed bands while preserving Murph's health, autonomy, safety, privacy, and action-authority boundaries.

Success criteria:

- Each band describes observable response behavior rather than a vague persona label.
- Humor scales from subtle situational wit to bold, unmistakably nonliteral deadpan absurdity without becoming a joke quota, stock bit, mockery, factual ambiguity, or comedy in protected contexts.
- Push scales accountability around user-chosen goals without shame, coercion, or loss of choice.
- Detail scales useful depth through answer-first progressive disclosure rather than repetition or indiscriminate verbosity.
- The prompt stays lean and aligned with current GPT-5.6 guidance.
- Product documentation and prompt regression tests match the implemented behavior.

## Scope

- In: private-conversation personality prompt fragments, the speaking-style product spec, and direct prompt regressions.
- Out: dial storage, thresholds, Settings UI, model/reasoning routing, voice generation, group-chat behavior, notification behavior, and action authority.

## Constraints

- Preserve the existing five bands and exact 0–10 stored values.
- Keep safety, truth, material caveats, urgent guidance, and clinical quality invariant across dial values.
- Keep the change prompt-primary; add no state, dependency, abstraction, or runtime mechanism.
- Preserve unrelated working-tree and coordination-ledger edits.
- Do not expose local identifiers, paths, secrets, or private content in files, logs, docs, tests, or commits.

## Plan

1. Synthesize the current GPT-5.6 prompt guidance, sibling comedy research, and health-communication psychology evidence into a small set of cross-dial invariants.
2. Rewrite each personality band as concise observable behavior with monotonic intensity and clear protected-context overrides.
3. Align the product spec and direct prompt regression tests.
4. Run focused package verification and assembled-prompt readback.
5. Run the required independent `prompt-review`, resolve any accepted findings, and reverify.
6. Close the plan and commit the scoped change through `scripts/finish-task`.
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
