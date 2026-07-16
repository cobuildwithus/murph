Goal (incl. success criteria):
- Make the first health topic an aspiration anchor instead of an automatic troubleshooting or planning trigger.
- Introduce Murph's broad relationship promise, briefly name and save one or two open health threads, explicitly park them, gather the finite health foundation one short question at a time, then return with context and collaboratively choose a first step.
- Success means a discovery answer such as "I want to get stronger" cannot produce an unsolicited workout plan, while explicit immediate requests and safety needs still take priority.

Constraints/Assumptions:
- Keep the existing `open | completed` onboarding state, canonical goal owners, resume snapshot, and one managed follow-up automation. Add no persisted step or parked-thread state.
- Treat answering Murph's discovery question as context, not action authorization.
- Ask at most one question per reply and no more than three short questions across aspiration discovery; stop earlier once outcome, motivation, and priority are clear enough to name one or two useful threads.
- Preserve immediate-request, clinical-safety, privacy, authorization, and canonical-persistence rules.
- Preserve unrelated working-tree and coordination-ledger edits.

Key decisions:
- Replace value-first/support-loop-first ordering with aspiration anchor -> explicit park -> foundation -> contextual return -> collaborative first step.
- Keep the broad welcome short and let the park transition explain why Murph is learning context.
- Allow one light motivation question when needed, but do not excavate obstacles, failed attempts, baseline, equipment, schedule, or intervention details during aspiration capture.
- At the contextual return, use `behavior-followthrough` for desired changes and ask up to three one-per-message questions about prior follow-through, disruption, and support fit before choosing the first behavior; usually ask two or three, stop early when context already answers them, reuse the motivation already learned, and save only grounded user statements through existing owners.
- Preserve forward progress without new persisted step state by treating visible later foundation evidence—or a clear foundation/return resume with a saved aspiration—as evidence that parking already occurred.
- Change the thin open-onboarding overlay as well as the skill so the intent boundary reaches resumed model threads and remains visible if skill loading is imperfect.
- Prove the contract through focused prompt/skill tests and a direct conversational roleplay after implementation.

State:
- Complete.

Done:
- Reproduced the bad flow from the current prompt contract and traced the strength-plan handoff.
- Re-read the durable onboarding spec, prompt overlay, skill routing, follow-up automation, product guidance, and current tests.
- Agreed the intended flow and immediate-request exception with the user.
- Replaced value-first/support-loop-first onboarding with aspiration capture, explicit parking, progressive foundation context, contextual return, and collaborative first-step selection.
- Added the discovery-answer intent guard, bounded aspiration questions, optional Explore path, truncated-history forward-progress inference, and a bounded early-stopping behavioral-fit pass that reuses known motivation.
- Kept `murph-onboarding` as the single conversation-sequence owner and made `behavior-followthrough` defer to it at the return seam.
- Made every user-facing scheduled continuation include exactly one easy reply-oriented question or skip, preventing reflection-only outbound sequences.
- Updated durable product guidance, routing indexes, automation copy, prompt assembly, and focused contract tests.
- Completed prompt review with zero unresolved findings.
- Passed focused prompt tests (128), focused hosted-runtime tests (31), and the full diff-aware reverse-dependent lane, including affected typechecks, 5,306 package tests, and 1,833 Cloudflare tests.

Now:
- Close and archive this plan with the scoped implementation commit.

Next:
- After the scoped commit, transplant it onto current `main`, push, run the protected production Cloudflare deploy, check post-deploy errors, complete the live iMessage reply smoke, and begin the user roleplay.

Open questions (UNCONFIRMED if needed):
- None blocking. A member may explicitly leave the returned thread open without choosing an action; that should not coerce an indefinite onboarding loop.

Working set (files/ids/commands):
- agent-docs/product-specs/murph-onboarding.md
- agent-docs/index.md
- agent-docs/product-specs/index.md
- agent-docs/PRODUCT_SENSE.md
- agent-docs/product-marketing-context.md
- packages/assistant-engine/skills/murph-onboarding/SKILL.md
- packages/assistant-engine/skills/behavior-followthrough/SKILL.md
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/src/assistant/onboarding-followup-automation.ts
- packages/assistant-engine/test/assistant-skill-assets.test.ts
- packages/assistant-engine/test/model-behavior.test.ts
- packages/assistant-runtime/test/hosted-runtime-events.test.ts
- focused onboarding automation tests if required by the final diff
- pnpm test:diff <touched paths>
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
