Goal (incl. success criteria):
- Revise PR 588 so Murph delivers value and establishes an ongoing support loop before gathering the finite health foundation retained from the prior onboarding flow.
- Keep one binary onboarding lifecycle and the existing managed follow-up automation; add no second automation, step store, profile score, or data-point counter.
- Success means first value alone cannot complete onboarding, every foundation checkpoint remains reconstructable without repeated questions, ordinary Murph use stays available while onboarding is open, scoped verification passes, and the PR completes the ReviewGPT loop with zero accepted findings.

Constraints/Assumptions:
- Preserve the public homepage unchanged at the user's direction.
- Preserve experiments, groups, plans, tasks, monitoring, and other product primitives without making any one primitive the core loop.
- Keep health facts and collection preferences in existing canonical owners; do not create fake records or hidden onboarding-step state.
- Preserve unrelated working-tree and coordination-ledger work.
- Reconcile the branch with current `main`, rerun affected proof after any manual conflict resolution, and prove final CI plus mergeability.

Key decisions:
- Use the existing `open | completed` onboarding state as the only lifecycle owner.
- Let the onboarding skill own conversation order, checkpoint meaning, persistence, and completion; keep the automation limited to scheduling, resumption, archive, and skip mechanics.
- Treat `none`, `not relevant`, and explicit category skips as resolved and persist their real meaning through canonical facts or Preferences memory; treat `later` as unresolved.
- Require a meaningful direction, an ongoing support loop, and the six retained foundation checkpoints before answered completion; no experiment, connected device, lab upload, group, or positive health fact is required.

State:
- Implementation and local prompt verification complete; branch reconciliation and PR review remain.

Done:
- Reframed the skill, dynamic onboarding prompt, managed follow-up, durable product docs, and focused regression tests around value-first, foundation-complete onboarding.
- Kept the six prior context areas while moving them after first value and adding a low-pressure now-or-later bridge.
- Removed the automation's duplicated conversation state machine and added targeted canonical reads for truncated or omitted resume evidence.
- Passed the focused assistant-engine and hosted-runtime tests, the full assistant-engine suite, docs gardening/drift, diff hygiene, and privacy scan.
- Completed the required independent prompt-review loop with zero remaining actionable findings.

Now:
- Commit the stable revision and rebase it onto current `origin/main`.

Next:
- Re-run affected proof after reconciliation, close this plan, push, run the ReviewGPT loop to zero accepted findings, and prove CI/mergeability.

Open questions (UNCONFIRMED if needed):
- The funding amount for the investor pitch remains intentionally unspecified; it does not block this onboarding revision.

Working set (files/ids/commands):
- packages/assistant-engine/skills/murph-onboarding/SKILL.md
- packages/assistant-engine/src/assistant-skill-assets.ts
- packages/assistant-engine/src/assistant/onboarding-followup-automation.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/test/assistant-skill-assets.test.ts
- packages/assistant-engine/test/assistant-food-journal-skill.test.ts
- packages/assistant-engine/test/model-behavior.test.ts
- packages/assistant-engine/test/assistant-protocol-index-planning.test.ts
- packages/assistant-runtime/test/hosted-runtime-events.test.ts
- agent-docs/PRODUCT_SENSE.md
- agent-docs/product-marketing-context.md
- agent-docs/product-specs/murph-onboarding.md
- agent-docs/index.md
- agent-docs/product-specs/index.md
- pnpm test:diff <changed onboarding paths>
- pnpm docs:gardening
- pnpm docs:drift
