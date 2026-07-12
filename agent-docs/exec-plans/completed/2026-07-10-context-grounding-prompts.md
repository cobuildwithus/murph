Goal (incl. success criteria):
- Make personal-health recommendations use the user's saved evidence before generic reasoning, especially for supplement keep/drop/reorder decisions.
- Success means the stable prompt treats relevant-record grounding as core work, the context snapshot exposes the latest live panel date plus a concrete read path, the supplement skill requires lab-aware verdicts even for non-catalog supplements, and focused tests prove the assembled behavior.

Constraints/Assumptions:
- Keep the change prompt-primary: mechanical snapshot support may expose existing canonical evidence but must not change canonical state, tool authority, or external behavior outside prompt assembly.
- Preserve snapshot stale-state safety by bumping the existing version seam rather than adding compatibility machinery.
- Preserve unrelated work and keep the overlapping `system-prompt.ts` edit narrow because another active ledger row also touches that file.
- Follow the iMessage deliverability rules: guidance must frame in-chat user-requested work, not outbound acquisition, notification, or exact-send behavior.

Key decisions:
- Replace "minimum evidence" language with an explicit rule that relevant personal records are core evidence, while still forbidding repeated or outcome-irrelevant scans.
- Expand understand-before-recommending to supplement/product/protocol/intervention take, keep, reorder, and drop questions.
- Derive the newest live blood-panel date through the canonical blood-test query and expose it with the `vault-cli blood-test list` read directive in the context snapshot.
- Revert the unused vault-overview expansion instead of maintaining a second dead navigation surface.
- Make the micronutrients skill require saved-lab reads, dated personal evidence in verdicts, and marker/claim identification for supplements outside its named catalog.

State:
- Complete.

Done:
- Traced the two blood-test navigation surfaces, query sort order, snapshot version fallback, system prompt, supplement skill, and regression tests.
- Recovered and reviewed the implementation left by the prior Claude worker.
- Added the missing reorder trigger, reused the contracts date helpers, and added skill-asset regression coverage.
- Passed the focused 94-test prompt/snapshot/skill set and the full `pnpm test:diff` lane for the touched assistant-engine files after preparing fresh worktree artifacts.
- The required prompt review found that the inherited raw three-shard scan could miss older live panels or surface deleted revisions.
- Replaced that scanner with the canonical `listBloodTests(..., { limit: 1 })` projection, deleted the bespoke parsing path, and added a regression covering both tombstones and panels beyond three newer shards.
- Proved the focused context-snapshot suite passes with 16 tests.
- Re-ran the required prompt review with zero findings; the reviewer confirmed the earlier lifecycle/shard issue is resolved.
- Passed the final focused 92-test prompt/snapshot/skill set and the full diff-aware verification lane, including affected package typechecks/tests and Cloudflare verification.

Now:
- Close the execution plan with the scoped implementation commit.

Next:
- Reconcile with `main`, push the task branch, open the draft PR, and complete the PR review/CI loop.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-engine/src/assistant/context-snapshot.ts
- packages/assistant-engine/src/assistant/system-prompt.ts
- packages/assistant-engine/skills/micronutrients-supplements/SKILL.md
- packages/assistant-engine/skills/physical-therapy/SKILL.md
- packages/assistant-engine/test/assistant-context-snapshot.test.ts
- packages/assistant-engine/test/assistant-skill-assets.test.ts
- packages/assistant-engine/test/model-behavior.test.ts
- pnpm test:diff packages/assistant-engine
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
